/*
 * Dedicated-site bridge contract.
 *
 * The adapters in this directory only read and write existing site editor
 * instances through public page APIs. They never mount an editor, submit a
 * form, or bypass a site language control. Everything here is DOM/instance
 * access and deliberately has no chrome.* dependency.
 */

import type {
  EditorKind,
  EditorSlotInfo,
  LanguageOptionInfo,
  SiteId,
  TextOrigin
} from "../shared/site-protocol.js";
import type { SiteProfileResolution } from "../profiles/builtin.js";

export type {
  EditorKind,
  EditorSlotInfo,
  LanguageOptionInfo,
  SiteId,
  TextOrigin
};

export type DedicatedSiteId = Exclude<SiteId, "generic">;
export type WriteOrigin = TextOrigin;

export type NativeChangeListener = (text: string, origin: WriteOrigin) => void;
export type LanguageChangeListener = (
  optionId: string,
  origin: WriteOrigin
) => void;

/** A location shaped object; tests can supply a plain object. */
export interface LocationLike {
  readonly href?: string;
  readonly origin?: string;
  readonly pathname?: string;
  readonly search?: string;
  readonly hash?: string;
}

/**
 * Injectable page environment. When omitted, adapters use the real page
 * globals lazily at call time, never at module evaluation time.
 */
export interface SiteEnvironment {
  readonly document?: Document;
  readonly window?: Window;
  readonly location?: LocationLike;
}

export interface MonacoDisposableLike {
  dispose(): void;
}

/** The small public Monaco model surface the Hydro adapter relies on. */
export interface MonacoModelLike {
  getValue(): string;
  getFullModelRange(): unknown;
  onDidChangeContent?(listener: () => void): MonacoDisposableLike;
  getVersionId?(): number;
}

/** The small public Monaco editor surface the Hydro adapter relies on. */
export interface MonacoEditorLike {
  getModel(): MonacoModelLike | null;
  executeEdits(
    source: string,
    edits: readonly { readonly range: unknown; readonly text: string }[]
  ): unknown;
  onDidChangeModelContent?(
    listener: () => void
  ): MonacoDisposableLike;
  getDomNode?(): HTMLElement | null;
}

/** The public slice of `window.monaco` used to validate editor ownership. */
export interface MonacoNamespaceLike {
  readonly editor: {
    getEditors?(): readonly MonacoEditorLike[];
  };
}

/** Public CodeMirror 6 view fields used by the Luogu adapter. */
export interface CodeMirrorDocLike {
  readonly length: number;
  toString(): string;
}

export interface CodeMirrorStateLike {
  readonly doc: CodeMirrorDocLike;
}

export interface CodeMirrorDispatchSpec {
  readonly changes: {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
  };
}

export interface CodeMirrorViewLike {
  readonly state: CodeMirrorStateLike;
  dispatch(spec: CodeMirrorDispatchSpec): void;
  readonly contentDOM?: Node;
}

/** Public Ace editor surface used by AtCoder and Codeforces. */
export interface AceSessionLike {
  on(event: "change", listener: () => void): void;
  off?(event: "change", listener: () => void): void;
}

export interface AceEditorLike {
  getValue(): string;
  setValue(text: string, cursorPosition?: number): void;
  getSession(): AceSessionLike;
}

export interface EditorSlot extends EditorSlotInfo {
  /** Original editor element; replacement overlays should cover this box. */
  readonly element: HTMLElement;
  /** Retained page Monaco namespace (Hydro only). */
  readonly monaco?: MonacoNamespaceLike;
  /** Retained page editor instance (Hydro only). */
  readonly nativeEditor?: unknown;
  /** Retained page Monaco model (Hydro only). */
  readonly model?: MonacoModelLike | null;
}

export interface LanguageOption extends LanguageOptionInfo {
  /**
   * False when the site label establishes the standard but not the compiler
   * dialect (Hydro deployments commonly fall in this group).
   */
  readonly dialectVerified?: boolean;
  /** Native form value when optionId is generated (AtCoder). */
  readonly rawValue?: string;
}

