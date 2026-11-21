/*
 * Registers only providers the backend advertises and the host Monaco exposes.
 * Every callback checks the exact bound model and session generation before
 * and after awaits. Workspace edits are validated once and never pre-applied;
 * code-action/rename provider edits are returned to Monaco for a single apply.
 */

import {
  fromMarkerData,
  fromPosition,
  fromRange
} from "monaco-languageserver-types";
import type * as monaco from "monaco-editor";
import type {
  CodeAction as LspCodeAction,
  CodeActionContext as LspCodeActionContext,
  Command as LspCommand,
  CompletionItem as LspCompletionItem,
  CompletionList as LspCompletionList,
  Hover as LspHover,
  InlayHint as LspInlayHint,
  Location as LspLocation,
  LocationLink as LspLocationLink,
  Range as LspRange,
  SemanticTokens as LspSemanticTokens,
  SignatureHelp as LspSignatureHelp,
  TextEdit as LspTextEdit,
  WorkspaceEdit
} from "vscode-languageserver-protocol";

import {
  recallCodeActionOriginal,
  recallCompletionOriginal,
  recallInlayHintOriginal,
  toMonacoCodeAction,
  toMonacoCompletionItem,
  toMonacoCompletionList,
  toMonacoDefinition,
  toMonacoFormattingEdits,
  toMonacoHover,
  toMonacoInlayHint,
  toMonacoInlayHints,
  toMonacoReferences,
  toMonacoSemanticTokens,
  toMonacoSignatureHelp,
  lspRangeToMonaco,
  type CommandWrapper,
  type ResourceResolver,
  type WorkspaceEditConversion,
  type WorkspaceEditConverter
} from "./conversions.js";
import {
  createCommandBridge,
  type CommandBridge
} from "./commands.js";
import {
  backendFeatureAvailability,
  hostFeatureAvailability,
  LSP_FEATURES
} from "./features.js";
import type { Session, SessionBinding } from "./session.js";
import {
  toVersionedWorkspaceEdit,
  type WorkspaceEditContext
} from "./workspace-edit.js";

function currentBinding(
  session: Session,
  model: monaco.editor.ITextModel
): SessionBinding | null {
  if (!session.isCurrent()) return null;
  const binding = session.getBinding();
  if (!binding || binding.model !== model) return null;
  if (model.isDisposed()) return null;
  return binding;
}

function stillBound(
  session: Session,
  model: monaco.editor.ITextModel,
  previous: SessionBinding
): SessionBinding | null {
  const binding = currentBinding(session, model);
  if (!binding) return null;
  if (
    binding.lspVersion !== previous.lspVersion ||
    binding.monacoVersionAtSync !== previous.monacoVersionAtSync
  ) {
    return null;
  }
  return binding;
}

function resourceResolver(
  monacoApi: typeof monaco,
  session: Session,
  binding: SessionBinding
): ResourceResolver {
  return (uri: string): monaco.Uri =>
    uri === session.uri ? binding.model.uri : monacoApi.Uri.parse(uri);
}

function renameContext(
  session: Session,
  model: monaco.editor.ITextModel
): WorkspaceEditContext | null {
  const binding = currentBinding(session, model);
  if (!binding) return null;
  return {
    model,
    editor: binding.editor,
    lspUri: session.uri,
    lspVersion: binding.lspVersion,
    monacoVersionAtSync: binding.monacoVersionAtSync,
    isCurrent: () => session.isCurrent()
  };
}

function workspaceEditConverter(
  session: Session,
  model: monaco.editor.ITextModel
): WorkspaceEditConverter {
  return (edit: WorkspaceEdit): WorkspaceEditConversion => {
    const context = renameContext(session, model);
    if (!context) {
      return {
        ok: false,
        reason: "The language session changed before the edit was converted."
      };
    }
    const versioned = toVersionedWorkspaceEdit(edit, context);
    if (!versioned.ok) {
      return { ok: false, reason: versioned.reason };
    }
    return {
      ok: true,
      edit: {
        edits: versioned.edits.map((item) => ({
          resource: model.uri,
          textEdit: { range: item.range, text: item.text },
          versionId: versioned.versionId
        }))
      }
    };
  };
}

