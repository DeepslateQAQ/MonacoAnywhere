/*
 * Hydro adapter.
 *
 * Hydro is the only retained-Monaco site. When `.ScratchpadMonacoEditor` and
 * a validated `window.editor` exist, the site editor/model are used directly.
 * Otherwise (including the real submit pages observed in reconnaissance) a
 * plain `textarea[name="code"]` is treated as a replacement slot. This adapter
 * never creates, rebuilds or unmounts Monaco.
 *
 * Language options come from the native `select[name="lang"]`; `window.LANGS`
 * supplies display names and disabled/hidden flags. Only explicit C++NN text
 * establishes a standard. The compiler dialect is intentionally unverified.
 */

import {
  resolveSiteOptions,
  type HydroLanguages,
  type HydroLanguageValue,
  type SiteProfileResolution
} from "../profiles/builtin.js";
import { parseStandard } from "../profiles/types.js";
import {
  EchoGuard,
  SiteBridgeError,
  cssPathFor,
  dispatchDomEvent,
  isElementVisible,
  isRecordValue,
  normalizeLabel,
  optionDisabled,
  optionLabel,
  optionsOfSelect,
  pathnameFromLocation,
  selectedOption,
  siteOriginKey,
  type EditorSlot,
  type LanguageChangeListener,
  type LanguageControl,
  type LanguageOption,
  type LanguageOptionSet,
  type LocationLike,
  type MonacoDisposableLike,
  type MonacoEditorLike,
  type MonacoModelLike,
  type MonacoNamespaceLike,
  type NativeChangeListener,
  type SiteAdapter,
  type SiteContextInfo,
  type SiteEnvironment,
  type SiteRemoteStatus,
  type WriteOrigin
} from "./types.js";

const MONACO_CONTAINER = ".ScratchpadMonacoEditor";
const LANGUAGE_SELECT = 'select[name="lang"]';
const TEXTAREA_SELECT = 'textarea[name="code"]';

export interface HydroAdapter extends SiteAdapter {
  readonly id: "hydro";
  remoteLsp(): SiteRemoteStatus;
}

export function hydroOriginKey(
  location?: LocationLike | null
): string {
  return siteOriginKey("hydro", location);
}

export function hydroProblemKey(
  location?: LocationLike | null
): string {
  const path = pathnameFromLocation(location);
  const rest = path.replace(/^\/d\/[^/]+/, "");
  const problem = /(?:^|\/)p\/([^/]+)/.exec(rest);
  if (problem?.[1]) return `p:${problem[1]}`;
  const homework = /(?:^|\/)homework\/([^/]+)/.exec(rest);
  if (homework?.[1]) return `homework:${homework[1]}`;
  if (/(?:^|\/)scratchpad(?:\/|$)/.test(rest)) return "scratchpad";
  return rest.replace(/\/+$/, "") || "unknown";
}

/** Read the page globals without accepting an arbitrary object protocol. */
export function readPageGlobal(
  win: Window | null | undefined,
  key: string
): unknown {
  if (!win || typeof key !== "string" || !key) return undefined;
  return Reflect.get(win, key) as unknown;
}

export function readHydroUiContext(
  win: Window | null | undefined
): Record<string, unknown> | null {
  const raw = readPageGlobal(win, "UiContext");
  return isRecordValue(raw) ? raw : null;
}

export function hydroAccountScope(
  win: Window | null | undefined
): string {
  const context = readHydroUiContext(win);
  const user = context?.user;
  if (!isRecordValue(user)) return "anon";
  const id = user._id ?? user.uname ?? user.name ?? user.username;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id.trim()) return id.trim();
  return "anon";
}

/** The exact site-provided submit URL; never assembled from parts. */
export function hydroPostSubmitUrl(
  win: Window | null | undefined
): string | null {
  const context = readHydroUiContext(win);
  const url = context?.postSubmitUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

export function readHydroLanguages(
  win: Window | null | undefined
): HydroLanguages {
  const raw = readPageGlobal(win, "LANGS");
  if (!isRecordValue(raw)) return {};
  // isRecordValue validates the container; entries are checked by the parser
  // (string or object with optional display/hidden/disabled fields).
  return raw as HydroLanguages;
}

function moduleName(value: unknown): string | null {
  if (typeof value === "string") {
    const name = normalizeLabel(value);
    return name || null;
  }
  if (!isRecordValue(value)) return null;
  for (const key of ["name", "id", "module", "package"]) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      const name = normalizeLabel(candidate);
      if (name) return name;
    }
  }
  return null;
}