export interface LanguageOptionSet {
  readonly options: readonly LanguageOption[];
  /** False when the site control has not rendered its full option list yet. */
  readonly complete: boolean;
  readonly reason?: string;
}

export type LanguageControl =
  | {
      readonly kind: "select";
      readonly element: HTMLSelectElement;
    }
  | {
      readonly kind: "luogu-combo";
      readonly element: HTMLElement;
      readonly trigger: HTMLElement;
    }
  | {
      readonly kind: "unsupported";
      readonly reason: string;
    };

export interface SiteContextInfo {
  readonly site: SiteId;
  readonly originKey: string;
  readonly problemKey: string;
  readonly accountScope: string;
  /** Hydro only: the site-provided URL, never assembled by the extension. */
  readonly submitUrl?: string;
}

export interface SiteRemoteStatus {
  readonly state: "none" | "active" | "unsupported";
  readonly lspHost: string | null;
  readonly features: readonly string[];
  readonly reason?: string;
}

/**
 * The exact adapter surface required by the plan. Slot handles are the
 * EditorSlot objects returned by locateEditors().
 */
export interface SiteBridge {
  readonly id: SiteId;
  locateEditors(): EditorSlot[];
  readNative(slot: EditorSlot): string;
  writeNative(slot: EditorSlot, text: string, origin: WriteOrigin): void;
  subscribeNative(slot: EditorSlot, cb: NativeChangeListener): () => void;
  locateLanguageControl(slot: EditorSlot): LanguageControl | null;
  readLanguageOption(slot: EditorSlot): string | null;
  selectLanguageOption(slot: EditorSlot, optionId: string): boolean;
  subscribeLanguage(slot: EditorSlot, cb: LanguageChangeListener): () => void;
  /** Optional deterministic teardown of every listener this bridge owns. */
  destroy?(): void;
}

/**
 * Shared helper surface used by the MAIN-world site bridge and the content
 * script. It is intentionally additive: a SiteAdapter is still a SiteBridge.
 */
export interface SiteAdapter extends SiteBridge {
  context(): SiteContextInfo;
  originKey(): string;
  problemKey(): string;
  accountScope(): string;
  slotIds(): readonly string[];
  languageOptions(slot: EditorSlot): readonly LanguageOption[];
  languageOptionSet(slot: EditorSlot): LanguageOptionSet;
  languageProfiles(slot: EditorSlot): SiteProfileResolution;
  /** Human-readable reason why language access is unavailable. */
  languageIssue(slot: EditorSlot): string | null;
  /** Luogu's combo needs polling; every other adapter delegates synchronously. */
  selectLanguageOptionAsync(
    slot: EditorSlot,
    optionId: string
  ): Promise<boolean>;
}

export type SiteBridgeErrorCode =
  | "bridge-destroyed"
  | "unknown-slot"
  | "slot-stale"
  | "read-failed"
  | "write-failed";

export class SiteBridgeError extends Error {
  readonly code: SiteBridgeErrorCode;

