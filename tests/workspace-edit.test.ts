import { describe, expect, it } from "vitest";

import {
  applyWorkspaceEdit,
  toVersionedWorkspaceEdit,
  validateWorkspaceEdit,
  type WorkspaceEditContext,
  type WorkspaceEditEditor,
  type WorkspaceEditSingleEditOperation,
  type WorkspaceEditTextModel
} from "../extension/src/lsp/workspace-edit";
import type {
  Range,
  TextDocumentEdit,
  WorkspaceEdit
} from "vscode-languageserver-protocol";

const URI = "file:///workspace/ma-7/main.cpp";

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): Range {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter }
  };
}

interface FakeModel extends WorkspaceEditTextModel {
  readonly initialVersion: number;
  readonly text: string;
  readonly disposed: boolean;
}

function fakeModel(
  text = "int main() {}",
  version = 42,
  disposed = false
): FakeModel {
  const lines = text.split("\n");
  return {
    initialVersion: version,
    text,
    disposed,
    getVersionId: () => version,
    getValue: () => text,
    isDisposed: () => disposed,
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? ""
  };
}

interface Harness {
  readonly model: FakeModel;
  readonly editor: WorkspaceEditEditor;
  readonly context: WorkspaceEditContext;
  readonly calls: Array<{
    readonly source: string | null | undefined;
    readonly edits: readonly WorkspaceEditSingleEditOperation[];
    readonly endCursorState: unknown;
  }>;
  readonly undoStops: () => number;
}

function harness(options: {
  readonly text?: string;
  readonly version?: number;
  readonly syncVersion?: number;
  readonly lspVersion?: number;
  readonly current?: boolean;
  readonly acceptEdits?: boolean;
  readonly attached?: boolean;
} = {}): Harness {
  const model = fakeModel(
    options.text ?? "int main() {}",
    options.version ?? 42
  );
  const calls: Harness["calls"] = [];
  let undoStops = 0;
  const editor: WorkspaceEditEditor = {
    getModel: () => (options.attached === false ? null : model),
    executeEdits: (source, edits, endCursorState) => {
      calls.push({ source, edits, endCursorState });
      return options.acceptEdits !== false;
    },
    pushUndoStop: () => {
      undoStops += 1;
      return true;
    }
  };
  const context: WorkspaceEditContext = {
    model,
    editor,
    lspUri: URI,
    lspVersion: options.lspVersion ?? 1,
    monacoVersionAtSync: options.syncVersion ?? 42,
    isCurrent: () => options.current !== false
  };
  return {
    model,
    editor,
    context,
    calls,
    undoStops: () => undoStops
  };
}

function textDocumentEdit(
  version: number | null,
  edits: TextDocumentEdit["edits"],
  uri = URI
): TextDocumentEdit {
  return {
    textDocument: { uri, version },
    edits
  };
}

describe("workspace edit acceptance and version mapping", () => {
  it("validates and applies one versioned edit through executeEdits", () => {
    const test = harness();
    const edit: WorkspaceEdit = {
      documentChanges: [
        textDocumentEdit(1, [
          { range: range(0, 0, 0, 3), newText: "long" }
        ])
      ]
    };

    const result = applyWorkspaceEdit(edit, test.context);
    expect(result).toEqual({ applied: true, versionId: 42 });
    expect(test.calls).toHaveLength(1);
    expect(test.calls[0]?.source).toBe("ma");
    expect(test.calls[0]?.edits).toEqual([
      {
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 4
        },
        text: "long"
      }
    ]);
    expect(test.calls[0]?.endCursorState).toEqual([]);
    expect(test.undoStops()).toBe(2);
  });

  it("maps a retained Monaco model version greater than 1 separately from LSP version 1", () => {
    const test = harness({ version: 42, syncVersion: 42 });
    const edit: WorkspaceEdit = {
      documentChanges: [
        textDocumentEdit(1, [
          { range: range(0, 0, 0, 3), newText: "long" }
        ])
      ]
    };
    const versioned = toVersionedWorkspaceEdit(edit, test.context);
    expect(versioned.ok).toBe(true);
    if (!versioned.ok) return;
    expect(versioned.versionId).toBe(42);
    expect(test.calls).toHaveLength(0);
  });

  it("accepts a null document version only while the captured model is unchanged", () => {
    const test = harness();
    const edit: WorkspaceEdit = {
      documentChanges: [
        textDocumentEdit(null, [
          { range: range(0, 0, 0, 0), newText: "// " }
        ])
      ]
    };
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(true);
    const versioned = toVersionedWorkspaceEdit(edit, test.context);
    expect(versioned.ok && versioned.versionId).toBe(42);
  });

  it("takes documentChanges precedence and ignores a conflicting changes map", () => {
    const test = harness();
    const edit: WorkspaceEdit = {
      documentChanges: [
        textDocumentEdit(1, [
          { range: range(0, 0, 0, 3), newText: "long" }
        ])
      ],
      changes: {
        "file:///workspace/ma-7/other.cpp": [
          { range: range(0, 0, 0, 1), newText: "x" }
        ]
      }
    };
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.edits).toHaveLength(1);
    expect(validation.edits[0]?.newText).toBe("long");
  });

  it("does not fall back to changes when documentChanges is malformed", () => {
    const test = harness();
    const edit = {
      documentChanges: "not-an-array",
      changes: {
        [URI]: [{ range: range(0, 0, 0, 1), newText: "x" }]
      }
    } as unknown as WorkspaceEdit;
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.code).toBe("malformed");
  });
});

