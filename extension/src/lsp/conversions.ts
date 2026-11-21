/*
 * Structural LSP -> Monaco conversions.
 *
 * monaco-languageserver-types is used for the lossless structural pieces it
 * handles correctly. Known losses (completion data, code-action command/data,
 * inlay data, LocationLink definitions, workspace-edit resource operations)
 * are handled here, with raw objects kept in WeakMaps for resolve round-trips.
 * Every rendered MarkupContent is explicitly untrusted: no HTML and no command
 * execution from markdown.
 */

import {
  toCompletionItem,
  toMarkerData,
  toPosition,
  toRange,
  toSemanticTokens,
  toTextEdit
} from "monaco-languageserver-types";
import type * as monaco from "monaco-editor";
import type {
  CodeAction as LspCodeAction,
  Command as LspCommand,
  CompletionItem as LspCompletionItem,
  CompletionList as LspCompletionList,
  Diagnostic,
  Hover as LspHover,
  InlayHint as LspInlayHint,
  Location as LspLocation,
  LocationLink as LspLocationLink,
  MarkedString,
  MarkupContent,
  Range as LspRange,
  SemanticTokens as LspSemanticTokens,
  SignatureHelp as LspSignatureHelp,
  TextEdit as LspTextEdit,
  WorkspaceEdit
} from "vscode-languageserver-protocol";

export interface UntrustedMarkdownString {
  readonly value: string;
  readonly isTrusted: false;
  readonly supportHtml: false;
}

export type ResourceResolver = (lspUri: string) => monaco.Uri;

export type CommandWrapper = (
  command: LspCommand
) => monaco.languages.Command | undefined;

export interface CompletionOriginal {
  readonly raw: LspCompletionItem;
  readonly fallbackRange: monaco.IRange;
}

export interface CodeActionOriginal {
  readonly raw: LspCodeAction;
}

export interface InlayHintOriginal {
  readonly raw: LspInlayHint;
}

export type WorkspaceEditConversion =
  | { readonly ok: true; readonly edit: monaco.languages.WorkspaceEdit }
  | { readonly ok: false; readonly reason: string };

export type WorkspaceEditConverter = (
  edit: WorkspaceEdit
) => WorkspaceEditConversion;

const completionOriginals = new WeakMap<object, CompletionOriginal>();
const codeActionOriginals = new WeakMap<object, CodeActionOriginal>();
const inlayHintOriginals = new WeakMap<object, InlayHintOriginal>();

export function rememberCompletionOriginal(
  converted: monaco.languages.CompletionItem,
  raw: LspCompletionItem,
  fallbackRange: monaco.IRange
): void {
  completionOriginals.set(converted, { raw, fallbackRange });
}

export function recallCompletionOriginal(
  converted: monaco.languages.CompletionItem
): CompletionOriginal | null {
  return completionOriginals.get(converted) ?? null;
}

export function rememberCodeActionOriginal(
  converted: monaco.languages.CodeAction,
  raw: LspCodeAction
): void {
  codeActionOriginals.set(converted, { raw });
}

export function recallCodeActionOriginal(
  converted: monaco.languages.CodeAction
): LspCodeAction | null {
  return codeActionOriginals.get(converted)?.raw ?? null;
}

export function rememberInlayHintOriginal(
  converted: monaco.languages.InlayHint,
  raw: LspInlayHint
): void {
  inlayHintOriginals.set(converted, { raw });
}

export function recallInlayHintOriginal(
  converted: monaco.languages.InlayHint
): LspInlayHint | null {
  return inlayHintOriginals.get(converted)?.raw ?? null;
}

export function escapeMarkdownText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+\-.!|>~]/g, "\\$&");
}

function untrustedMarkdown(value: string): UntrustedMarkdownString {
  return { value, isTrusted: false, supportHtml: false };
}

export function plaintextMarkdown(value: string): UntrustedMarkdownString {
  return untrustedMarkdown(escapeMarkdownText(value));
}

export function markupToMarkdown(
  content: MarkupContent
): UntrustedMarkdownString {
  return content.kind === "plaintext"
    ? plaintextMarkdown(content.value)
    : untrustedMarkdown(content.value);
}