  constructor(code: SiteBridgeErrorCode, message: string) {
    super(message);
    this.name = "SiteBridgeError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Small DOM and data helpers shared by the four adapters.             */
/* ------------------------------------------------------------------ */

export function isRecordValue(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeLabel(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function textOf(element: Element | null | undefined): string {
  if (!element) return "";
  return normalizeLabel(element.textContent);
}

export function originFromLocation(
  location: LocationLike | null | undefined
): string {
  if (!location) return "";
  if (typeof location.origin === "string" && location.origin) {
    return location.origin.replace(/\/$/, "");
  }
  if (typeof location.href === "string" && location.href) {
    try {
      return new URL(location.href).origin;
    } catch {
      return "";
    }
  }
  return "";
}

export function pathnameFromLocation(
  location: LocationLike | null | undefined
): string {
  if (!location) return "/";
  if (typeof location.pathname === "string" && location.pathname) {
    return location.pathname;
  }
  if (typeof location.href === "string" && location.href) {
    try {
      return new URL(location.href).pathname || "/";
    } catch {
      return "/";
    }
  }
  return "/";
}

/**
 * Settings/draft identity for a site. Hydro domain deployments add the
 * `/d/:domainId` prefix; every other dedicated site uses the plain origin.
 */
export function siteOriginKey(
  site: SiteId,
  location?: LocationLike | null
): string {
  const origin = originFromLocation(location);
  if (site !== "hydro") return origin;
  const match = /^\/d\/([^/]+)/.exec(pathnameFromLocation(location));
  return match?.[1] ? `${origin}/d/${match[1]}` : origin;
}

/**
 * Conservative host-based site detection. A private Hydro deployment cannot
 * be recognised by hostname; the content router additionally checks
 * documentElement.dataset.app === "Hydro".
 */
export function detectSiteId(
  location?: LocationLike | null,
  doc?: Document | null
): SiteId {
  if (doc?.documentElement?.dataset?.app === "Hydro") return "hydro";
  let hostname = "";
  if (typeof location?.href === "string" && location.href) {
    try {
      hostname = new URL(location.href).hostname.toLowerCase();
    } catch {
      hostname = "";
    }
  }
  if (!hostname) return "generic";
  if (hostname === "luogu.com.cn" || hostname.endsWith(".luogu.com.cn")) {
    return "luogu";
  }
  if (hostname === "luogu.org" || hostname.endsWith(".luogu.org")) {
    return "luogu";
  }
  if (hostname === "atcoder.jp" || hostname.endsWith(".atcoder.jp")) {
    return "atcoder";
  }
  if (
    hostname === "codeforces.com" ||
    hostname.endsWith(".codeforces.com")
  ) {
    return "codeforces";
  }
  if (hostname === "hydro.ac" || hostname.endsWith(".hydro.ac")) {
    return "hydro";
  }
  return "generic";
}

function escapeCssIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);
}

/**
 * Generate a selector that resolves back to the element. IDs are preferred;
 * otherwise an nth-of-type path is built. The content script only needs this
 * for the overlay box and for protocol diagnostics.
 */
export function cssPathFor(element: HTMLElement | null): string {
  if (!element) return "";
  if (element.id) return `#${escapeCssIdent(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === 1) {
    if (current.id) {
      parts.unshift(`#${escapeCssIdent(current.id)}`);
      break;
    }
    const tag = (current.localName || current.tagName || "div").toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    let index = 1;
    for (let i = 0; i < parent.children.length; i += 1) {
      const sibling = parent.children[i];
      if (!sibling) continue;
      if (sibling === current) break;
      const siblingTag = (
        sibling.localName ||
        sibling.tagName ||
        ""
      ).toLowerCase();
      if (siblingTag === tag) index += 1;
    }
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }
  return parts.join(" > ");
}

/**
 * Visibility check for choosing between duplicate language controls and
 * hidden tab panels. Only standard DOM state is inspected; getClientRects is
 * used when available but is not required.
 */
export function isElementVisible(
  element: Element | null | undefined
): boolean {
  if (!element) return false;
  let node: Element | null = element;
  while (node) {
    if ((node as HTMLElement).hidden) return false;
    if (node.getAttribute("hidden") !== null) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    const style = (node as HTMLElement).style;
    if (style) {
      if (style.display === "none") return false;
      if (style.visibility === "hidden") return false;
    }
    node = node.parentElement;
  }
  const getRects = (element as HTMLElement).getClientRects;
  if (typeof getRects === "function") {
    try {
      if (element.getClientRects().length === 0) return false;
    } catch {
      /* A detached or synthetic element is still usable if it has no layout. */
    }
  }
  return true;
}

