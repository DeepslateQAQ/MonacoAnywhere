/*
 * Codeforces adapter.
 *
 * Editor: Ace at `#editor`; the instance is `#editor.env.editor`. The page
 * also exposes `window.editor`, which is deliberately ignored. The form's
 * `#sourceCodeTextarea` is kept in sync after writes, without submitting.
 *
 * Language: the native `select[name="programTypeId"]`; values are the
 * authoritative Codeforces programTypeIds. Live GNU G++ labels are parsed by
 * the shared profile resolver; C/GCC C and other non-C++ options never become
 * C++ profiles.
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
const LANGUAGE_SELECT = 'select[name="programTypeId"]';
const SUBMIT_FORM = "form.submit-form";
const SOURCE_TEXTAREA = "#sourceCodeTextarea";
const SOURCE_TEXTAREA_NAME = 'textarea[name="source"]';

export interface CodeforcesAdapter extends SiteAdapter {
  readonly id: "codeforces";
}

export function codeforcesOriginKey(
  location?: LocationLike | null
): string {
  return siteOriginKey("codeforces", location);
}

export function codeforcesProblemKey(
  location?: LocationLike | null
): string {
  const path = pathnameFromLocation(location);
  const group = /^\/group\/([^/]+)\/contest\/(\d+)\/problem\/([^/]+)/.exec(
    path
  );
  if (group?.[1] && group[2] && group[3]) {
    return `group:${group[1]}:${group[2]}:${group[3]}`;
  }
  const gym = /^\/gym\/(\d+)\/problem\/([^/]+)/.exec(path);
  if (gym?.[1] && gym[2]) return `gym:${gym[1]}:${gym[2]}`;
  const contest = /^\/contest\/(\d+)\/problem\/([^/]+)/.exec(path);
  if (contest?.[1] && contest[2]) {
    return `contest:${contest[1]}:${contest[2]}`;
  }
  const problemset = /^\/problemset\/problem\/(\d+)\/([^/]+)/.exec(path);
  if (problemset?.[1] && problemset[2]) {
    return `${problemset[1]}:${problemset[2]}`;
  }
  return path.replace(/\/+$/, "") || "unknown";
}

export function codeforcesAccountScope(
  doc: Document | null | undefined
): string {
  if (!doc) return "anon";
  const base =
    doc.defaultView?.location?.href ??
    (typeof location !== "undefined" ? location.href : undefined);
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let path: string;
    try {
      const url = new URL(href, base ?? "https://codeforces.com/");
      if (base) {
        const baseUrl = new URL(base);
        if (url.origin !== baseUrl.origin) continue;
      }
      path = url.pathname;
    } catch {
      path = href;
    }
    const match = /^\/profile\/([^/?#]+)/.exec(path);
    if (!match?.[1]) continue;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return "anon";
}

export function codeforcesSlotId(): string {
  return "main";
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

function readAce(element: HTMLElement): AceEditorLike | null {
  if (!("env" in element)) return null;
  const env = element.env;
  if (!isRecordValue(env)) return null;
  return isAceEditor(env.editor) ? env.editor : null;
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

function findSourceTextarea(
  doc: Document | null
): HTMLTextAreaElement | null {
  if (!doc) return null;
  const byId = doc.querySelector(SOURCE_TEXTAREA);
  if (byId && "value" in byId && typeof byId.value === "string") {
    return byId as HTMLTextAreaElement;
  }
  const named = queryElements(doc, SOURCE_TEXTAREA_NAME).filter(
    (element) => "value" in element && typeof element.value === "string"
  );
  return named.length === 1
    ? (named[0] as HTMLTextAreaElement)
    : null;
}

/**
 * Reflect an Ace write into the hidden textarea the form posts. This never
 * clicks a submit control or rebuilds the form action.
 */
export function syncCodeforcesSourceTextarea(
  doc: Document | null,
  text: string
): boolean {
  const textarea = findSourceTextarea(doc);
  if (!textarea) return false;
  if (textarea.value === text) return true;
  textarea.value = text;
  dispatchDomEvent(textarea, "input", { bubbles: true });
  return true;
}