function markedStringToMarkdown(value: MarkedString): UntrustedMarkdownString {
  if (typeof value === "string") return untrustedMarkdown(value);
  const language = /^[A-Za-z0-9_+.#-]*$/.exec(value.language)?.[0] ?? "";
  const body = value.value.replace(/```/g, "`\u200b``");
  return untrustedMarkdown(
    language ? `\`\`\`${language}\n${body}\n\`\`\`` : `\`\`\`\n${body}\n\`\`\``
  );
}

function hoverContentsToMarkdown(
  contents: LspHover["contents"]
): UntrustedMarkdownString[] {
  if (Array.isArray(contents)) {
    return contents.map(markedStringToMarkdown);
  }
  if (typeof contents === "string") {
    return [untrustedMarkdown(contents)];
  }
  if ("kind" in contents) {
    return [markupToMarkdown(contents)];
  }
  return [markedStringToMarkdown(contents)];
}

function documentationToMonaco(
  documentation: string | MarkupContent | undefined
): string | UntrustedMarkdownString | undefined {
  if (documentation === undefined) return undefined;
  return typeof documentation === "string"
    ? plaintextMarkdown(documentation)
    : markupToMarkdown(documentation);
}

function applyCompletionDocumentation(
  converted: monaco.languages.CompletionItem,
  raw: LspCompletionItem
): void {
  const documentation = documentationToMonaco(raw.documentation);
  if (documentation !== undefined) {
    converted.documentation = documentation;
  } else {
    delete converted.documentation;
  }
}

function applyCompletionLabelDetails(
  converted: monaco.languages.CompletionItem,
  raw: LspCompletionItem
): void {
  if (typeof raw.label !== "string" || !raw.labelDetails) return;
  converted.label = {
    label: raw.label,
    ...(raw.labelDetails.detail === undefined
      ? {}
      : { detail: raw.labelDetails.detail }),
    ...(raw.labelDetails.description === undefined
      ? {}
      : { description: raw.labelDetails.description })
  };
}

function mergeCompletionDefaults(
  item: LspCompletionItem,
  defaults: LspCompletionList["itemDefaults"]
): LspCompletionItem {
  if (!defaults || defaults.data === undefined || item.data !== undefined) {
    return item;
  }
  return { ...item, data: defaults.data };
}

export function toMonacoCompletionItem(
  raw: LspCompletionItem,
  fallbackRange: monaco.IRange,
  wrapCommand: CommandWrapper,
  itemDefaults?: LspCompletionList["itemDefaults"]
): monaco.languages.CompletionItem {
  const converted = toCompletionItem(raw, {
    range: fallbackRange,
    ...(itemDefaults === undefined ? {} : { itemDefaults })
  }) as unknown as monaco.languages.CompletionItem;
  applyCompletionDocumentation(converted, raw);
  applyCompletionLabelDetails(converted, raw);
  if (raw.textEditText !== undefined) {
    converted.insertText = raw.textEditText;
  }
  if (raw.command) {
    const wrapped = wrapCommand(raw.command);
    if (wrapped) {
      converted.command = wrapped;
    } else {
      delete converted.command;
    }
  }
  rememberCompletionOriginal(converted, raw, fallbackRange);
  return converted;
}

export function toMonacoCompletionList(
  raw: LspCompletionList,
  fallbackRange: monaco.IRange,
  wrapCommand: CommandWrapper
): monaco.languages.CompletionList {
  return {
    incomplete: Boolean(raw.isIncomplete),
    suggestions: raw.items.map((item) =>
      toMonacoCompletionItem(
        mergeCompletionDefaults(item, raw.itemDefaults),
        fallbackRange,
        wrapCommand,
        raw.itemDefaults
      )
    )
  };
}

export function toMonacoHover(raw: LspHover): monaco.languages.Hover {
  const hover: monaco.languages.Hover = {
    contents: hoverContentsToMarkdown(raw.contents)
  };
  if (raw.range) hover.range = toRange(raw.range);
  return hover;
}

export function toMonacoSignatureHelp(
  raw: LspSignatureHelp
): monaco.languages.SignatureHelp {
  return {
    activeSignature: raw.activeSignature ?? 0,
    activeParameter: raw.activeParameter ?? 0,
    signatures: raw.signatures.map((signature) => ({
      label: signature.label,
      ...(signature.documentation === undefined
        ? {}
        : {
            documentation: documentationToMonaco(signature.documentation)
          }),
      parameters: (signature.parameters ?? []).map((parameter) => ({
        label: parameter.label,
        ...(parameter.documentation === undefined
          ? {}
          : { documentation: documentationToMonaco(parameter.documentation) })
      })),
      ...(signature.activeParameter === undefined ||
      signature.activeParameter === null
        ? {}
        : { activeParameter: signature.activeParameter })
    }))
  };
}

export function toMonacoLocation(
  raw: LspLocation,
  resolveResource: ResourceResolver
): monaco.languages.Location {
  return {
    uri: resolveResource(raw.uri),
    range: toRange(raw.range)
  };
}

export function toMonacoLocationLink(
  raw: LspLocationLink,
  resolveResource: ResourceResolver
): monaco.languages.LocationLink {
  return {
    uri: resolveResource(raw.targetUri),
    range: toRange(raw.targetRange),
    targetSelectionRange: toRange(raw.targetSelectionRange),
    ...(raw.originSelectionRange === undefined
      ? {}
      : { originSelectionRange: toRange(raw.originSelectionRange) })
  };
}

export function toMonacoDefinition(
  raw:
    | LspLocation
    | LspLocationLink[]
    | LspLocation[]
    | null
    | undefined,
  resolveResource: ResourceResolver
): monaco.languages.Definition | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) {
    return toMonacoLocation(raw, resolveResource);
  }
  if (raw.length === 0) return [];
  const first = raw[0];
  if (!first) return [];
  if ("targetUri" in first) {
    return raw.map((link) =>
      toMonacoLocationLink(link as LspLocationLink, resolveResource)
    );
  }
  return raw.map((location) =>
    toMonacoLocation(location as LspLocation, resolveResource)
  );
}

