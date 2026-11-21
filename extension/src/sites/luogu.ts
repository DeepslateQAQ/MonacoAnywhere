/*
 * Luogu adapter.
 *
 * Editor: CodeMirror 6. The view is obtained from the documented-by-recon
 * `.cmTile.view` property on `.cm-content`, but only after the public static
 * `view.constructor.findFromDOM(element)` check proves ownership. No other
 * instance fields are consulted and the view is never rebuilt.
 *
 * Language: the site uses a custom combo (`.combo-wrapper.lang-select`) with a
 * document-level `.dropdown` whose `<li>` labels are authoritative. Numeric
 * language ids are deliberately not used.
 */

import {
  resolveSiteOptions,
  type SiteProfileResolution
} from "../profiles/builtin.js";
import languageData from "./data/luogu-language.json";
import {
  EchoGuard,
  SiteBridgeError,
  cssPathFor,
  dispatchDomEvent,
  isElementVisible,
  isRecordValue,
  normalizeLabel,
  pathnameFromLocation,
  siteOriginKey,
  textOf,
  type CodeMirrorViewLike,
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

interface LuoguLanguageSelectors {
  readonly editor: string;
  readonly root: string;
  readonly trigger: string;
  readonly dropdown: string;
  readonly dropdownHost: string;
  readonly option: string;
  readonly accountContext: string;
}

interface LuoguLanguageData {
  readonly selectors: LuoguLanguageSelectors;
  readonly knownCppLabels: readonly string[];
}

const DATA = languageData as unknown as LuoguLanguageData;
const SELECTORS = DATA.selectors;

interface CodeMirrorViewConstructorLike {
  findFromDOM?(node: Node): unknown;
}

interface NativeState {
  readonly view: CodeMirrorViewLike;
  readonly element: HTMLElement;
  readonly echo: EchoGuard;
  readonly listeners: Set<NativeChangeListener>;
  detach: (() => void) | null;
}

interface LanguageState {
  readonly echo: EchoGuard;
  readonly listeners: Set<LanguageChangeListener>;
  detach: (() => void) | null;
}

interface DropdownEntry {
  readonly dropdown: HTMLElement;
  readonly options: readonly HTMLElement[];
}

interface DropdownLookup {
  readonly dropdown: DropdownEntry | null;
  readonly reason: string | null;
}

export interface LuoguAdapter extends SiteAdapter {
  readonly id: "luogu";
}

export function luoguOriginKey(
  location?: LocationLike | null
): string {
  return siteOriginKey("luogu", location);
}

export function luoguProblemKey(
  location?: LocationLike | null
): string {
  const path = pathnameFromLocation(location);
  const contestProblem = /^\/contest\/([^/]+)\/problem\/([^/]+)/.exec(path);
  if (contestProblem?.[1] && contestProblem[2]) {
    return `contest:${contestProblem[1]}:${contestProblem[2]}`;
  }
  const problem = /^\/problem\/([^/]+)/.exec(path);
  if (problem?.[1]) return problem[1];
  const contest = /^\/contest\/([^/]+)/.exec(path);
  if (contest?.[1]) return `contest:${contest[1]}`;
  return path.replace(/\/+$/, "") || "unknown";
}

/**
 * Stable draft-slot id. Panel scoped editors are distinguished; an unscoped
 * first editor keeps the conventional "main" slot.
 */
export function luoguSlotId(
  element: Element | null,
  index: number
): string {
  if (element) {
    if (element.closest("#ide")) return `ide:${index}`;
    if (element.closest("#submit")) return `submit:${index}`;
  }
  return index === 0 ? "main" : `cm6-${index}`;
}

/** Read the user id/name from Luogu's serialized context, never logging it. */
export function luoguAccountScope(
  doc: Document | null | undefined
): string {
  if (!doc) return "anon";
  const node = doc.querySelector(SELECTORS.accountContext);
  const raw = node?.textContent?.trim() ?? "";
  if (!raw) return "anon";
  try {
    const parsed: unknown = JSON.parse(raw);
    const root = isRecordValue(parsed) ? parsed : null;
    const data =
      root && isRecordValue(root.data) ? root.data : root;
    const user =
      data && isRecordValue(data.user) ? data.user : null;
    const uid = user?.uid;
    if (typeof uid === "number" && Number.isFinite(uid)) return String(uid);
    if (typeof uid === "string" && uid.trim()) return uid.trim();
    const name =
      user?.name ?? user?.username;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    /* Fall through to a very narrow uid recovery for a changed wrapper. */
  }
  const uidMatch = /"uid"\s*:\s*(\d+)/.exec(raw);
  if (uidMatch?.[1]) return uidMatch[1];
  return "anon";
}

function isCodeMirrorView(value: unknown): value is CodeMirrorViewLike {
  if (!isRecordValue(value)) return false;
  if (typeof value.dispatch !== "function") return false;
  const state = value.state;
  if (!isRecordValue(state)) return false;
  const doc = state.doc;
  return (
    isRecordValue(doc) &&
    typeof doc.length === "number" &&
    typeof doc.toString === "function"
  );
}

function isElementNode(value: unknown): value is HTMLElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === 1
  );
}