describe("workspace edit rejection matrix", () => {
  it("rejects resource operations explicitly", () => {
    const test = harness();
    const edit = {
      documentChanges: [
        {
          kind: "rename",
          oldUri: URI,
          newUri: "file:///workspace/ma-7/renamed.cpp"
        }
      ]
    } as unknown as WorkspaceEdit;
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.code).toBe("resource-operations-unsupported");
  });

  it("rejects cross-file changes", () => {
    const test = harness();
    const edit: WorkspaceEdit = {
      changes: {
        "file:///workspace/ma-7/other.cpp": [
          { range: range(0, 0, 0, 1), newText: "x" }
        ]
      }
    };
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.code).toBe("cross-file");
  });

  it("rejects a mismatched LSP document version", () => {
    const test = harness();
    const edit: WorkspaceEdit = {
      documentChanges: [
        textDocumentEdit(2, [
          { range: range(0, 0, 0, 1), newText: "x" }
        ])
      ]
    };
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.code).toBe("version-mismatch");
  });

  it("rejects a model changed after the request context was captured", () => {
    const test = harness({ version: 43, syncVersion: 42 });
    const edit: WorkspaceEdit = {
      documentChanges: [
        textDocumentEdit(1, [
          { range: range(0, 0, 0, 1), newText: "x" }
        ])
      ]
    };
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.code).toBe("model-changed");
  });

  it("rejects a stale session generation", () => {
    const test = harness({ current: false });
    const edit: WorkspaceEdit = {
      changes: {
        [URI]: [{ range: range(0, 0, 0, 1), newText: "x" }]
      }
    };
    const validation = validateWorkspaceEdit(edit, test.context);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.code).toBe("stale-session");
  });

  it("rejects out-of-bounds lines and columns", () => {
    const test = harness();
    const badLine: WorkspaceEdit = {
      changes: {
        [URI]: [{ range: range(10, 0, 10, 1), newText: "x" }]
      }
    };
    const lineResult = validateWorkspaceEdit(badLine, test.context);
    expect(lineResult.ok).toBe(false);
    if (!lineResult.ok) expect(lineResult.code).toBe("out-of-bounds");

    const badColumn: WorkspaceEdit = {
      changes: {
        [URI]: [{ range: range(0, 0, 0, 99), newText: "x" }]
      }
    };
    const columnResult = validateWorkspaceEdit(badColumn, test.context);
    expect(columnResult.ok).toBe(false);
    if (!columnResult.ok) expect(columnResult.code).toBe("out-of-bounds");
  });

  it("rejects overlapping edits and ambiguous insertions", () => {
    const test = harness();
    const overlap: WorkspaceEdit = {
      changes: {
        [URI]: [
          { range: range(0, 0, 0, 4), newText: "aaaa" },
          { range: range(0, 3, 0, 6), newText: "bbbb" }
        ]
      }
    };
    const overlapResult = validateWorkspaceEdit(overlap, test.context);
    expect(overlapResult.ok).toBe(false);
    if (!overlapResult.ok) {
      expect(overlapResult.code).toBe("overlapping-edits");
    }

    const duplicateInsert: WorkspaceEdit = {
      changes: {
        [URI]: [
          { range: range(0, 0, 0, 0), newText: "a" },
          { range: range(0, 0, 0, 0), newText: "b" }
        ]
      }
    };
    const duplicateResult = validateWorkspaceEdit(duplicateInsert, test.context);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.code).toBe("overlapping-edits");
    }
  });

  it("rejects malformed ranges and non-object edits", () => {
    const test = harness();
    const malformed = {
      changes: {
        [URI]: [{ range: { start: { line: 0 } }, newText: "x" }]
      }
    } as unknown as WorkspaceEdit;
    const validation = validateWorkspaceEdit(malformed, test.context);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.code).toBe("malformed");
  });

  it("reports editor rejection without attempting a partial second apply", () => {
    const test = harness({ acceptEdits: false });
    const edit: WorkspaceEdit = {
      changes: {
        [URI]: [{ range: range(0, 0, 0, 1), newText: "x" }]
      }
    };
    const result = applyWorkspaceEdit(edit, test.context);
    expect(result.applied).toBe(false);
    if (result.applied) return;
    expect(result.failureReason).toMatch(/rejected/);
    expect(test.calls).toHaveLength(1);
  });

  it("refuses to apply to an editor attached to another model", () => {
    const test = harness({ attached: false });
    const edit: WorkspaceEdit = {
      changes: {
        [URI]: [{ range: range(0, 0, 0, 1), newText: "x" }]
      }
    };
    const result = applyWorkspaceEdit(edit, test.context);
    expect(result.applied).toBe(false);
    if (result.applied) return;
    expect(result.failureReason).toMatch(/not attached/);
    expect(test.calls).toHaveLength(0);
  });

  it("returns a no-op success for an empty documentChanges array", () => {
    const test = harness();
    const result = applyWorkspaceEdit({ documentChanges: [] }, test.context);
    expect(result.applied).toBe(true);
    expect(test.calls).toHaveLength(0);
  });
});
