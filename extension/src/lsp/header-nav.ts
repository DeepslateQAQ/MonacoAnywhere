/*
 * Ctrl/Cmd-click navigation for server-provided file URIs (clangd headers).
 * The opener only reacts to the exact bound editor of this session; mapping
 * comes exclusively from session.readFile. Missing content returns false
 * rather than fabricating an empty file. Viewer models are read-only and are
 * never the session's writable model.
 */

import type * as monaco from "monaco-editor";
import type { Session } from "./session.js";

export interface HeaderViewerHandle {
  dispose(): void;
}

export type HeaderViewerFactory = (
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  selectionOrPosition: monaco.IRange | monaco.IPosition | undefined
) => HeaderViewerHandle | void;

export interface HeaderNavigationOptions {
  /** Override the built-in floating viewer (e.g. host it in a panel). */
  readonly openViewer?: HeaderViewerFactory;
  readonly languageId?: string;
}

interface ActiveViewer {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  readonly root: HTMLElement;
}

/**
 * Register one editor opener. Only file targets that readFile can resolve are
 * handled. The returned disposable clears the opener and all viewer models.
 */
export function registerHeaderNavigation(
  monacoApi: typeof monaco,
  session: Session,
  options: HeaderNavigationOptions = {}
): monaco.IDisposable {
  const opener = monacoApi.editor.registerEditorOpener;
  if (typeof opener !== "function") {
    return { dispose: () => undefined };
  }

  const languageId = options.languageId ?? "cpp";
  const viewerModels = new Set<monaco.editor.ITextModel>();
  const viewerDisposables = new Set<HeaderViewerHandle>();
  let activeViewer: ActiveViewer | null = null;

  const closeActiveViewer = (): void => {
    if (!activeViewer) return;
    activeViewer.editor.dispose();
    activeViewer.root.remove();
    activeViewer = null;
  };

  const openModel = (
    model: monaco.editor.ITextModel,
    selectionOrPosition: monaco.IRange | monaco.IPosition | undefined
  ): boolean => {
    if (options.openViewer) {
      const handle = options.openViewer(
        monacoApi,
        model,
        selectionOrPosition
      );
      if (handle) viewerDisposables.add(handle);
      return true;
    }
    if (typeof document === "undefined") return false;
    closeActiveViewer();

    const root = document.createElement("div");
    root.className = "ma-header-viewer";
    root.style.cssText = [
      "position:fixed",
      "inset:8vh 8vw",
      "z-index:2147483646",
      "display:flex",
      "flex-direction:column",
      "background:var(--vscode-editor-background,#1e1e1e)",
      "color:var(--vscode-editor-foreground,#d4d4d4)",
      "border:1px solid rgba(127,127,127,.55)",
      "box-shadow:0 18px 60px rgba(0,0,0,.55)",
      "font:13px/1.4 system-ui,sans-serif"
    ].join(";");

    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid rgba(127,127,127,.45)";
    const title = document.createElement("span");
    title.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis";
    title.textContent = model.uri.path;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText = "cursor:pointer";
    close.addEventListener("click", closeActiveViewer);
    bar.append(title, close);

    const host = document.createElement("div");
    host.style.cssText = "flex:1;min-height:0";
    root.append(bar, host);
    document.body.append(root);

    const editor = monacoApi.editor.create(host, {
      model,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false }
    });
    activeViewer = { editor, root };
    navigateViewer(editor, selectionOrPosition);
    return true;
  };

  const disposable = opener({
    openCodeEditor: async (source, resource, selectionOrPosition) => {
      const binding = session.getBinding();
      if (!binding || source !== binding.editor) return false;
      if (!session.isCurrent()) return false;
      if (resource.scheme !== "file") return false;
      const target = resource.toString();
      if (session.isBoundUri(target)) return false;

      const text = await session.readFile(target);
      if (text === null) return false;
      if (!session.isCurrent()) return false;
      const current = session.getBinding();
      if (!current || current.editor !== source) return false;

      let model = monacoApi.editor.getModel(resource);
      if (model && model.isDisposed()) model = null;
      if (!model) {
        model = monacoApi.editor.createModel(text, languageId, resource);
        viewerModels.add(model);
      }
      return openModel(model, selectionOrPosition);
    }
  });

  return {
    dispose: () => {
      disposable.dispose();
      closeActiveViewer();
      for (const handle of viewerDisposables) handle.dispose();
      viewerDisposables.clear();
      for (const model of viewerModels) {
        if (!model.isDisposed()) model.dispose();
      }
      viewerModels.clear();
    }
  };
}

function navigateViewer(
  editor: monaco.editor.IStandaloneCodeEditor,
  selectionOrPosition: monaco.IRange | monaco.IPosition | undefined
): void {
  if (!selectionOrPosition) {
    editor.focus();
    return;
  }
  if ("startLineNumber" in selectionOrPosition) {
    editor.setSelection(selectionOrPosition);
    editor.revealRangeInCenter(selectionOrPosition);
  } else {
    editor.setPosition(selectionOrPosition);
    editor.revealPositionInCenter(selectionOrPosition);
  }
  editor.focus();
}