function queryElements(
  doc: Document | null,
  selector: string
): HTMLElement[] {
  if (!doc) return [];
  try {
    return Array.from(doc.querySelectorAll(selector)).filter(isElementNode);
  } catch {
    return [];
  }
}

function childElements(
  root: ParentNode | null,
  selector: string
): HTMLElement[] {
  if (!root) return [];
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isElementNode);
  } catch {
    return [];
  }
}

function optionElementDisabled(option: HTMLElement): boolean {
  if (option.getAttribute("aria-disabled") === "true") return true;
  if (option.getAttribute("disabled") !== null) return true;
  if (option.classList.contains("disabled")) return true;
  return false;
}

function dropdownEntry(dropdown: HTMLElement): DropdownEntry {
  return {
    dropdown,
    options: childElements(dropdown, SELECTORS.option)
  };
}

function labelOfOption(option: HTMLElement): string {
  return textOf(option);
}

interface OptionMatch {
  readonly option: HTMLElement | null;
  readonly reason: string | null;
}

function findVisibleOption(
  doc: Document | null,
  label: string
): OptionMatch {
  const matches: HTMLElement[] = [];
  for (const dropdown of queryElements(doc, SELECTORS.dropdown)) {
    if (!isElementVisible(dropdown)) continue;
    for (const option of childElements(dropdown, SELECTORS.option)) {
      if (
        labelOfOption(option) === label &&
        isElementVisible(option)
      ) {
        matches.push(option);
      }
    }
  }
  if (matches.length === 1) {
    const option = matches[0];
    return option
      ? { option, reason: null }
      : { option: null, reason: `No visible Luogu option matches "${label}".` };
  }
  if (matches.length > 1) {
    return {
      option: null,
      reason: `Multiple visible Luogu dropdown entries match "${label}"; refusing to guess.`
    };
  }
  return {
    option: null,
    reason: `Luogu option "${label}" is not currently visible in an open dropdown.`
  };
}

function chooseLanguageDropdown(
  doc: Document | null,
  currentLabel: string
): DropdownLookup {
  const entries = queryElements(doc, SELECTORS.dropdown)
    .map(dropdownEntry)
    .filter((entry) => entry.options.length > 0);
  if (entries.length === 0) return { dropdown: null, reason: null };

  const visible = entries.filter((entry) =>
    isElementVisible(entry.dropdown)
  );
  const pool = visible.length > 0 ? visible : entries;
  const containingCurrent = pool.filter((entry) =>
    entry.options.some((option) => labelOfOption(option) === currentLabel)
  );
  if (containingCurrent.length === 1) {
    return { dropdown: containingCurrent[0] ?? null, reason: null };
  }
  if (containingCurrent.length > 1) {
    return {
      dropdown: null,
      reason: "Multiple Luogu dropdowns contain the current language label; refusing to guess."
    };
  }
  if (pool.length === 1) {
    return { dropdown: pool[0] ?? null, reason: null };
  }
  return {
    dropdown: null,
    reason: "The Luogu language dropdown cannot be identified uniquely."
  };
}