/** Feature names from `window.externalModules` (recon observed strings). */
export function readHydroExternalModules(
  win: Window | null | undefined
): string[] {
  const raw = readPageGlobal(win, "externalModules");
  const names: string[] = [];
  if (typeof raw === "string") {
    names.push(raw);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      const name = moduleName(item);
      if (name) names.push(name);
    }
  } else if (raw instanceof Set) {
    for (const item of raw) {
      const name = moduleName(item);
      if (name) names.push(name);
    }
  } else if (isRecordValue(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const name = moduleName(value) ?? normalizeLabel(key);
      if (name) names.push(name);
    }
  }
  return Array.from(
    new Set(names.map(normalizeLabel).filter((name) => name.length > 0))
  );
}

export function detectHydroSiteRemote(
  win: Window | null | undefined
): SiteRemoteStatus {
  const context = readHydroUiContext(win);
  const rawHost = context?.lspHost;
  const lspHost =
    typeof rawHost === "string" && rawHost.trim()
      ? rawHost.trim()
      : null;
  const features = readHydroExternalModules(win);
  const hasCppLsp = features.some((feature) =>
    feature.includes("monaco-cpp@lsp")
  );
  const rawModules = readPageGlobal(win, "externalModules");
  const malformedModules =
    rawModules !== undefined &&
    rawModules !== null &&
    typeof rawModules !== "string" &&
    !Array.isArray(rawModules) &&
    !(rawModules instanceof Set) &&
    !isRecordValue(rawModules);
  if (lspHost || hasCppLsp) {
    return {
      state: "active",
      lspHost,
      features,
      ...(malformedModules
        ? {
            reason:
              "Site remote LSP is active, but externalModules had an unrecognised shape."
          }
        : {})
    };
  }
  if (malformedModules) {
    return {
      state: "unsupported",
      lspHost,
      features,
      reason:
        "Hydro's externalModules value is present but could not be interpreted; remote LSP status is unknown."
    };
  }
  return { state: "none", lspHost, features };
}

function isMonacoModel(value: unknown): value is MonacoModelLike {
  return (
    isRecordValue(value) &&
    typeof value.getValue === "function" &&
    typeof value.getFullModelRange === "function"
  );
}

function isMonacoEditor(value: unknown): value is MonacoEditorLike {
  return (
    isRecordValue(value) &&
    typeof value.getModel === "function" &&
    typeof value.executeEdits === "function"
  );
}

function readMonacoNamespace(
  win: Window | null | undefined
): MonacoNamespaceLike | null {
  const value = readPageGlobal(win, "monaco");
  if (!isRecordValue(value)) return null;
  const editor = value.editor;
  if (!isRecordValue(editor)) return null;
  if (typeof editor.getEditors !== "function") return null;
  return value as unknown as MonacoNamespaceLike;
}

function readMonacoEditor(
  win: Window | null | undefined
): MonacoEditorLike | null {
  const value = readPageGlobal(win, "editor");
  return isMonacoEditor(value) ? value : null;
}

function queryElements(
  doc: Document | null,
  selector: string
): HTMLElement[] {
  if (!doc) return [];
  try {
    return Array.from(doc.querySelectorAll(selector)).filter(
      (element): element is HTMLElement => element.nodeType === 1
    );
  } catch {
    return [];
  }
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof value.nodeType === "number"
  );
}

interface MonacoSlotHandle {
  readonly container: HTMLElement;
  readonly editor: MonacoEditorLike;
  readonly model: MonacoModelLike;
}