export function toMonacoReferences(
  raw: readonly LspLocation[],
  resolveResource: ResourceResolver
): monaco.languages.Location[] {
  return raw.map((location) => toMonacoLocation(location, resolveResource));
}

export function toMonacoInlayHint(
  raw: LspInlayHint,
  wrapCommand: CommandWrapper
): monaco.languages.InlayHint {
  const label =
    typeof raw.label === "string"
      ? raw.label
      : raw.label.map((part) => ({
          label: part.value,
          ...(part.tooltip === undefined
            ? {}
            : {
                tooltip:
                  typeof part.tooltip === "string"
                    ? plaintextMarkdown(part.tooltip)
                    : markupToMarkdown(part.tooltip)
              }),
          ...(part.command === undefined
            ? {}
            : { command: wrapCommand(part.command) })
        }));
  const hint: monaco.languages.InlayHint = {
    label,
    position: toPosition(raw.position)
  };
  if (raw.kind !== undefined) {
    hint.kind = raw.kind as unknown as monaco.languages.InlayHintKind;
  }
  if (raw.paddingLeft !== undefined) hint.paddingLeft = raw.paddingLeft;
  if (raw.paddingRight !== undefined) hint.paddingRight = raw.paddingRight;
  if (raw.tooltip !== undefined) {
    hint.tooltip =
      typeof raw.tooltip === "string"
        ? plaintextMarkdown(raw.tooltip)
        : markupToMarkdown(raw.tooltip);
  }
  if (raw.textEdits) {
    hint.textEdits = raw.textEdits.map(
      (edit) => toTextEdit(edit) as unknown as monaco.languages.TextEdit
    );
  }
  rememberInlayHintOriginal(hint, raw);
  return hint;
}

export function toMonacoInlayHints(
  raw: readonly LspInlayHint[],
  wrapCommand: CommandWrapper
): monaco.languages.InlayHint[] {
  return raw.map((hint) => toMonacoInlayHint(hint, wrapCommand));
}

export function toMonacoSemanticTokens(
  raw: LspSemanticTokens
): monaco.languages.SemanticTokens {
  return toSemanticTokens(raw) as unknown as monaco.languages.SemanticTokens;
}

export function toMonacoDiagnosticMarker(
  raw: Diagnostic,
  modelVersionId: number
): monaco.editor.IMarkerData {
  const marker = toMarkerData(raw) as unknown as monaco.editor.IMarkerData;
  return { ...marker, modelVersionId };
}

export function toMonacoFormattingEdits(
  raw: readonly LspTextEdit[]
): monaco.languages.TextEdit[] {
  return raw.map(
    (edit) => toTextEdit(edit) as unknown as monaco.languages.TextEdit
  );
}

export function toMonacoCodeAction(
  raw: LspCodeAction,
  convertEdit: WorkspaceEditConverter,
  wrapCommand: CommandWrapper
): monaco.languages.CodeAction {
  const converted: monaco.languages.CodeAction = {
    title: raw.title,
    ...(raw.kind === undefined ? {} : { kind: raw.kind }),
    ...(raw.isPreferred === undefined ? {} : { isPreferred: raw.isPreferred }),
    ...(raw.diagnostics === undefined
      ? {}
      : {
          diagnostics: raw.diagnostics.map(
            (diagnostic) =>
              toMarkerData(diagnostic) as unknown as monaco.editor.IMarkerData
          )
        })
  };

  if (raw.disabled) {
    converted.disabled = raw.disabled.reason;
  } else if (raw.edit) {
    const edit = convertEdit(raw.edit);
    if (edit.ok) {
      converted.edit = edit.edit;
    } else {
      converted.disabled = edit.reason;
    }
  } else if (raw.command) {
    const wrapped = wrapCommand(raw.command);
    if (wrapped) converted.command = wrapped;
  }

  rememberCodeActionOriginal(converted, raw);
  return converted;
}

export function lspRangeToMonaco(range: LspRange): monaco.IRange {
  return toRange(range);
}