function currentLanguageLabel(control: LanguageControl): string {
  if (control.kind === "luogu-combo") return textOf(control.trigger);
  return "";
}

/**
 * Read the option list only when the language dropdown is present in the DOM.
 * Before it is opened Luogu exposes no complete list; the current label is
 * returned as a partial set with complete=false and an explicit reason.
 */
export function readLuoguLanguageOptions(
  doc: Document | null,
  currentLabel?: string
): LanguageOptionSet {
  const label = normalizeLabel(currentLabel ?? "");
  if (!label) {
    return {
      options: [],
      complete: false,
      reason: "The Luogu language control has no readable current label."
    };
  }
  const lookup = chooseLanguageDropdown(doc, label);
  if (!lookup.dropdown) {
    // The recon-known labels keep the standard selector usable before the
    // site renders its dropdown. Selection still goes through the real combo
    // click path and fails honestly if a label no longer exists.
    const labels = new Set<string>([label, ...DATA.knownCppLabels]);
    return {
      options: Array.from(labels).map((optionLabel) => ({
        optionId: optionLabel,
        label: optionLabel,
        disabled: false
      })),
      complete: false,
      reason:
        lookup.reason ??
        "Luogu has not rendered its dropdown yet; options are recon-known labels. selectLanguageOptionAsync() opens the real combo."
    };
  }
  const seen = new Set<string>();
  const options: LanguageOption[] = [];
  for (const option of lookup.dropdown.options) {
    const optionLabel = labelOfOption(option);
    if (!optionLabel || seen.has(optionLabel)) continue;
    seen.add(optionLabel);
    options.push({
      optionId: optionLabel,
      label: optionLabel,
      disabled: optionElementDisabled(option)
    });
  }
  if (options.length === 0) {
    return {
      options: [{ optionId: label, label, disabled: false }],
      complete: false,
      reason: "The Luogu language dropdown has no readable entries."
    };
  }
  if (!seen.has(label)) {
    options.unshift({ optionId: label, label, disabled: false });
  }
  return { options, complete: true };
}

