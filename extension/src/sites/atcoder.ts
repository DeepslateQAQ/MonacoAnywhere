/*
 * AtCoder adapter.
 *
 * Editor: Ace. The instance is reached through `#editor.env.editor`; the
 * legacy jQuery data path was observed to point at the same object but is not
 * needed. Plain-text mode uses the real `#plain-textarea` and never touches
 * `#toggleEditorCheckbox` (that control posts to the server).
 *
 * Language: exactly one `select[name="data.LanguageId"]`; select2 clones do
 * not carry the name. Option ids are generated from normalized labels so a
 * contest that changes numeric values keeps stable profile ids; the raw form
 * value is retained in the option metadata and used only for selection.
 */

import {
  resolveSiteOptions,
  type SiteProfileResolution
} from "../profiles/builtin.js";
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
  type AceEditorLike,
  type AceSessionLike,
  type EditorSlot,
  type LanguageChangeListener,
  type LanguageControl,
  type LanguageOption,
  type LanguageOptionSet,
  type LocationLike,
  type NativeChangeListener,
  type SiteAdapter,
  type SiteContextInfo,
  type SiteEnvironment,
  type WriteOrigin
} from "./types.js";

const ACE_SELECTOR = "#editor";
const TEXTAREA_ID = "#plain-textarea";
const TEXTAREA_NAME = 'textarea[name="sourceCode"]';
const LANGUAGE_SELECT = 'select[name="data.LanguageId"]';
const TASK_SELECT = "#select-task";
const TASK_SELECT_NAME = 'select[name="data.TaskScreenName"]';
const PLAIN_MODE_ACTIVE = ".btn-toggle-editor.active";
const PLAIN_MODE_CHECKBOX = "#toggleEditorCheckbox";

export interface AtCoderAdapter extends SiteAdapter {
  readonly id: "atcoder";
}

export function atCoderOriginKey(
  location?: LocationLike | null
): string {
  return siteOriginKey("atcoder", location);
}

function readTaskSelect(doc: Document | null): HTMLSelectElement | null {
  if (!doc) return null;
  try {
    const byId = doc.querySelector(TASK_SELECT);
    if (byId && "options" in byId) return byId as HTMLSelectElement;
    const byName = doc.querySelector(TASK_SELECT_NAME);
    if (byName && "options" in byName) return byName as HTMLSelectElement;
  } catch {
    return null;
  }
  return null;
}

export function atCoderProblemKey(
  location?: LocationLike | null,
  doc?: Document | null
): string {
  const path = pathnameFromLocation(location);
  const taskPath = /^\/contests\/([^/]+)\/tasks\/([^/]+)/.exec(path);
  if (taskPath?.[2]) return taskPath[2];
  const looseTask = /^\/tasks\/([^/]+)/.exec(path);
  if (looseTask?.[1]) return looseTask[1];

  const submitPath = /^\/contests\/([^/]+)\/(?:submit|custom_test)/.exec(
    path
  );
  if (submitPath?.[1]) {
    const select = readTaskSelect(doc ?? null);
    const selected = select ? selectedOption(select) : null;
    const value = selected?.value ?? select?.value ?? "";
    if (value.trim()) return value.trim();
    return `contest:${submitPath[1]}:submit`;
  }
  return path.replace(/\/+$/, "") || "unknown";
}