function codeActionFromServer(
  raw: LspCodeAction | LspCommand,
  convertEdit: WorkspaceEditConverter,
  wrapCommand: CommandWrapper
): monaco.languages.CodeAction {
  if ("command" in raw && typeof raw.command === "string") {
    const action: LspCodeAction = {
      title: raw.title,
      command: raw as LspCommand
    };
    return toMonacoCodeAction(action, convertEdit, wrapCommand);
  }
  return toMonacoCodeAction(raw as LspCodeAction, convertEdit, wrapCommand);
}

/**
 * Register all supported providers for `model`. Missing backend capabilities
 * or host APIs are reported through the session status callback and skipped;
 * no empty provider is ever installed.
 */
export function registerProviders(
  monacoApi: typeof monaco,
  session: Session,
  model: monaco.editor.ITextModel
): monaco.IDisposable {
  const backend = backendFeatureAvailability(session.capabilities);
  const host = hostFeatureAvailability(monacoApi);
  const unavailable = LSP_FEATURES.filter(
    (feature) => backend[feature] && !host[feature]
  );
  session.reportUnavailable(unavailable, "host");

  const commandBridge: CommandBridge = createCommandBridge(monacoApi, session);
  if (model.isDisposed()) {
    return {
      dispose: () => {
        commandBridge.dispose();
      }
    };
  }
  const disposables: monaco.IDisposable[] = [commandBridge];
  const wrapCommand = commandBridge.wrapCommand;

  if (backend.completion && host.completion) {
    const completion = session.capabilities.completionProvider;
    const triggers =
      completion?.triggerCharacters && completion.triggerCharacters.length > 0
        ? [...completion.triggerCharacters]
        : undefined;
    const provider: monaco.languages.CompletionItemProvider = {
      ...(triggers === undefined ? {} : { triggerCharacters: triggers }),
      provideCompletionItems: async (
        requestModel,
        position,
        context,
        token
      ) => {
        if (!currentBinding(session, requestModel)) return null;
        const binding = session.getBinding();
        if (!binding) return null;
        const word = requestModel.getWordUntilPosition(position);
        const fallbackRange: monaco.IRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn
        };
        const triggerKind =
          context.triggerKind === 1
            ? 2
            : context.triggerKind === 2
              ? 3
              : 1;
        const raw = await session.request<
          LspCompletionList | LspCompletionItem[] | null
        >(
          "textDocument/completion",
          {
            textDocument: { uri: session.uri },
            position: fromPosition(position),
            context: {
              triggerKind,
              ...(context.triggerCharacter === undefined
                ? {}
                : { triggerCharacter: context.triggerCharacter })
            }
          },
          token
        );
        if (!stillBound(session, requestModel, binding)) return null;
        if (!raw) return null;
        const list: LspCompletionList = Array.isArray(raw)
          ? { isIncomplete: false, items: raw }
          : raw;
        return toMonacoCompletionList(list, fallbackRange, wrapCommand);
      }
    };
    if (completion?.resolveProvider === true) {
      provider.resolveCompletionItem = async (item, token) => {
        if (!session.isCurrent()) return item;
        const original = recallCompletionOriginal(item);
        if (!original) return item;
        const binding = session.getBinding();
        if (!binding) return item;
        const resolved = await session.request<LspCompletionItem>(
          "completionItem/resolve",
          original.raw,
          token
        );
        if (!session.isCurrent()) return item;
        const after = session.getBinding();
        if (
          !after ||
          after.model !== binding.model ||
          after.lspVersion !== binding.lspVersion
        ) {
          return item;
        }
        return toMonacoCompletionItem(
          resolved,
          original.fallbackRange,
          wrapCommand
        );
      };
    }
    disposables.push(
      monacoApi.languages.registerCompletionItemProvider("cpp", provider)
    );
  }

  if (backend.hover && host.hover) {
    disposables.push(
      monacoApi.languages.registerHoverProvider("cpp", {
        provideHover: async (requestModel, position, token) => {
          if (!currentBinding(session, requestModel)) return null;
          const binding = session.getBinding();
          if (!binding) return null;
          const raw = await session.request<LspHover | null>(
            "textDocument/hover",
            {
              textDocument: { uri: session.uri },
              position: fromPosition(position)
            },
            token
          );
          if (!stillBound(session, requestModel, binding)) return null;
          return raw ? toMonacoHover(raw) : null;
        }
      })
    );
  }

  if (backend.signatureHelp && host.signatureHelp) {
    const signature = session.capabilities.signatureHelpProvider;
    const triggerCharacters =
      signature && signature.triggerCharacters?.length
        ? [...signature.triggerCharacters]
        : undefined;
    const retriggerCharacters =
      signature && signature.retriggerCharacters?.length
        ? [...signature.retriggerCharacters]
        : undefined;
    disposables.push(
      monacoApi.languages.registerSignatureHelpProvider("cpp", {
        ...(triggerCharacters === undefined
          ? {}
          : { signatureHelpTriggerCharacters: triggerCharacters }),
        ...(retriggerCharacters === undefined
          ? {}
          : { signatureHelpRetriggerCharacters: retriggerCharacters }),
        provideSignatureHelp: async (
          requestModel,
          position,
          token,
          context
        ) => {
          if (!currentBinding(session, requestModel)) return null;
          const binding = session.getBinding();
          if (!binding) return null;
          const raw = await session.request<LspSignatureHelp | null>(
            "textDocument/signatureHelp",
            {
              textDocument: { uri: session.uri },
              position: fromPosition(position),
              context: {
                triggerKind: context.triggerKind,
                ...(context.triggerCharacter === undefined
                  ? {}
                  : { triggerCharacter: context.triggerCharacter }),
                isRetrigger: context.isRetrigger
              }
            },
            token
          );
          if (!stillBound(session, requestModel, binding)) return null;
          if (!raw) return null;
          return {
            value: toMonacoSignatureHelp(raw),
            dispose: () => undefined
          };
        }
      })
    );
  }

  if (backend.definition && host.definition) {
    disposables.push(
      monacoApi.languages.registerDefinitionProvider("cpp", {
        provideDefinition: async (requestModel, position, token) => {
          if (!currentBinding(session, requestModel)) return null;
          const binding = session.getBinding();
          if (!binding) return null;
          const raw = await session.request<
            LspLocation | LspLocation[] | LspLocationLink[] | null
          >(
            "textDocument/definition",
            {
              textDocument: { uri: session.uri },
              position: fromPosition(position)
            },
            token
          );
          if (!stillBound(session, requestModel, binding)) return null;
          return toMonacoDefinition(
            raw,
            resourceResolver(monacoApi, session, binding)
          );
        }
      })
    );
  }

  if (backend.references && host.references) {
    disposables.push(
      monacoApi.languages.registerReferenceProvider("cpp", {
        provideReferences: async (
          requestModel,
          position,
          context,
          token
        ) => {
          if (!currentBinding(session, requestModel)) return null;
          const binding = session.getBinding();
          if (!binding) return null;
          const raw = await session.request<LspLocation[] | null>(
            "textDocument/references",
            {
              textDocument: { uri: session.uri },
              position: fromPosition(position),
              context: { includeDeclaration: context.includeDeclaration }
            },
            token
          );
          if (!stillBound(session, requestModel, binding)) return null;
          return raw
            ? toMonacoReferences(
                raw,
                resourceResolver(monacoApi, session, binding)
              )
            : null;
        }
      })
    );
  }

  if (backend.rename && host.rename) {
    const renameOptions = session.capabilities.renameProvider;
    const prepareSupport =
      typeof renameOptions === "object" &&
      renameOptions.prepareProvider === true;
    const provider: monaco.languages.RenameProvider = {
      provideRenameEdits: async (
        requestModel,
        position,
        newName,
        token
      ) => {
        if (!currentBinding(session, requestModel)) return null;
        const binding = session.getBinding();
        if (!binding) return null;
        const raw = await session.request<WorkspaceEdit | null>(
          "textDocument/rename",
          {
            textDocument: { uri: session.uri },
            position: fromPosition(position),
            newName
          },
          token
        );
        if (!stillBound(session, requestModel, binding)) return null;
        if (!raw) return null;
        const context = renameContext(session, requestModel);
        if (!context) return null;
        const versioned = toVersionedWorkspaceEdit(raw, context);
        if (!versioned.ok) {
          return { edits: [], rejectReason: versioned.reason };
        }
        return {
          edits: versioned.edits.map((edit) => ({
            resource: requestModel.uri,
            textEdit: { range: edit.range, text: edit.text },
            versionId: versioned.versionId
          }))
        };
      }
    };
    if (prepareSupport) {
      provider.resolveRenameLocation = async (
        requestModel,
        position,
        token
      ) => {
        if (!currentBinding(session, requestModel)) return null;
        const binding = session.getBinding();
        if (!binding) return null;
        const raw = await session.request<
          | LspRange
          | { range: LspRange; placeholder?: string }
          | { defaultBehavior: true }
          | null
        >(
          "textDocument/prepareRename",
          {
            textDocument: { uri: session.uri },
            position: fromPosition(position)
          },
          token
        );
        if (!stillBound(session, requestModel, binding)) return null;
        if (!raw) return null;
        if ("defaultBehavior" in raw) return undefined;
        const range = "range" in raw ? raw.range : raw;
        const text =
          ("placeholder" in raw ? raw.placeholder : undefined) ??
          requestModel.getWordAtPosition(position)?.word ??
          "";
        return { range: lspRangeToMonaco(range), text };
      };
    }
    disposables.push(
      monacoApi.languages.registerRenameProvider("cpp", provider)
    );
  }

  if (backend.formatting && host.formatting) {
    disposables.push(
      monacoApi.languages.registerDocumentFormattingEditProvider("cpp", {
        provideDocumentFormattingEdits: async (requestModel, options, token) => {
          if (!currentBinding(session, requestModel)) return null;
          const binding = session.getBinding();
          if (!binding) return null;
          const raw = await session.request<LspTextEdit[] | null>(
            "textDocument/formatting",
            {
              textDocument: { uri: session.uri },
              options: {
                tabSize: options.tabSize,
                insertSpaces: options.insertSpaces
              }
            },
            token
          );
          if (!stillBound(session, requestModel, binding)) return null;
          return raw ? toMonacoFormattingEdits(raw) : null;
        }
      })
    );
  }

  if (backend.rangeFormatting && host.rangeFormatting) {
    disposables.push(
      monacoApi.languages.registerDocumentRangeFormattingEditProvider("cpp", {
        provideDocumentRangeFormattingEdits: async (
          requestModel,
          range,
          options,
          token
        ) => {
          if (!currentBinding(session, requestModel)) return null;
          const binding = session.getBinding();
          if (!binding) return null;
          const raw = await session.request<LspTextEdit[] | null>(
            "textDocument/rangeFormatting",
            {
              textDocument: { uri: session.uri },
              range: fromRange(range),
              options: {
                tabSize: options.tabSize,
                insertSpaces: options.insertSpaces
              }
            },
            token
          );
          if (!stillBound(session, requestModel, binding)) return null;
          return raw ? toMonacoFormattingEdits(raw) : null;
        }
      })
    );
  }

  if (backend.codeAction && host.codeAction) {
    const codeActionOptions = session.capabilities.codeActionProvider;
    const resolveSupport =
      typeof codeActionOptions === "object" &&
      codeActionOptions.resolveProvider === true;
    const kinds =
      typeof codeActionOptions === "object"
        ? codeActionOptions.codeActionKinds
        : undefined;
    const provider: monaco.languages.CodeActionProvider = {
      provideCodeActions: async (requestModel, range, context, token) => {
        if (!currentBinding(session, requestModel)) return null;
        const binding = session.getBinding();
        if (!binding) return null;
        const lspContext: LspCodeActionContext = {
          diagnostics: context.markers.map(fromMarkerData),
          ...(context.only === undefined ? {} : { only: [context.only] }),
          triggerKind: context.trigger === 2 ? 2 : 1
        };
        const raw = await session.request<
          Array<LspCodeAction | LspCommand> | null
        >(
          "textDocument/codeAction",
          {
            textDocument: { uri: session.uri },
            range: fromRange(range),
            context: lspContext
          },
          token
        );
        if (!stillBound(session, requestModel, binding)) return null;
        const edits = workspaceEditConverter(session, requestModel);
        return {
          actions: (raw ?? []).map((action) =>
            codeActionFromServer(action, edits, wrapCommand)
          ),
          dispose: () => undefined
        };
      }
    };
    if (resolveSupport) {
      provider.resolveCodeAction = async (action, token) => {
        if (!session.isCurrent()) return action;
        const raw = recallCodeActionOriginal(action);
        if (!raw) return action;
        const binding = session.getBinding();
        if (!binding) return action;
        const resolved = await session.request<LspCodeAction>(
          "codeAction/resolve",
          raw,
          token
        );
        if (!session.isCurrent()) return action;
        const after = session.getBinding();
        if (
          !after ||
          after.model !== binding.model ||
          after.lspVersion !== binding.lspVersion
        ) {
          return action;
        }
        return toMonacoCodeAction(
          resolved,
          workspaceEditConverter(session, after.model),
          wrapCommand
        );
      };
    }
    disposables.push(
      monacoApi.languages.registerCodeActionProvider(
        "cpp",
        provider,
        kinds && kinds.length > 0
          ? { providedCodeActionKinds: [...kinds] }
          : undefined
      )
    );
  }

  if (backend.inlayHint && host.inlayHint) {
    const inlayOptions = session.capabilities.inlayHintProvider;
    const resolveSupport =
      typeof inlayOptions === "object" &&
      inlayOptions.resolveProvider === true;
    const provider: monaco.languages.InlayHintsProvider = {
      provideInlayHints: async (requestModel, range, token) => {
        if (!currentBinding(session, requestModel)) return null;
        const binding = session.getBinding();
        if (!binding) return null;
        const raw = await session.request<LspInlayHint[] | null>(
          "textDocument/inlayHint",
          {
            textDocument: { uri: session.uri },
            range: fromRange(range)
          },
          token
        );
        if (!stillBound(session, requestModel, binding)) return null;
        return {
          hints: raw ? toMonacoInlayHints(raw, wrapCommand) : [],
          dispose: () => undefined
        };
      }
    };
    if (resolveSupport) {
      provider.resolveInlayHint = async (hint, token) => {
        if (!session.isCurrent()) return hint;
        const raw = recallInlayHintOriginal(hint);
        if (!raw) return hint;
        const binding = session.getBinding();
        if (!binding) return hint;
        const resolved = await session.request<LspInlayHint>(
          "inlayHint/resolve",
          raw,
          token
        );
        if (!session.isCurrent()) return hint;
        const after = session.getBinding();
        if (
          !after ||
          after.model !== binding.model ||
          after.lspVersion !== binding.lspVersion
        ) {
          return hint;
        }
        return toMonacoInlayHint(resolved, wrapCommand);
      };
    }
    disposables.push(
      monacoApi.languages.registerInlayHintsProvider("cpp", provider)
    );
  }

  if (backend.semanticTokens && host.semanticTokens) {
    const semantic = session.capabilities.semanticTokensProvider;
    const legend =
      semantic && typeof semantic === "object" && "legend" in semantic
        ? semantic.legend
        : null;
    if (legend) {
      disposables.push(
        monacoApi.languages.registerDocumentSemanticTokensProvider("cpp", {
          getLegend: () => ({
            tokenTypes: [...legend.tokenTypes],
            tokenModifiers: [...legend.tokenModifiers]
          }),
          provideDocumentSemanticTokens: async (
            requestModel,
            _lastResultId,
            token
          ) => {
            if (!currentBinding(session, requestModel)) return null;
            const binding = session.getBinding();
            if (!binding) return null;
            const raw = await session.request<LspSemanticTokens | null>(
              "textDocument/semanticTokens/full",
              { textDocument: { uri: session.uri } },
              token
            );
            if (!stillBound(session, requestModel, binding)) return null;
            return raw ? toMonacoSemanticTokens(raw) : null;
          },
          releaseDocumentSemanticTokens: (_resultId) => {
            // Full requests only; no incremental result resources to release.
          }
        })
      );
    }
  }

  return {
    dispose: () => {
      for (const disposable of disposables.splice(0)) {
        disposable.dispose();
      }
    }
  };
}