interface LanguageSelectLookup {
  readonly select: HTMLSelectElement | null;
  readonly reason: string | null;
}

function findLanguageSelect(doc: Document | null): LanguageSelectLookup {
  if (!doc) {
    return {
      select: null,
      reason: "The Codeforces language select is unavailable without a document."
    };
  }
  const scoped: HTMLElement[] = [];
  for (const form of queryElements(doc, SUBMIT_FORM)) {
    try {
      for (const candidate of Array.from(
        form.querySelectorAll(LANGUAGE_SELECT)
      )) {
        if (candidate.nodeType === 1) scoped.push(candidate as HTMLElement);
      }
    } catch {
      /* Fall back to a document-wide unique lookup. */
    }
  }
  if (scoped.length > 1) {
    return {
      select: null,
      reason: `Multiple programTypeId selects (${scoped.length}) exist inside submit forms; refusing to guess.`
    };
  }
  if (scoped.length === 1) {
    const select = scoped[0];
    if (!select || !("options" in select)) {
      return {
        select: null,
        reason: "The Codeforces programTypeId control is not a native select."
      };
    }
    return { select: select as HTMLSelectElement, reason: null };
  }
  const all = queryElements(doc, LANGUAGE_SELECT);
  if (all.length === 0) return { select: null, reason: null };
  if (all.length > 1) {
    return {
      select: null,
      reason: `Multiple programTypeId selects (${all.length}) exist on the page; refusing to guess.`
    };
  }
  const select = all[0];
  if (!select || !("options" in select)) {
    return {
      select: null,
      reason: "The Codeforces programTypeId control is not a native select."
    };
  }
  return { select: select as HTMLSelectElement, reason: null };
}

function isCodeforcesCppOptionLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  return (
    /GNU\s+G\+\+/.test(normalized) ||
    /(?:GNU\+\+|C\+\+)\s*\d{2}\b/.test(normalized)
  );
}

export function codeforcesLanguageOptionSet(
  select: HTMLSelectElement | null
): LanguageOptionSet {
  if (!select) {
    return {
      options: [],
      complete: false,
      reason: "No Codeforces programTypeId select is available."
    };
  }
  const options: LanguageOption[] = [];
  for (const option of optionsOfSelect(select)) {
    const label = optionLabel(option);
    const rawValue = option.value ?? "";
    if (!label && !rawValue) continue;
    options.push({
      optionId: rawValue,
      label: label || rawValue,
      disabled: optionDisabled(option)
    });
  }
  return {
    options,
    complete: true,
    ...(options.length === 0
      ? { reason: "The Codeforces programTypeId select has no options." }
      : {})
  };
}

function codeforcesCppProfiles(
  options: readonly LanguageOption[]
): SiteProfileResolution {
  const cppOnly = options.filter((option) =>
    isCodeforcesCppOptionLabel(option.label)
  );
  return resolveSiteOptions("codeforces", cppOnly);
}

interface NativeState {
  readonly element: HTMLElement;
  readonly editor: AceEditorLike;
  readonly echo: EchoGuard;
  readonly listeners: Set<NativeChangeListener>;
  detach: (() => void) | null;
}

interface LanguageState {
  readonly echo: EchoGuard;
  readonly listeners: Set<LanguageChangeListener>;
  detach: (() => void) | null;
}