export function createLuoguBridge(
  environment: SiteEnvironment = {}
): LuoguAdapter {
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
        "The Luogu bridge has been destroyed."
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
        /* Teardown must stay deterministic even if the page is mid-teardown. */
      }
    };
    teardowns.add(once);
    return once;
  }

  function readView(state: NativeState): string {
    try {
      return state.view.state.doc.toString();
    } catch {
      throw new SiteBridgeError(
        "read-failed",
        "The Luogu CodeMirror view could not be read."
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
    const target: Node = state.view.contentDOM ?? state.element;
    const onDomChange = (): void => {
      emitNative(state);
    };
    const MutationCtor =
      typeof MutationObserver !== "undefined"
        ? MutationObserver
        : undefined;
    let observer: MutationObserver | null = null;
    if (MutationCtor) {
      try {
        observer = new MutationCtor(() => emitNative(state));
        observer.observe(target, {
          subtree: true,
          childList: true,
          characterData: true
        });
      } catch {
        observer = null;
      }
    }
    target.addEventListener("input", onDomChange);
    target.addEventListener("change", onDomChange);
    const detach = registerTeardown(() => {
      if (observer) observer.disconnect();
      target.removeEventListener("input", onDomChange);
      target.removeEventListener("change", onDomChange);
    });
    state.detach = detach;
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
        "The Luogu slot was not produced by this bridge instance."
      );
    }
    if (
      typeof state.element.isConnected === "boolean" &&
      !state.element.isConnected
    ) {
      throw new SiteBridgeError(
        "slot-stale",
        "The Luogu editor element is no longer connected."
      );
    }
    return state;
  }

  function locate(): EditorSlot[] {
    requireAlive();
    const doc = pageDocument();
    if (!doc) return [];
    const slots: EditorSlot[] = [];
    const seenViews = new WeakSet<object>();
    for (const element of queryElements(doc, SELECTORS.editor)) {
      // Recon-validated CM6 instance access: only `.cmTile.view` is read.
      const cmContent = element as HTMLElement & {
        readonly cmTile?: { readonly view?: unknown };
      };
      const view = cmContent.cmTile?.view;
      if (!isCodeMirrorView(view)) continue;
      if (seenViews.has(view)) continue;
      const viewRecord = view as unknown as {
        readonly constructor?: unknown;
      };
      const constructorValue = viewRecord.constructor;
      if (typeof constructorValue !== "function") continue;
      const constructorRecord =
        constructorValue as unknown as CodeMirrorViewConstructorLike;
      const findFromDOM = constructorRecord.findFromDOM;
      if (typeof findFromDOM !== "function") continue;
      let resolved: unknown;
      try {
        resolved = (
          findFromDOM as (this: unknown, node: Node) => unknown
        ).call(constructorValue, element);
      } catch {
        continue;
      }
      if (resolved !== view) continue;
      seenViews.add(view);
      const overlayElement =
        (element.closest(".cm-editor") as HTMLElement | null) ?? element;
      const slot: EditorSlot = {
        slotId: luoguSlotId(element, slots.length),
        kind: "cm6",
        retainedMonaco: false,
        selector: cssPathFor(overlayElement),
        element: overlayElement
      };
      nativeStates.set(slot, {
        view,
        element,
        echo: new EchoGuard(() =>
          view.state.doc.toString()
        ),
        listeners: new Set(),
        detach: null
      });
      slots.push(slot);
    }
    return slots;
  }

  function setIssue(slot: EditorSlot, reason: string | null): void {
    issues.set(slot, reason);
  }

  function locateControl(): LanguageControl | null {
    requireAlive();
    const doc = pageDocument();
    if (!doc) {
      return {
        kind: "unsupported",
        reason: "The Luogu language control is unavailable without a document."
      };
    }
    const roots = queryElements(doc, SELECTORS.root).filter((root) =>
      isElementVisible(root)
    );
    if (roots.length === 0) return null;
    if (roots.length > 1) {
      return {
        kind: "unsupported",
        reason: `Multiple visible Luogu language combos (${roots.length}); refusing to guess.`
      };
    }
    const root = roots[0];
    if (!root) return null;
    const trigger = childElements(root, SELECTORS.trigger)[0];
    if (!trigger) {
      return {
        kind: "unsupported",
        reason:
          "The Luogu language combo has no readable .text trigger element."
      };
    }
    if (!textOf(trigger)) {
      return {
        kind: "unsupported",
        reason:
          "The Luogu language combo trigger has no readable current label."
      };
    }
    return { kind: "luogu-combo", element: root, trigger };
  }

  function findLanguageIssue(slot: EditorSlot): string | null {
    if (destroyed) {
      return "The Luogu bridge has been destroyed.";
    }
    const control = locateControl();
    const specific = issues.get(slot) ?? null;
    if (!control) {
      return (
        specific ??
        "No visible Luogu language combo was found on this page."
      );
    }
    if (control.kind === "unsupported") return control.reason;
    return specific;
  }

  function readSelectedLanguage(_slot: EditorSlot): string | null {
    const control = locateControl();
    if (!control || control.kind === "unsupported") return null;
    const label = currentLanguageLabel(control);
    return label || null;
  }

  function optionSet(slot: EditorSlot): LanguageOptionSet {
    const current = readSelectedLanguage(slot);
    if (!current) {
      const issue = findLanguageIssue(slot);
      return {
        options: [],
        complete: false,
        reason: issue ?? "No readable Luogu language selection."
      };
    }
    return readLuoguLanguageOptions(pageDocument(), current);
  }

  function clickOption(
    slot: EditorSlot,
    option: HTMLElement,
    label: string
  ): boolean {
    if (optionElementDisabled(option)) {
      setIssue(slot, `Luogu option "${label}" is disabled.`);
      return false;
    }
    const languageState = languageStates.get(slot);
    languageState?.echo.expectWrite(label);
    const dispatched = dispatchDomEvent(option, "click", {
      bubbles: true
    });
    if (!dispatched) {
      languageState?.echo.cancelExpectedWrite();
      setIssue(
        slot,
        "The page did not accept the Luogu language option click."
      );
      return false;
    }
    setIssue(slot, null);
    return true;
  }

  function clickTrigger(control: LanguageControl): boolean {
    if (control.kind !== "luogu-combo") return false;
    return dispatchDomEvent(control.trigger, "click", { bubbles: true });
  }

  function selectLanguage(
    slot: EditorSlot,
    optionId: string
  ): boolean {
    requireAlive();
    if (typeof optionId !== "string" || !optionId.trim()) {
      setIssue(slot, "A non-empty Luogu language option label is required.");
      return false;
    }
    const label = normalizeLabel(optionId);
    const control = locateControl();
    if (!control) {
      setIssue(slot, "No visible Luogu language combo was found.");
      return false;
    }
    if (control.kind === "unsupported") {
      setIssue(slot, control.reason);
      return false;
    }
    if (currentLanguageLabel(control) === label) {
      setIssue(slot, null);
      return true;
    }

    const openMatch = findVisibleOption(pageDocument(), label);
    if (openMatch.option) return clickOption(slot, openMatch.option, label);
    if (openMatch.reason && openMatch.reason.startsWith("Multiple")) {
      setIssue(slot, openMatch.reason);
      return false;
    }

    if (!clickTrigger(control)) {
      setIssue(slot, "The Luogu language trigger did not accept a click.");
      return false;
    }
    const immediate = findVisibleOption(pageDocument(), label);
    if (immediate.option) {
      return clickOption(slot, immediate.option, label);
    }
    const pending = languageStates.get(slot);
    pending?.echo.cancelExpectedWrite();
    setIssue(
      slot,
      `Luogu did not expose "${label}" synchronously after opening the combo; use selectLanguageOptionAsync().`
    );
    return false;
  }

  async function selectLanguageAsync(
    slot: EditorSlot,
    optionId: string
  ): Promise<boolean> {
    requireAlive();
    if (typeof optionId !== "string" || !optionId.trim()) {
      setIssue(slot, "A non-empty Luogu language option label is required.");
      return false;
    }
    const label = normalizeLabel(optionId);
    const control = locateControl();
    if (!control) {
      setIssue(slot, "No visible Luogu language combo was found.");
      return false;
    }
    if (control.kind === "unsupported") {
      setIssue(slot, control.reason);
      return false;
    }
    if (currentLanguageLabel(control) === label) {
      setIssue(slot, null);
      return true;
    }
    const openMatch = findVisibleOption(pageDocument(), label);
    if (openMatch.option) return clickOption(slot, openMatch.option, label);
    if (openMatch.reason && openMatch.reason.startsWith("Multiple")) {
      setIssue(slot, openMatch.reason);
      return false;
    }

    const doc = pageDocument();
    const visibleDropdownOpen =
      doc !== null &&
      queryElements(doc, SELECTORS.dropdown).some(
        (dropdown) =>
          isElementVisible(dropdown) &&
          childElements(dropdown, SELECTORS.option).length > 0
      );
    if (!visibleDropdownOpen && !clickTrigger(control)) {
      setIssue(slot, "The Luogu language trigger did not accept a click.");
      return false;
    }

    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const match = findVisibleOption(pageDocument(), label);
      if (match.option) return clickOption(slot, match.option, label);
      if (match.reason && match.reason.startsWith("Multiple")) {
        setIssue(slot, match.reason);
        return false;
      }
      const delay = Promise.withResolvers<void>();
      setTimeout(delay.resolve, 16);
      await delay.promise;
    }
    const pending = languageStates.get(slot);
    pending?.echo.cancelExpectedWrite();
    setIssue(
      slot,
      `Luogu did not expose the "${label}" option within 1s; the dropdown may have closed or the site may have changed.`
    );
    return false;
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
    const schedule = (): void => {
      queueMicrotask(() => emitLanguage(state));
      setTimeout(() => emitLanguage(state), 0);
    };
    const MutationCtor =
      typeof MutationObserver !== "undefined"
        ? MutationObserver
        : undefined;
    let observer: MutationObserver | null = null;
    const control = locateControl();
    if (MutationCtor && control && control.kind !== "unsupported") {
      try {
        observer = new MutationCtor(schedule);
        observer.observe(control.element, {
          subtree: true,
          childList: true,
          characterData: true
        });
      } catch {
        observer = null;
      }
    }
    const onClick = (event: Event): void => {
      const target = event.target;
      if (!isElementNode(target)) return;
      if (
        target.closest(SELECTORS.dropdown) ||
        target.closest(SELECTORS.root)
      ) {
        schedule();
      }
    };
    const onKey = (event: Event): void => {
      if (!("key" in event) || typeof event.key !== "string") return;
      if (event.key === "Enter" || event.key === " ") schedule();
    };
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
    const detach = registerTeardown(() => {
      if (observer) observer.disconnect();
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey, true);
    });
    state.detach = detach;
  }

  function detachLanguage(state: LanguageState): void {
    const detach = state.detach;
    state.detach = null;
    if (detach) detach();
  }

  const adapter: LuoguAdapter = {
    id: "luogu",
    locateEditors: locate,
    readNative(slot: EditorSlot): string {
      return readView(requireNativeState(slot));
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
          "Luogu writeNative requires a string."
        );
      }
      if (origin !== "user" && origin !== "sync") {
        throw new SiteBridgeError(
          "write-failed",
          "Luogu writeNative received an unknown origin."
        );
      }
      const current = readView(state);
      if (current === text) return;
      state.echo.expectWrite(text);
      try {
        state.view.dispatch({
          changes: {
            from: 0,
            to: state.view.state.doc.length,
            insert: text
          }
        });
      } catch {
        state.echo.cancelExpectedWrite();
        throw new SiteBridgeError(
          "write-failed",
          "The Luogu CodeMirror view rejected the document update."
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
        setIssue(slot, "No visible Luogu language combo was found.");
      } else if (control.kind === "unsupported") {
        setIssue(slot, control.reason);
      } else {
        setIssue(slot, null);
      }
      return control;
    },
    readLanguageOption(slot: EditorSlot): string | null {
      requireAlive();
      return readSelectedLanguage(slot);
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
          echo: new EchoGuard(
            () => readSelectedLanguage(slot) ?? ""
          ),
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
        site: "luogu",
        originKey: luoguOriginKey(pageLocation()),
        problemKey: luoguProblemKey(pageLocation()),
        accountScope: luoguAccountScope(pageDocument())
      };
    },
    originKey(): string {
      return luoguOriginKey(pageLocation());
    },
    problemKey(): string {
      return luoguProblemKey(pageLocation());
    },
    accountScope(): string {
      return luoguAccountScope(pageDocument());
    },
    slotIds(): readonly string[] {
      return locate().map((slot) => slot.slotId);
    },
    languageOptions(slot: EditorSlot): readonly LanguageOption[] {
      return optionSet(slot).options;
    },
    languageOptionSet(slot: EditorSlot): LanguageOptionSet {
      return optionSet(slot);
    },
    languageProfiles(slot: EditorSlot): SiteProfileResolution {
      return resolveSiteOptions("luogu", optionSet(slot).options);
    },
    languageIssue(slot: EditorSlot): string | null {
      return findLanguageIssue(slot);
    },
    selectLanguageOptionAsync(
      slot: EditorSlot,
      optionId: string
    ): Promise<boolean> {
      return selectLanguageAsync(slot, optionId);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const teardown of Array.from(teardowns)) {
        teardown();
      }
      teardowns.clear();
    }
  };

  return adapter;
}

/** Lazy singleton for the MAIN-world bridge. */
export const luoguBridge: LuoguAdapter = createLuoguBridge();
