/*
 * The single validated write path for LSP WorkspaceEdits.
 *
 * Raw protocol data is validated before any conversion or mutation. Only the
 * currently bound, writable document may be edited. documentChanges take
 * precedence over changes and are never merged. Resource operations are
 * rejected explicitly. Versions are compared against both LSP synchronization
 * state and the real Monaco model version, which may already be greater than 1
 * when an existing model is attached to a new session.
 */

import type {
  Position,
  Range,
  TextEdit,
  WorkspaceEdit
} from "vscode-languageserver-protocol";

import { isRecord } from "./json.js";

export interface MonacoWorkspaceRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export interface WorkspaceEditTextModel {
  getVersionId(): number;
  getValue(): string;
  isDisposed?(): boolean;
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
}

export interface WorkspaceEditSingleEditOperation {
  readonly range: MonacoWorkspaceRange;
  readonly text: string | null;
  readonly forceMoveMarkers?: boolean;
}

export interface WorkspaceEditEditor {
  getModel(): WorkspaceEditTextModel | null;
  executeEdits(
    source: string | null | undefined,
    edits: WorkspaceEditSingleEditOperation[],
    endCursorState?: unknown
  ): boolean;
  pushUndoStop?(): boolean;
}

export interface WorkspaceEditContext {
  readonly model: WorkspaceEditTextModel;
  readonly editor: WorkspaceEditEditor;
  /** LSP URI of the one writable document. */
  readonly lspUri: string;
  /** LSP document version currently synchronized. */
  readonly lspVersion: number;
  /** Real Monaco getVersionId() captured at the last didOpen/didChange. */
  readonly monacoVersionAtSync: number;
  /** Optional session-generation/current guard. */
  readonly isCurrent?: () => boolean;
}

export type WorkspaceEditFailureCode =
  | "malformed"
  | "resource-operations-unsupported"
  | "cross-file"
  | "version-mismatch"
  | "model-changed"
  | "stale-session"
  | "out-of-bounds"
  | "overlapping-edits"
  | "editor-mismatch"
  | "apply-failed";

export interface ValidatedTextEdit {
  readonly range: Range;
  readonly newText: string;
}

export type WorkspaceEditValidation =
  | {
      readonly ok: true;
      readonly edits: readonly ValidatedTextEdit[];
    }
  | {
      readonly ok: false;
      readonly code: WorkspaceEditFailureCode;
      readonly reason: string;
    };

export type VersionedWorkspaceEdit =
  | {
      readonly ok: true;
      readonly edits: readonly {
        readonly range: MonacoWorkspaceRange;
        readonly text: string;
      }[];
      readonly versionId: number;
    }
  | {
      readonly ok: false;
      readonly code: WorkspaceEditFailureCode;
      readonly reason: string;
    };

export type ApplyWorkspaceEditResult =
  | { readonly applied: true; readonly versionId: number }
  | { readonly applied: false; readonly failureReason: string };

interface EditRecord {
  readonly uri: string;
  readonly version: number | null;
  readonly edits: readonly TextEdit[];
}

interface ValidationState {
  readonly model: WorkspaceEditTextModel;
  readonly ctx: WorkspaceEditContext;
}

function reject(
  code: WorkspaceEditFailureCode,
  reason: string
): { readonly ok: false; readonly code: WorkspaceEditFailureCode; readonly reason: string } {
  return { ok: false, code, reason };
}

function currentContextError(
  state: ValidationState
): { readonly ok: false; readonly code: WorkspaceEditFailureCode; readonly reason: string } | null {
  const { model, ctx } = state;
  if (model.isDisposed?.()) {
    return reject("model-changed", "The bound model has been disposed.");
  }
  if (ctx.isCurrent && !ctx.isCurrent()) {
    return reject("stale-session", "The language session is no longer current.");
  }
  if (model.getVersionId() !== ctx.monacoVersionAtSync) {
    return reject(
      "model-changed",
      "The model changed after the request was sent; the edit is stale."
    );
  }
  return null;
}

function readPosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const line = value["line"];
  const character = value["character"];
  if (
    typeof line !== "number" ||
    typeof character !== "number" ||
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return null;
  }
  return { line, character };
}

function readRange(value: unknown): Range | null {
  if (!isRecord(value)) return null;
  const start = readPosition(value["start"]);
  const end = readPosition(value["end"]);
  if (!start || !end) return null;
  return { start, end };
}

function validatePosition(
  position: Position,
  model: WorkspaceEditTextModel
): string | null {
  const lineCount = model.getLineCount();
  if (!Number.isInteger(lineCount) || lineCount < 1) {
    return "The model reports an invalid line count.";
  }
  if (position.line >= lineCount) {
    return `Line ${position.line + 1} is outside the model (${lineCount} lines).`;
  }
  const lineLength = model.getLineContent(position.line + 1).length;
  if (position.character > lineLength) {
    return `Column ${position.character + 1} is outside line ${position.line + 1}.`;
  }
  return null;
}

function comparePositions(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

function readTextEdits(value: unknown): TextEdit[] | null {
  if (!Array.isArray(value)) return null;
  const edits: TextEdit[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const range = readRange(candidate["range"]);
    const newText = candidate["newText"];
    if (!range || typeof newText !== "string") return null;
    edits.push({ range, newText });
  }
  return edits;
}

function readTextDocumentEdit(value: unknown): EditRecord | null {
  if (!isRecord(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, "kind")) return null;
  const textDocument = value["textDocument"];
  if (!isRecord(textDocument)) return null;
  const uri = textDocument["uri"];
  const version = textDocument["version"];
  if (typeof uri !== "string") return null;
  if (
    version !== null &&
    (typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 0)
  ) {
    return null;
  }
  const edits = readTextEdits(value["edits"]);
  if (!edits) return null;
  return { uri, version, edits };
}

/**
 * Validate the whole edit before conversion or mutation.
 *
 * The returned `edits` are exactly the raw LSP text edits that will be applied;
 * no caller may add or merge another source after this function succeeds.
 */
export function validateWorkspaceEdit(
  raw: unknown,
  ctx: WorkspaceEditContext
): WorkspaceEditValidation {
  const state: ValidationState = { model: ctx.model, ctx };
  const contextError = currentContextError(state);
  if (contextError) return contextError;

  if (!isRecord(raw)) {
    return reject("malformed", "The workspace edit is not an object.");
  }

  const hasDocumentChanges =
    Object.prototype.hasOwnProperty.call(raw, "documentChanges") &&
    raw["documentChanges"] !== undefined;

  const records: EditRecord[] = [];
  if (hasDocumentChanges) {
    const documentChanges = raw["documentChanges"];
    if (!Array.isArray(documentChanges)) {
      return reject("malformed", "documentChanges must be an array.");
    }
    for (const change of documentChanges) {
      if (isRecord(change) && Object.prototype.hasOwnProperty.call(change, "kind")) {
        return reject(
          "resource-operations-unsupported",
          "File create, rename and delete operations are not supported."
        );
      }
      const record = readTextDocumentEdit(change);
      if (!record) {
        return reject(
          "malformed",
          "documentChanges contains an invalid TextDocumentEdit."
        );
      }
      records.push(record);
    }
  } else {
    const changes = raw["changes"];
    if (changes === undefined) {
      return reject("malformed", "The workspace edit has no changes.");
    }
    if (!isRecord(changes)) {
      return reject("malformed", "changes must be an object keyed by URI.");
    }
    for (const [uri, value] of Object.entries(changes)) {
      const edits = readTextEdits(value);
      if (!edits) {
        return reject("malformed", `changes for ${uri} is not a text edit array.`);
      }
      // Unversioned `changes` entries are only safe while the model is exactly
      // the one captured when the request context was created.
      records.push({ uri, version: null, edits });
    }
  }

  const validated: ValidatedTextEdit[] = [];
  for (const record of records) {
    if (record.uri !== ctx.lspUri) {
      return reject(
        "cross-file",
        `The workspace edit targets ${record.uri}, not the bound document.`
      );
    }
    if (record.version !== null && record.version !== ctx.lspVersion) {
      return reject(
        "version-mismatch",
        `The edit targets LSP version ${record.version}; the bound version is ${ctx.lspVersion}.`
      );
    }
    for (const edit of record.edits) {
      const startError = validatePosition(edit.range.start, ctx.model);
      if (startError) return reject("out-of-bounds", startError);
      const endError = validatePosition(edit.range.end, ctx.model);
      if (endError) return reject("out-of-bounds", endError);
      if (comparePositions(edit.range.start, edit.range.end) > 0) {
        return reject("out-of-bounds", "The edit range ends before it starts.");
      }
      validated.push({ range: edit.range, newText: edit.newText });
    }
  }

  const sorted = [...validated].sort((a, b) => {
    const start = comparePositions(a.range.start, b.range.start);
    if (start !== 0) return start;
    return comparePositions(a.range.end, b.range.end);
  });
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    if (
      comparePositions(current.range.start, previous.range.end) < 0 ||
      comparePositions(current.range.start, previous.range.start) === 0
    ) {
      return reject(
        "overlapping-edits",
        "The workspace edit contains overlapping or ambiguous ranges."
      );
    }
  }

  const finalContextError = currentContextError(state);
  if (finalContextError) return finalContextError;
  return { ok: true, edits: validated };
}