export function createCodeforcesBridge(
  environment: SiteEnvironment = {}
): CodeforcesAdapter {
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
        "The Codeforces bridge has been destroyed."
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
      return state.editor.getValue();
    } catch {
      throw new SiteBridgeError(
        "read-failed",
        "The Codeforces Ace editor value could not be read."
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
    const session = state.editor.getSession();
    const onChange = (): void => emitNative(state);
    session.on("change", onChange);
    state.detach = registerTeardown(() => {
      if (typeof session.off === "function") {
        session.off("change", onChange);
      }
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
        "The Codeforces slot was not produced by this bridge instance."
      );
    }
    if (
      typeof state.element.isConnected === "boolean" &&
      !state.element.isConnected
    ) {
      throw new SiteBridgeError(
        "slot-stale",
        "The Codeforces editor element is no longer connected."
      );
    }
    return state;
  }

  function locate(): EditorSlot[] {
    requireAlive();
    const doc = pageDocument();
    if (!doc) return [];
    const elements = queryElements(doc, ACE_SELECTOR);
    if (elements.length !== 1) return [];
    const element = elements[0];
    if (!element) return [];
    const editor = readAce(element);
    if (!editor) return [];
    const slot: EditorSlot = {
      slotId: codeforcesSlotId(),
      kind: "ace",
      retainedMonaco: false,
      selector: cssPathFor(element),
      element
    };
    nativeStates.set(slot, {
      element,
      editor,
      echo: new EchoGuard(() => editor.getValue()),
      listeners: new Set(),
      detach: null
    });
    return [slot];
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

  function setIssue(slot: EditorSlot, reason: string | null): void {
    issues.set(slot, reason);
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
    return codeforcesLanguageOptionSet(lookup.select);
  }

  function findLanguageIssue(slot: EditorSlot): string | null {
    if (destroyed) return "The Codeforces bridge has been destroyed.";
    const lookup = findLanguageSelect(pageDocument());
    if (lookup.reason) return lookup.reason;
    if (!lookup.select) {
      return (
        issues.get(slot) ??
        "No Codeforces select[name=\"programTypeId\"] was found on this page."
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
      setIssue(slot, "A non-empty Codeforces programTypeId is required.");
      return false;
    }
    const lookup = findLanguageSelect(pageDocument());
    if (lookup.reason) {
      setIssue(slot, lookup.reason);
      return false;
    }
    const select = lookup.select;
    if (!select) {
      setIssue(slot, "No Codeforces programTypeId select was found.");
      return false;
    }
    const set = codeforcesLanguageOptionSet(select);
    const matches = set.options.filter(
      (option) => option.optionId === optionId
    );
    if (matches.length === 0) {
      setIssue(slot, `Codeforces has no programTypeId "${optionId}".`);
      return false;
    }
    if (matches.length > 1) {
      setIssue(
        slot,
        `Codeforces exposes multiple options with programTypeId "${optionId}"; refusing to guess.`
      );
      return false;
    }
    const match = matches[0];
    if (!match || match.disabled) {
      setIssue(slot, `Codeforces programTypeId "${optionId}" is disabled.`);
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
      setIssue(
        slot,
        `Codeforces rejected native value "${optionId}".`
      );
      return false;
    }
    dispatchDomEvent(select, "change", { bubbles: true });
    setIssue(slot, null);
    return true;
  }

  const adapter: CodeforcesAdapter = {
    id: "codeforces",
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
          "Codeforces writeNative requires a string."
        );
      }
      if (origin !== "user" && origin !== "sync") {
        throw new SiteBridgeError(
          "write-failed",
          "Codeforces writeNative received an unknown origin."
        );
      }
      if (readNativeValue(state) === text) return;
      state.echo.beginWrite();
      try {
        state.editor.setValue(text, -1);
        syncCodeforcesSourceTextarea(pageDocument(), text);
      } catch {
        throw new SiteBridgeError(
          "write-failed",
          "The Codeforces Ace editor rejected the document update."
        );
      } finally {
        state.echo.endWrite();
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
            return lookup.select ? currentOptionId(lookup.select) ?? "" : "";
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
        site: "codeforces",
        originKey: codeforcesOriginKey(pageLocation()),
        problemKey: codeforcesProblemKey(pageLocation()),
        accountScope: codeforcesAccountScope(pageDocument())
      };
    },
    originKey(): string {
      return codeforcesOriginKey(pageLocation());
    },
    problemKey(): string {
      return codeforcesProblemKey(pageLocation());
    },
    accountScope(): string {
      return codeforcesAccountScope(pageDocument());
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
      return codeforcesCppProfiles(pageLanguageOptionSet().options);
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
export const codeforcesBridge: CodeforcesAdapter =
  createCodeforcesBridge();