function findMonacoSlot(
  doc: Document | null,
  win: Window | null
): MonacoSlotHandle | null {
  if (!doc) return null;
  const namespace = readMonacoNamespace(win);
  const editor = readMonacoEditor(win);
  if (!namespace || !editor) return null;
  let editors: readonly MonacoEditorLike[];
  try {
    editors = namespace.editor.getEditors?.() ?? [];
  } catch {
    return null;
  }
  if (!Array.isArray(editors) || !editors.includes(editor)) return null;
  let modelValue: unknown;
  try {
    modelValue = editor.getModel();
  } catch {
    return null;
  }
  if (!isMonacoModel(modelValue)) return null;

  const containers = queryElements(doc, MONACO_CONTAINER);
  if (containers.length === 0) return null;
  let domNode: unknown = null;
  if (typeof editor.getDomNode === "function") {
    try {
      domNode = editor.getDomNode();
    } catch {
      domNode = null;
    }
  }
  let container: HTMLElement | null = null;
  if (domNode !== null && isNode(domNode)) {
    const matching = containers.filter(
      (candidate) =>
        candidate === domNode || candidate.contains(domNode)
    );
    if (matching.length === 1) container = matching[0] ?? null;
    else return null;
  } else if (containers.length === 1) {
    container = containers[0] ?? null;
  }
  if (!container) return null;
  return { container, editor, model: modelValue };
}

function findTextarea(doc: Document | null): HTMLTextAreaElement | null {
  if (!doc) return null;
  const candidates = queryElements(doc, TEXTAREA_SELECT).filter(
    (element) =>
      "value" in element &&
      typeof element.value === "string" &&
      isElementVisible(element)
  );
  if (candidates.length !== 1) return null;
  return (candidates[0] as HTMLTextAreaElement) ?? null;
}

interface LanguageSelectLookup {
  readonly select: HTMLSelectElement | null;
  readonly reason: string | null;
}

function findLanguageSelect(doc: Document | null): LanguageSelectLookup {
  if (!doc) {
    return {
      select: null,
      reason: "The Hydro language select is unavailable without a document."
    };
  }
  const named = queryElements(doc, LANGUAGE_SELECT).filter((element) =>
    isElementVisible(element)
  );
  let selects = named;
  if (selects.length === 0) {
    // The online IDE uses a generic `<select class="select">` in its toolbar.
    // Accept one only when it visibly carries C++ options.
    const generic = queryElements(doc, "select.select").filter((element) => {
      if (!("options" in element) || !isElementVisible(element)) return false;
      return optionsOfSelect(element as HTMLSelectElement).some((option) =>
        /c\+\+/i.test(optionLabel(option))
      );
    });
    if (generic.length > 0) selects = generic;
  }
  if (selects.length === 0) return { select: null, reason: null };
  if (selects.length > 1) {
    return {
      select: null,
      reason: `Multiple Hydro select[name="lang"] controls (${selects.length}); refusing to guess.`
    };
  }
  const element = selects[0];
  if (!element || !("options" in element)) {
    return {
      select: null,
      reason: "The Hydro language control is not a native select with options."
    };
  }
  return { select: element as HTMLSelectElement, reason: null };
}

function hydroLangEntry(
  languages: HydroLanguages,
  optionId: string
): HydroLanguageValue {
  return languages[optionId];
}

function hydroLangInfo(
  languages: HydroLanguages,
  optionId: string
): {
  readonly display: string;
  readonly disabled: boolean;
  readonly monaco: string | null;
} {
  const value = hydroLangEntry(languages, optionId);
  if (typeof value === "string") {
    return {
      display: normalizeLabel(value),
      disabled: false,
      monaco: null
    };
  }
  if (isRecordValue(value)) {
    return {
      display:
        typeof value.display === "string"
          ? normalizeLabel(value.display)
          : "",
      disabled: value.disabled === true || value.hidden === true,
      monaco:
        typeof value.monaco === "string" ? value.monaco : null
    };
  }
  return { display: "", disabled: false, monaco: null };
}

function isHydroCppOption(
  option: LanguageOption,
  languages: HydroLanguages
): boolean {
  if (option.optionId.startsWith("cc")) return true;
  const info = hydroLangInfo(languages, option.optionId);
  if (info.monaco === "cpp") return true;
  return parseStandard(option.label) !== null;
}