export function dispatchDomEvent(
  element: Element,
  type: "click" | "input" | "change" | "keydown",
  options: { readonly bubbles?: boolean } = {}
): boolean {
  const view = element.ownerDocument?.defaultView ?? null;
  // Constructors live on the window realm, not on the bare Window type.
  const realm = view as (Window & typeof globalThis) | null;
  const bubbles = options.bubbles ?? true;
  if (type === "click") {
    const MouseCtor =
      realm?.MouseEvent ??
      (typeof MouseEvent === "function" ? MouseEvent : undefined);
    if (!MouseCtor) return false;
    return element.dispatchEvent(
      new MouseCtor("click", { bubbles, cancelable: true })
    );
  }
  const EventCtor =
    realm?.Event ?? (typeof Event === "function" ? Event : undefined);
  if (!EventCtor) return false;
  return element.dispatchEvent(new EventCtor(type, { bubbles, cancelable: true }));
}

/* ------------------------------------------------------------------ */
/* Select control helpers (AtCoder, Codeforces, Hydro).               */
/* ------------------------------------------------------------------ */

export function optionsOfSelect(
  select: HTMLSelectElement
): HTMLOptionElement[] {
  const nativeOptions = select.options;
  if (nativeOptions && typeof nativeOptions.length === "number") {
    return Array.from(nativeOptions);
  }
  return Array.from(select.querySelectorAll("option"));
}

export function optionLabel(option: HTMLOptionElement | null): string {
  if (!option) return "";
  return normalizeLabel(option.label) || normalizeLabel(option.textContent);
}

export function optionDisabled(option: HTMLOptionElement | null): boolean {
  if (!option) return true;
  return option.disabled || option.getAttribute("disabled") !== null;
}

export function selectedOption(
  select: HTMLSelectElement
): HTMLOptionElement | null {
  const options = optionsOfSelect(select);
  const index = select.selectedIndex;
  if (Number.isInteger(index) && index >= 0) {
    const byIndex = options[index];
    if (byIndex) return byIndex;
  }
  const value = select.value;
  if (typeof value === "string") {
    return options.find((option) => option.value === value) ?? null;
  }
  return null;
}

export function selectOptionByValue(
  select: HTMLSelectElement,
  value: string
): boolean {
  const match = optionsOfSelect(select).find((option) => option.value === value);
  if (!match || optionDisabled(match)) return false;
  select.value = value;
  if (select.value !== value) return false;
  dispatchDomEvent(select, "change", { bubbles: true });
  return true;
}

/* ------------------------------------------------------------------ */
/* Echo suppression shared by native and language listeners.          */
/* ------------------------------------------------------------------ */

export interface ObservedValue {
  readonly value: string;
}

/**
 * Compare snapshots and discard the site event caused by our own write.
 * External changes are reported exactly once; repeated identical snapshots
 * are idempotent.
 */
export class EchoGuard {
  private last: string | null = null;
  private expectedWrite: string | null = null;

  constructor(private readonly read: () => string) {}

  /** Establish the baseline without emitting or keeping a stale echo marker. */
  snapshot(): void {
    this.expectedWrite = null;
    try {
      this.last = this.read();
    } catch {
      this.last = null;
    }
  }

  /** Register the value our write is expected to produce. */
  expectWrite(value: string): void {
    this.expectedWrite = value;
  }

  cancelExpectedWrite(): void {
    this.expectedWrite = null;
  }

  /** Read the current value and report an external change, if any. */
  poll(): ObservedValue | null {
    let value: string;
    try {
      value = this.read();
    } catch {
      return null;
    }
    return this.observe(value);
  }

  /** Report a change using an already-read snapshot. */
  accept(value: string): ObservedValue | null {
    return this.observe(value);
  }

  private observe(value: string): ObservedValue | null {
    if (this.expectedWrite !== null) {
      const expected = this.expectedWrite;
      this.expectedWrite = null;
      if (value === expected) {
        this.last = value;
        return null;
      }
    }
    if (this.last === null) {
      this.last = value;
      return null;
    }
    if (value === this.last) return null;
    this.last = value;
    return { value };
  }
}