/** Read the logged-in handle from a same-site /users/<handle> link. */
export function atCoderAccountScope(
  doc: Document | null | undefined
): string {
  if (!doc) return "anon";
  const base =
    doc.defaultView?.location?.href ??
    (typeof location !== "undefined" ? location.href : undefined);
  const anchors = Array.from(doc.querySelectorAll("a[href]"));
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let path: string;
    try {
      const url = new URL(href, base ?? "https://atcoder.jp/");
      if (base) {
        const baseUrl = new URL(base);
        if (url.origin !== baseUrl.origin) continue;
      }
      path = url.pathname;
    } catch {
      path = href;
    }
    const match = /^\/users\/([^/?#]+)/.exec(path);
    if (!match?.[1]) continue;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return "anon";
}

export function atCoderSlotId(): string {
  return "main";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/c\+\+/g, "cpp")
    .replace(/gnu\+\+/g, "gnu")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generated stable option id. The label is authoritative; the raw select
 * value is only a fallback for an unlabelled option.
 */
export function atCoderStableOptionId(
  rawLabel: string,
  rawValue: string
): string {
  const fromLabel = slug(normalizeLabel(rawLabel));
  if (fromLabel) return fromLabel;
  const fromValue = slug(normalizeLabel(rawValue));
  return fromValue ? `value-${fromValue}` : "value-unknown";
}

function isAceSession(value: unknown): value is AceSessionLike {
  return isRecordValue(value) && typeof value.on === "function";
}

function isAceEditor(value: unknown): value is AceEditorLike {
  if (!isRecordValue(value)) return false;
  if (typeof value.getValue !== "function") return false;
  if (typeof value.setValue !== "function") return false;
  if (typeof value.getSession !== "function") return false;
  let session: unknown;
  try {
    session = value.getSession();
  } catch {
    return false;
  }
  return isAceSession(session);
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

function asTextarea(value: unknown): HTMLTextAreaElement | null {
  if (!isRecordValue(value)) return null;
  if (typeof value.value !== "string") return null;
  if (typeof value.dispatchEvent !== "function") return null;
  return value as unknown as HTMLTextAreaElement;
}

function readAce(element: HTMLElement): AceEditorLike | null {
  if (!("env" in element)) return null;
  const env = element.env;
  if (!isRecordValue(env)) return null;
  const editor = env.editor;
  return isAceEditor(editor) ? editor : null;
}

export function isAtCoderPlainMode(
  doc: Document | null | undefined
): boolean {
  if (!doc) return false;
  const active = doc.querySelector(PLAIN_MODE_ACTIVE);
  if (active && isElementVisible(active)) return true;
  const checkbox = doc.querySelector(PLAIN_MODE_CHECKBOX);
  return checkbox !== null && "checked" in checkbox && checkbox.checked === true;
}

function findTextarea(doc: Document | null): HTMLTextAreaElement | null {
  if (!doc) return null;
  const byId = asTextarea(doc.querySelector(TEXTAREA_ID));
  if (byId) return byId;
  const byName = queryElements(doc, TEXTAREA_NAME).map(asTextarea);
  const unique = byName.filter(
    (element): element is HTMLTextAreaElement => element !== null
  );
  return unique.length === 1 ? unique[0] ?? null : null;
}

interface AceNativeState {
  readonly kind: "ace";
  readonly element: HTMLElement;
  readonly editor: AceEditorLike;
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

type NativeState = AceNativeState | TextareaNativeState;

interface LanguageState {
  readonly echo: EchoGuard;
  readonly listeners: Set<LanguageChangeListener>;
  detach: (() => void) | null;
}

export function createAtCoderBridge(
  environment: SiteEnvironment = {}
): AtCoderAdapter {
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
        "The AtCoder bridge has been destroyed."
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
      return state.kind === "ace"
        ? state.editor.getValue()
        : state.element.value;
    } catch {
      throw new SiteBridgeError(
        "read-failed",
        "The AtCoder editor value could not be read."
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
    let detachRaw: () => void;
    if (state.kind === "ace") {
      const session = state.editor.getSession();
      const onChange = (): void => emitNative(state);
      session.on("change", onChange);
      detachRaw = () => {
        if (typeof session.off === "function") {
          session.off("change", onChange);
        }
      };
    } else {
      const onInput = (): void => emitNative(state);
      state.element.addEventListener("input", onInput);
      state.element.addEventListener("change", onInput);
      detachRaw = () => {
        state.element.removeEventListener("input", onInput);
        state.element.removeEventListener("change", onInput);
      };
    }
    state.detach = registerTeardown(detachRaw);
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
        "The AtCoder slot was not produced by this bridge instance."
      );
    }
    if (
      typeof state.element.isConnected === "boolean" &&
      !state.element.isConnected
    ) {
      throw new SiteBridgeError(
        "slot-stale",
        "The AtCoder editor element is no longer connected."
      );
    }
    return state;
  }

  function locate(): EditorSlot[] {
    requireAlive();
    const doc = pageDocument();
    if (!doc) return [];
    const plainMode = isAtCoderPlainMode(doc);
    const textarea = findTextarea(doc);
    const aceElements = queryElements(doc, ACE_SELECTOR);

    if (plainMode) {
      if (!textarea) return [];
      const slot: EditorSlot = {
        slotId: atCoderSlotId(),
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

    const aceElement = aceElements[0];
    const ace =
      aceElements.length === 1 && aceElement
        ? readAce(aceElement)
        : null;
    if (ace && aceElement) {
      const slot: EditorSlot = {
        slotId: atCoderSlotId(),
        kind: "ace",
        retainedMonaco: false,
        selector: cssPathFor(aceElement),
        element: aceElement
      };
      nativeStates.set(slot, {
        kind: "ace",
        element: aceElement,
        editor: ace,
        echo: new EchoGuard(() => ace.getValue()),
        listeners: new Set(),
        detach: null
      });
      return [slot];
    }

    if (textarea && isElementVisible(textarea)) {
      const slot: EditorSlot = {
        slotId: atCoderSlotId(),
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

  function locateControl(): LanguageControl | null {
    requireAlive();
    const doc = pageDocument();
    if (!doc) {
      return {
        kind: "unsupported",
        reason: "The AtCoder language select is unavailable without a document."
      };
    }
    const selects = queryElements(doc, LANGUAGE_SELECT);
    if (selects.length === 0) return null;
    if (selects.length > 1) {
      return {
        kind: "unsupported",
        reason: `Multiple AtCoder language selects (${selects.length}) carry name="data.LanguageId"; refusing to guess.`
      };
    }
    const element = selects[0];
    if (!element || !("options" in element)) {
      return {
        kind: "unsupported",
        reason:
          "The AtCoder language control is not a native select with options."
      };
    }
    return { kind: "select", element: element as HTMLSelectElement };
  }

  function setIssue(slot: EditorSlot, reason: string | null): void {
    issues.set(slot, reason);
  }

  function readOptionId(select: HTMLSelectElement): string | null {
    const option = selectedOption(select);
    if (option) {
      const label = optionLabel(option);
      const rawValue = option.value ?? "";
      if (!label && !rawValue) return null;
      return atCoderStableOptionId(label, rawValue);
    }
    const value = typeof select.value === "string" ? select.value.trim() : "";
    return value ? atCoderStableOptionId("", value) : null;
  }

  function optionSet(): LanguageOptionSet {
    const control = locateControl();
    if (!control) {
      return {
        options: [],
        complete: false,
        reason: "No AtCoder select[name=\"data.LanguageId\"] was found."
      };
    }
    if (control.kind !== "select") {
      return {
        options: [],
        complete: false,
        reason: control.kind === "unsupported" ? control.reason : "The AtCoder language control is not a native select."
      };
    }
    const options: LanguageOption[] = [];
    for (const option of optionsOfSelect(control.element)) {
      const label = optionLabel(option);
      const rawValue = option.value ?? "";
      if (!label && !rawValue) continue;
      options.push({
        optionId: atCoderStableOptionId(label, rawValue),
        label: label || rawValue,
        disabled: optionDisabled(option),
        rawValue
      });
    }
    return {
      options,
      complete: true,
      ...(options.length === 0
        ? { reason: "The AtCoder language select has no options." }
        : {})
    };
  }

  function findLanguageIssue(slot: EditorSlot): string | null {
    if (destroyed) return "The AtCoder bridge has been destroyed.";
    const specific = issues.get(slot) ?? null;
    const control = locateControl();
    if (!control) {
      return (
        specific ??
        'No AtCoder select[name="data.LanguageId"] was found on this page.'
      );
    }
    if (control.kind === "unsupported") return control.reason;
    return specific;
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
      const control = locateControl();
      if (!control || control.kind !== "select") return;
      if (event.target !== control.element) return;
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
      setIssue(slot, "A non-empty AtCoder option id is required.");
      return false;
    }
    const control = locateControl();
    if (!control) {
      setIssue(slot, "No AtCoder language select was found.");
      return false;
    }
    if (control.kind !== "select") {
      setIssue(slot, control.kind === "unsupported" ? control.reason : "The AtCoder language control is not a native select.");
      return false;
    }
    const set = optionSet();
    const matches = set.options.filter(
      (option) => option.optionId === optionId
    );
    if (matches.length === 0) {
      setIssue(slot, `AtCoder has no option "${optionId}".`);
      return false;
    }
    if (matches.length > 1) {
      setIssue(
        slot,
        `AtCoder exposes ${matches.length} options with generated id "${optionId}"; refusing to guess.`
      );
      return false;
    }
    const match = matches[0];
    if (!match || match.disabled) {
      setIssue(slot, `AtCoder option "${optionId}" is disabled.`);
      return false;
    }
    const current = readOptionId(control.element);
    if (current === optionId) {
      setIssue(slot, null);
      return true;
    }
    const rawValue = match.rawValue;
    if (typeof rawValue !== "string") {
      setIssue(slot, `AtCoder option "${optionId}" has no native value.`);
      return false;
    }
    const languageState = languageStates.get(slot);
    languageState?.echo.expectWrite(optionId);
    control.element.value = rawValue;
    if (control.element.value !== rawValue) {
      languageState?.echo.cancelExpectedWrite();
      setIssue(
        slot,
        `AtCoder rejected native value "${rawValue}" for "${optionId}".`
      );
      return false;
    }
    dispatchDomEvent(control.element, "change", { bubbles: true });
    setIssue(slot, null);
    return true;
  }

  const adapter: AtCoderAdapter = {
    id: "atcoder",
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
          "AtCoder writeNative requires a string."
        );
      }
      if (origin !== "user" && origin !== "sync") {
        throw new SiteBridgeError(
          "write-failed",
          "AtCoder writeNative received an unknown origin."
        );
      }
      if (readNativeValue(state) === text) return;
      state.echo.expectWrite(text);
      try {
        if (state.kind === "ace") {
          state.editor.setValue(text, -1);
        } else {
          state.element.value = text;
          dispatchDomEvent(state.element, "input", { bubbles: true });
        }
      } catch {
        state.echo.cancelExpectedWrite();
        throw new SiteBridgeError(
          "write-failed",
          "The AtCoder editor rejected the document update."
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
      requireAlive();
      const control = locateControl();
      if (!control) {
        setIssue(slot, "No AtCoder language select was found.");
      } else if (control.kind === "unsupported") {
        setIssue(slot, control.reason);
      } else {
        setIssue(slot, null);
      }
      return control;
    },
    readLanguageOption(_slot: EditorSlot): string | null {
      requireAlive();
      const control = locateControl();
      if (!control || control.kind !== "select") return null;
      return readOptionId(control.element);
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
            const control = locateControl();
            if (!control || control.kind !== "select") return "";
            return readOptionId(control.element) ?? "";
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
      return {
        site: "atcoder",
        originKey: atCoderOriginKey(pageLocation()),
        problemKey: atCoderProblemKey(pageLocation(), pageDocument()),
        accountScope: atCoderAccountScope(pageDocument())
      };
    },
    originKey(): string {
      return atCoderOriginKey(pageLocation());
    },
    problemKey(): string {
      return atCoderProblemKey(pageLocation(), pageDocument());
    },
    accountScope(): string {
      return atCoderAccountScope(pageDocument());
    },
    slotIds(): readonly string[] {
      return locate().map((slot) => slot.slotId);
    },
    languageOptions(_slot: EditorSlot): readonly LanguageOption[] {
      return optionSet().options;
    },
    languageOptionSet(_slot: EditorSlot): LanguageOptionSet {
      return optionSet();
    },
    languageProfiles(_slot: EditorSlot): SiteProfileResolution {
      return resolveSiteOptions("atcoder", optionSet().options);
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
export const atCoderBridge: AtCoderAdapter = createAtCoderBridge();