export function hydroLanguageOptionSet(
  select: HTMLSelectElement | null,
  languages: HydroLanguages
): LanguageOptionSet {
  if (!select) {
    return {
      options: [],
      complete: false,
      reason: "No Hydro select[name=\"lang\"] is available."
    };
  }
  const options: LanguageOption[] = [];
  for (const option of optionsOfSelect(select)) {
    const rawValue = option.value ?? "";
    const info = hydroLangInfo(languages, rawValue);
    const label = optionLabel(option) || info.display;
    if (!label && !rawValue) continue;
    options.push({
      optionId: rawValue,
      label: label || rawValue,
      disabled: optionDisabled(option) || info.disabled,
      dialectVerified: false,
      rawValue
    });
  }
  return {
    options,
    complete: true,
    ...(options.length === 0
      ? { reason: "The Hydro language select has no options." }
      : {})
  };
}

interface MonacoNativeState {
  readonly kind: "monaco";
  readonly element: HTMLElement;
  readonly editor: MonacoEditorLike;
  readonly fallbackModel: MonacoModelLike;
  readonly echo: EchoGuard;
  readonly listeners: Set<NativeChangeListener>;
  detach: (() => void) | null;
}

interface TextareaNativeState {
  readonly kind: "textarea";
  readonly element: HTMLTextAreaElement;
  readonly echo: EchoGuard;
  readonly listeners: Set<NativeChangeListener>;
  detach: (() => void) | null;
}

type NativeState = MonacoNativeState | TextareaNativeState;

interface LanguageState {
  readonly echo: EchoGuard;
  readonly listeners: Set<LanguageChangeListener>;
  detach: (() => void) | null;
}

function currentMonacoModel(
  editor: MonacoEditorLike,
  fallback: MonacoModelLike | null
): MonacoModelLike | null {
  try {
    const value = editor.getModel();
    if (isMonacoModel(value)) return value;
  } catch {
    /* Fall back to the model validated at locate time. */
  }
  return fallback;
}