function toMonacoRange(range: Range): MonacoWorkspaceRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  };
}

/**
 * Validate and convert to the exact versioned edits a Monaco provider should
 * return. Monaco applies these once; the provider must not pre-apply them.
 * `versionId` is the real Monaco model version, never the LSP version.
 */
export function toVersionedWorkspaceEdit(
  raw: unknown,
  ctx: WorkspaceEditContext
): VersionedWorkspaceEdit {
  const validation = validateWorkspaceEdit(raw, ctx);
  if (!validation.ok) return validation;
  return {
    ok: true,
    versionId: ctx.monacoVersionAtSync,
    edits: validation.edits.map((edit) => ({
      range: toMonacoRange(edit.range),
      text: edit.newText
    }))
  };
}

/**
 * Validate every edit, then apply the whole batch exactly once through
 * editor.executeEdits. A failed or mismatched editor returns a protocol
 * failure instead of partially applying anything.
 */
export function applyWorkspaceEdit(
  raw: unknown,
  ctx: WorkspaceEditContext
): ApplyWorkspaceEditResult {
  const validation = validateWorkspaceEdit(raw, ctx);
  if (!validation.ok) {
    return { applied: false, failureReason: validation.reason };
  }

  if (validation.edits.length === 0) {
    return { applied: true, versionId: ctx.monacoVersionAtSync };
  }
  if (ctx.isCurrent && !ctx.isCurrent()) {
    return {
      applied: false,
      failureReason: "The language session is no longer current."
    };
  }
  if (ctx.editor.getModel() !== ctx.model) {
    return {
      applied: false,
      failureReason: "The editor is not attached to the bound model."
    };
  }

  const edits: WorkspaceEditSingleEditOperation[] = validation.edits.map(
    (edit) => ({
      range: toMonacoRange(edit.range),
      text: edit.newText
    })
  );

  try {
    ctx.editor.pushUndoStop?.();
    const applied = ctx.editor.executeEdits("ma", edits, []);
    ctx.editor.pushUndoStop?.();
    if (!applied) {
      return {
        applied: false,
        failureReason: "The editor rejected the workspace edit."
      };
    }
    return { applied: true, versionId: ctx.monacoVersionAtSync };
  } catch (cause) {
    return {
      applied: false,
      failureReason:
        cause instanceof Error
          ? cause.message
          : "The editor threw while applying the workspace edit."
    };
  }
}

/** Alias kept for protocol handlers that name the operation explicitly. */
export function validateAndApply(
  edit: WorkspaceEdit,
  ctx: WorkspaceEditContext
): ApplyWorkspaceEditResult {
  return applyWorkspaceEdit(edit, ctx);
}