export function createHydroBridge(
  environment: SiteEnvironment = {}
): HydroAdapter {
  let destroyed = false;
  const nativeStates = new WeakMap<EditorSlot, NativeState>();
  const languageStates = new WeakMap<EditorSlot, LanguageState>();
  const issues = new WeakMap<EditorSlot, string | null>();
  const teardowns = new Set<() => void>();

  const pageDocument = (): Document | null =>
    environment.document ??
    environment.window?.document ??
    (typeof document !== "undefined" ? document : null);

  const pageWindow = (): Window | null =>
    environment.window ??
    pageDocument()?.defaultView ??
    (typeof window !== "undefined" ? window : null);

  const pageLocation = (): LocationLike | null =>
    environment.location ??
    pageWindow()?.location ??
    (typeof location !== "undefined" ? location : null);

  function requireAlive(): void {
    if (destroyed) {
      throw new SiteBridgeError(
        "bridge-destroyed",
        "The Hydro bridge has been destroyed."
      );
    }
  }

  function registerTeardown(fn: () => void): () => void {
    let active = true;
    const once = (): void => {
      if (!active) return;
      active = false;
      teardowns.delete(once);
      try {
        fn();
      } catch {
        /* Teardown must stay deterministic. */
      }
    };
    teardowns.add(once);
    return once;
  }

  function readNativeValue(state: NativeState): string {
    try {
      if (state.kind === "monaco") {
        const model = currentMonacoModel(
          state.editor,
          state.fallbackModel
        );
        if (!model) {
          throw new SiteBridgeError(
            "read-failed",
            "The Hydro Monaco model is unavailable."
          );
        }
        return model.getValue();
      }
      return state.element.value;
    } catch {
      throw new SiteBridgeError(
        "read-failed",
        "The Hydro editor value could not be read."
      );
    }
  }

  function emitNative(state: NativeState): void {
    const observed = state.echo.poll();
    if (!observed) return;
    for (const listener of Array.from(state.listeners)) {
      try {
        listener(observed.value, "user");
      } catch {
        /* One subscriber must not break the others. */
      }
    }
  }

  function attachNative(state: NativeState): void {
    if (state.detach) return;
    state.echo.snapshot();
    if (state.kind === "monaco") {
      const onChange = (): void => emitNative(state);
      let disposable: MonacoDisposableLike | null = null;
      if (typeof state.editor.onDidChangeModelContent === "function") {
        disposable = state.editor.onDidChangeModelContent(onChange);
      } else {
        const model = currentMonacoModel(
          state.editor,
          state.fallbackModel
        );
        if (model?.onDidChangeContent) {
          disposable = model.onDidChangeContent(onChange);
        }
      }
      state.detach = registerTeardown(() => {
        if (disposable) disposable.dispose();
      });
      return;
    }
    const onInput = (): void => emitNative(state);
    state.element.addEventListener("input", onInput);
    state.element.addEventListener("change", onInput);
    state.detach = registerTeardown(() => {
      state.element.removeEventListener("input", onInput);
      state.element.removeEventListener("change", onInput);
    });
  }

  function detachNative(state: NativeState): void {
    const detach = state.detach;
    state.detach = null;
    if (detach) detach();
  }

  function requireNativeState(slot: EditorSlot): NativeState {
    requireAlive();
    const state = nativeStates.get(slot);
    if (!state) {
      throw new SiteBridgeError(
        "unknown-slot",
        "The Hydro slot was not produced by this bridge instance."
      );
    }
    if (
      typeof state.element.isConnected === "boolean" &&
      !state.element.isConnected
    ) {
      throw new SiteBridgeError(
        "slot-stale",
        "The Hydro editor element is no longer connected."
      );
    }
    return state;
  }

  function locate(): EditorSlot[] {
    requireAlive();
    const doc = pageDocument();
    if (!doc) return [];
    const win = pageWindow();
    const monacoSlot = findMonacoSlot(doc, win);
    if (monacoSlot) {
      const slot: EditorSlot = {
        slotId: "main",
        kind: "monaco",
        retainedMonaco: true,
        selector: cssPathFor(monacoSlot.container),
        element: monacoSlot.container,
        monaco: readMonacoNamespace(win) ?? undefined,
        nativeEditor: monacoSlot.editor,
        model: monacoSlot.model
      };
      const monacoEditor = monacoSlot.editor;
      const fallbackModel = monacoSlot.model;
      const state: MonacoNativeState = {
        kind: "monaco",
        element: monacoSlot.container,
        editor: monacoEditor,
        fallbackModel,
        echo: new EchoGuard(() => {
          const model = currentMonacoModel(
            monacoEditor,
            fallbackModel
          );
          return model ? model.getValue() : "";
        }),
        listeners: new Set(),
        detach: null
      };
      nativeStates.set(slot, state);
      return [slot];
    }
    const textarea = findTextarea(doc);
    if (textarea) {
      const slot: EditorSlot = {
        slotId: "main",
        kind: "textarea",
        retainedMonaco: false,
        selector: cssPathFor(textarea),
        element: textarea
      };
      nativeStates.set(slot, {
        kind: "textarea",
        element: textarea,
        echo: new EchoGuard(() => textarea.value),
        listeners: new Set(),
        detach: null
      });
      return [slot];
    }
    return [];
  }

  function setIssue(slot: EditorSlot, reason: string | null): void {
    issues.set(slot, reason);
  }

  function locateControl(slot: EditorSlot): LanguageControl | null {
    requireAlive();
    const lookup = findLanguageSelect(pageDocument());
    if (lookup.reason) {
      setIssue(slot, lookup.reason);
      return { kind: "unsupported", reason: lookup.reason };
    }
    if (!lookup.select) return null;
    setIssue(slot, null);
    return { kind: "select", element: lookup.select };
  }

  function currentOptionId(select: HTMLSelectElement): string | null {
    const option = selectedOption(select);
    if (option) {
      const raw = option.value ?? "";
      return raw || optionLabel(option) || null;
    }
    return typeof select.value === "string" && select.value
      ? select.value
      : null;
  }

  function pageLanguageOptionSet(): LanguageOptionSet {
    const lookup = findLanguageSelect(pageDocument());
    if (lookup.reason) {
      return { options: [], complete: false, reason: lookup.reason };
    }
    return hydroLanguageOptionSet(
      lookup.select,
      readHydroLanguages(pageWindow())
    );
  }

  function findLanguageIssue(slot: EditorSlot): string | null {
    if (destroyed) return "The Hydro bridge has been destroyed.";
    const lookup = findLanguageSelect(pageDocument());
    if (lookup.reason) return lookup.reason;
    if (!lookup.select) {
      return (
        issues.get(slot) ??
        'No Hydro select[name="lang"] was found on this page.'
      );
    }
    return issues.get(slot) ?? null;
  }

  function emitLanguage(state: LanguageState): void {
    const observed = state.echo.poll();
    if (!observed || !observed.value) return;
    for (const listener of Array.from(state.listeners)) {
      try {
        listener(observed.value, "user");
      } catch {
        /* One subscriber must not break the others. */
      }
    }
  }

  function attachLanguage(state: LanguageState): void {
    if (state.detach) return;
    state.echo.snapshot();
    const doc = pageDocument();
    if (!doc) {
      state.detach = registerTeardown(() => undefined);
      return;
    }
    const onChange = (event: Event): void => {
      const lookup = findLanguageSelect(doc);
      if (!lookup.select || event.target !== lookup.select) return;
      queueMicrotask(() => emitLanguage(state));
    };
    doc.addEventListener("change", onChange, true);
    state.detach = registerTeardown(() => {
      doc.removeEventListener("change", onChange, true);
    });
  }

  function detachLanguage(state: LanguageState): void {
    const detach = state.detach;
    state.detach = null;
    if (detach) detach();
  }

  function selectLanguage(slot: EditorSlot, optionId: string): boolean {
    requireAlive();
    if (typeof optionId !== "string" || !optionId) {
      setIssue(slot, "A non-empty Hydro language value is required.");
      return false;
    }
    const lookup = findLanguageSelect(pageDocument());
    if (lookup.reason) {
      setIssue(slot, lookup.reason);
      return false;
    }
    const select = lookup.select;
    if (!select) {
      setIssue(slot, "No Hydro select[name=\"lang\"] was found.");
      return false;
    }
    const languages = readHydroLanguages(pageWindow());
    const set = hydroLanguageOptionSet(select, languages);
    const matches = set.options.filter(
      (option) => option.optionId === optionId
    );
    if (matches.length === 0) {
      setIssue(slot, `Hydro has no language "${optionId}".`);
      return false;
    }
    if (matches.length > 1) {
      setIssue(
        slot,
        `Hydro exposes multiple options with language value "${optionId}"; refusing to guess.`
      );
      return false;
    }
    const match = matches[0];
    if (!match || match.disabled) {
      setIssue(slot, `Hydro language "${optionId}" is disabled.`);
      return false;
    }
    if (currentOptionId(select) === optionId) {
      setIssue(slot, null);
      return true;
    }
    const languageState = languageStates.get(slot);
    languageState?.echo.expectWrite(optionId);
    select.value = optionId;
    if (select.value !== optionId) {
      languageState?.echo.cancelExpectedWrite();
      setIssue(slot, `Hydro rejected language value "${optionId}".`);
      return false;
    }
    dispatchDomEvent(select, "change", { bubbles: true });
    setIssue(slot, null);
    return true;
  }

  const adapter: HydroAdapter = {
    id: "hydro",
    locateEditors: locate,
    readNative(slot: EditorSlot): string {
      return readNativeValue(requireNativeState(slot));
    },
    writeNative(
      slot: EditorSlot,
      text: string,
      origin: WriteOrigin
    ): void {
      const state = requireNativeState(slot);
      if (typeof text !== "string") {
        throw new SiteBridgeError(
          "write-failed",
          "Hydro writeNative requires a string."
        );
      }
      if (origin !== "user" && origin !== "sync") {
        throw new SiteBridgeError(
          "write-failed",
          "Hydro writeNative received an unknown origin."
        );
      }
      if (readNativeValue(state) === text) return;
      state.echo.expectWrite(text);
      if (state.kind === "monaco") {
        const model = currentMonacoModel(
          state.editor,
          state.fallbackModel
        );
        if (!model) {
          state.echo.cancelExpectedWrite();
          throw new SiteBridgeError(
            "write-failed",
            "The Hydro Monaco model is unavailable."
          );
        }
        try {
          const applied = state.editor.executeEdits("ma", [
            { range: model.getFullModelRange(), text }
          ]);
          if (applied === false || model.getValue() !== text) {
            state.echo.cancelExpectedWrite();
            throw new SiteBridgeError(
              "write-failed",
              "The Hydro Monaco editor did not apply the document update."
            );
          }
        } catch (error) {
          state.echo.cancelExpectedWrite();
          if (error instanceof SiteBridgeError) throw error;
          throw new SiteBridgeError(
            "write-failed",
            "The Hydro Monaco editor rejected the document update."
          );
        }
        return;
      }
      try {
        state.element.value = text;
        dispatchDomEvent(state.element, "input", { bubbles: true });
      } catch {
        state.echo.cancelExpectedWrite();
        throw new SiteBridgeError(
          "write-failed",
          "The Hydro textarea rejected the document update."
        );
      }
    },
    subscribeNative(
      slot: EditorSlot,
      cb: NativeChangeListener
    ): () => void {
      const state = requireNativeState(slot);
      state.listeners.add(cb);
      attachNative(state);
      let active = true;
      return (): void => {
        if (!active) return;
        active = false;
        state.listeners.delete(cb);
        if (state.listeners.size === 0) detachNative(state);
      };
    },
    locateLanguageControl(slot: EditorSlot): LanguageControl | null {
      return locateControl(slot);
    },
    readLanguageOption(_slot: EditorSlot): string | null {
      requireAlive();
      const lookup = findLanguageSelect(pageDocument());
      if (!lookup.select) return null;
      return currentOptionId(lookup.select);
    },
    selectLanguageOption(slot: EditorSlot, optionId: string): boolean {
      return selectLanguage(slot, optionId);
    },
    subscribeLanguage(
      slot: EditorSlot,
      cb: LanguageChangeListener
    ): () => void {
      requireAlive();
      let state = languageStates.get(slot);
      if (!state) {
        state = {
          echo: new EchoGuard(() => {
            const lookup = findLanguageSelect(pageDocument());
            return lookup.select
              ? currentOptionId(lookup.select) ?? ""
              : "";
          }),
          listeners: new Set(),
          detach: null
        };
        languageStates.set(slot, state);
      }
      const subscriptionState = state;
      subscriptionState.listeners.add(cb);
      attachLanguage(subscriptionState);
      let active = true;
      return (): void => {
        if (!active) return;
        active = false;
        subscriptionState.listeners.delete(cb);
        if (subscriptionState.listeners.size === 0) {
          detachLanguage(subscriptionState);
        }
      };
    },
    context(): SiteContextInfo {
      const submitUrl = hydroPostSubmitUrl(pageWindow());
      return {
        site: "hydro",
        originKey: hydroOriginKey(pageLocation()),
        problemKey: hydroProblemKey(pageLocation()),
        accountScope: hydroAccountScope(pageWindow()),
        ...(submitUrl ? { submitUrl } : {})
      };
    },
    originKey(): string {
      return hydroOriginKey(pageLocation());
    },
    problemKey(): string {
      return hydroProblemKey(pageLocation());
    },
    accountScope(): string {
      return hydroAccountScope(pageWindow());
    },
    slotIds(): readonly string[] {
      return locate().map((slot) => slot.slotId);
    },
    languageOptions(_slot: EditorSlot): readonly LanguageOption[] {
      return pageLanguageOptionSet().options;
    },
    languageOptionSet(_slot: EditorSlot): LanguageOptionSet {
      return pageLanguageOptionSet();
    },
    languageProfiles(_slot: EditorSlot): SiteProfileResolution {
      const languages = readHydroLanguages(pageWindow());
      return resolveSiteOptions(
        "hydro",
        pageLanguageOptionSet().options.filter((option) =>
          isHydroCppOption(option, languages)
        )
      );
    },
    languageIssue(slot: EditorSlot): string | null {
      return findLanguageIssue(slot);
    },
    selectLanguageOptionAsync(
      slot: EditorSlot,
      optionId: string
    ): Promise<boolean> {
      return Promise.resolve(selectLanguage(slot, optionId));
    },
    remoteLsp(): SiteRemoteStatus {
      return detectHydroSiteRemote(pageWindow());
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const teardown of Array.from(teardowns)) teardown();
      teardowns.clear();
    }
  };

  return adapter;
}

/** Lazy singleton for the MAIN-world bridge. */
export const hydroBridge: HydroAdapter = createHydroBridge();
