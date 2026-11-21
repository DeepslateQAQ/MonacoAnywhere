/*
 * Replacement-editor overlay.
 *
 * The site adapter owns the original editor and supplies a unique selector for
 * the box the extension should cover. This module only mounts an extension
 * iframe over that box, hides the original element's paint while preserving its
 * layout, and follows geometry changes. It never reads or writes the site
 * editor; the adapter does that through the MAIN-world bridge.
 *
 * Teardown is synchronous and idempotent: pagehide, SPA navigation, and an
 * explicit "restore site editor" all go through the same path.
 */

import type {
  ContentToEditor,
  EditorSlotInfo
} from "../shared/site-protocol.js";
import { SITE_MESSAGE_LIMIT } from "../shared/site-protocol.js";

const OVERLAY_ATTRIBUTE = "data-monaco-anywhere-overlay";
const OVERLAY_ID = "monacoanywhere-editor-overlay";
const MAX_SELECTOR_LENGTH = 1024;

export interface OverlayMount {
  readonly iframe: HTMLIFrameElement;
  readonly target: HTMLElement;
  readonly slot: EditorSlotInfo;
  /** Post a validated editor message to the extension iframe. */
  post(message: ContentToEditor): boolean;
  /** Temporarily cover the page so editor dialogs center on the page. */
  setModal(active: boolean): void;
  destroy(): void;
}

interface SavedStyle {
  readonly value: string;
  readonly priority: string;
}

function saveStyle(element: Element, property: string): SavedStyle {
  const style = (element as HTMLElement).style;
  return {
    value: style.getPropertyValue(property),
    priority: style.getPropertyPriority(property)
  };
}

function restoreStyle(element: Element, property: string, saved: SavedStyle): void {
  const style = (element as HTMLElement).style;
  if (saved.value.length === 0) {
    style.removeProperty(property);
  } else {
    style.setProperty(property, saved.value, saved.priority);
  }
}

function extensionOriginOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "chrome-extension:") {
    return `${parsed.protocol}//${parsed.host}`;
  }
  return parsed.origin;
}

/**
 * Resolve the adapter selector to exactly one element. Ambiguous selectors are
 * rejected rather than guessed: covering the wrong page element would hide
 * content the user did not consent to replace.
 */
function resolveTarget(selector: string): HTMLElement | null {
  if (
    selector.length === 0 ||
    selector.length > MAX_SELECTOR_LENGTH ||
    !selector.trim()
  ) {
    return null;
  }
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    return null;
  }
  if (matches.length !== 1) {
    return null;
  }
  const target = matches[0];
  return target instanceof HTMLElement ? target : null;
}

/**
 * Find a parent that can host an absolutely positioned overlay. Elements with
 * `display: contents` generate no box, so their children are used instead.
 */
function findOverlayParent(target: HTMLElement): HTMLElement | null {
  let parent = target.parentElement;
  while (parent && parent !== document.documentElement) {
    if (getComputedStyle(parent).display !== "contents") {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.body ?? null;
}

class ConnectedOverlay implements OverlayMount {
  readonly iframe: HTMLIFrameElement;
  readonly target: HTMLElement;
  readonly slot: EditorSlotInfo;

  private readonly wrapper: HTMLDivElement;
  private readonly parent: HTMLElement;
  private readonly origin: string;
  private readonly savedTargetVisibility: SavedStyle;
  private readonly savedParentPosition: SavedStyle;
  private readonly changedParentPosition: boolean;
  private readonly resizeObserver: ResizeObserver;
  private frameRequest = 0;
  private destroyed = false;
  private modal = false;

  constructor(
    slot: EditorSlotInfo,
    target: HTMLElement,
    parent: HTMLElement,
    src: string,
    title: string
  ) {
    this.slot = slot;
    this.target = target;
    this.parent = parent;
    this.origin = extensionOriginOf(src);
    this.savedTargetVisibility = saveStyle(target, "visibility");
    this.savedParentPosition = saveStyle(parent, "position");

    const parentPosition = getComputedStyle(parent).position;
    this.changedParentPosition = parentPosition === "static";
    if (this.changedParentPosition) {
      parent.style.setProperty("position", "relative", "important");
    }

    const wrapper = document.createElement("div");
    wrapper.setAttribute(OVERLAY_ATTRIBUTE, "");
    wrapper.style.setProperty("position", "absolute", "important");
    wrapper.style.setProperty("margin", "0", "important");
    wrapper.style.setProperty("padding", "0", "important");
    wrapper.style.setProperty("border", "0", "important");
    wrapper.style.setProperty("box-sizing", "border-box", "important");
    wrapper.style.setProperty("overflow", "hidden", "important");
    wrapper.style.setProperty("z-index", "2", "important");
    wrapper.style.setProperty("background", "#1e1e1e", "important");
    wrapper.style.setProperty("visibility", "hidden", "important");

    const iframe = document.createElement("iframe");
    iframe.id = OVERLAY_ID;
    iframe.title = title;
    iframe.src = src;
    iframe.referrerPolicy = "no-referrer";
    iframe.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    iframe.style.setProperty("display", "block", "important");
    iframe.style.setProperty("width", "100%", "important");
    iframe.style.setProperty("height", "100%", "important");
    iframe.style.setProperty("margin", "0", "important");
    iframe.style.setProperty("padding", "0", "important");
    iframe.style.setProperty("border", "0", "important");
    iframe.style.setProperty("background", "#1e1e1e", "important");
    wrapper.append(iframe);

    parent.append(wrapper);
    target.style.setProperty("visibility", "hidden", "important");

    this.wrapper = wrapper;
    this.iframe = iframe;

    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(target);
    this.resizeObserver.observe(parent);
    window.addEventListener("resize", this.schedule, { passive: true });
    window.addEventListener("scroll", this.schedule, {
      capture: true,
      passive: true
    });
    this.schedule();
  }

  private readonly schedule = (): void => {
    if (this.destroyed || this.frameRequest !== 0) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.updateGeometry();
    });
  };

  private updateGeometry(): void {
    if (this.modal) return;
    if (this.destroyed || !this.target.isConnected || !this.parent.isConnected) {
      return;
    }
    const targetRect = this.target.getBoundingClientRect();
    const parentRect = this.parent.getBoundingClientRect();
    const width = Math.max(0, targetRect.width);
    const height = Math.max(0, targetRect.height);
    if (width < 1 || height < 1) {
      this.wrapper.style.setProperty("visibility", "hidden", "important");
      return;
    }

    const left =
      targetRect.left -
      parentRect.left -
      this.parent.clientLeft +
      this.parent.scrollLeft;
    const top =
      targetRect.top -
      parentRect.top -
      this.parent.clientTop +
      this.parent.scrollTop;

    this.wrapper.style.setProperty("left", `${left}px`, "important");
    this.wrapper.style.setProperty("top", `${top}px`, "important");
    this.wrapper.style.setProperty("width", `${width}px`, "important");
    this.wrapper.style.setProperty("height", `${height}px`, "important");
    this.wrapper.style.setProperty("visibility", "visible", "important");
  }

  post(message: ContentToEditor): boolean {
    if (this.destroyed) return false;
    let serialised: string;
    try {
      serialised = JSON.stringify(message);
    } catch {
      return false;
    }
    if (new TextEncoder().encode(serialised).byteLength > SITE_MESSAGE_LIMIT) {
      return false;
    }
    const windowProxy = this.iframe.contentWindow;
    if (!windowProxy) return false;
    try {
      windowProxy.postMessage(message, this.origin);
      return true;
    } catch {
      return false;
    }
  }

  setModal(active: boolean): void {
    if (this.destroyed || this.modal === active) return;
    this.modal = active;
    if (active) {
      this.wrapper.setAttribute("data-modal", "");
      this.wrapper.style.setProperty("position", "fixed", "important");
      this.wrapper.style.setProperty("inset", "0", "important");
      this.wrapper.style.setProperty("left", "0", "important");
      this.wrapper.style.setProperty("top", "0", "important");
      this.wrapper.style.setProperty("width", "100vw", "important");
      this.wrapper.style.setProperty("height", "100vh", "important");
      this.wrapper.style.setProperty("z-index", "2147483647", "important");
      this.wrapper.style.setProperty("background", "transparent", "important");
      this.wrapper.style.setProperty("visibility", "visible", "important");
      this.iframe.style.setProperty("background", "transparent", "important");
      return;
    }
    this.wrapper.removeAttribute("data-modal");
    this.wrapper.style.removeProperty("inset");
    this.wrapper.style.removeProperty("width");
    this.wrapper.style.removeProperty("height");
    this.wrapper.style.setProperty("position", "absolute", "important");
    this.wrapper.style.setProperty("z-index", "2", "important");
    this.wrapper.style.setProperty("background", "#1e1e1e", "important");
    this.iframe.style.setProperty("background", "#1e1e1e", "important");
    this.schedule();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.schedule);
    window.removeEventListener("scroll", this.schedule, { capture: true });
    if (this.frameRequest !== 0) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
    }
    this.wrapper.remove();
    if (this.target.isConnected) {
      restoreStyle(this.target, "visibility", this.savedTargetVisibility);
    }
    if (this.changedParentPosition && this.parent.isConnected) {
      restoreStyle(this.parent, "position", this.savedParentPosition);
    }
  }
}

/**
 * True when the selector resolves uniquely to a laid-out HTML element. Hidden
 * tab panels (`display: none`, zero area) are not viable overlay targets; the
 * caller retries so an active panel wins over an inactive sibling.
 */
export function selectorHasBox(selector: string): boolean {
  const target = resolveTarget(selector);
  if (!target || !target.isConnected) return false;
  const rect = target.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = getComputedStyle(target);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * Mount the extension iframe over the adapter-provided slot. Returns null when
 * the selector is missing, ambiguous, or resolves to a disconnected element;
 * the caller then keeps the original editor untouched and reports the state.
 */
export function mountOverlay(options: {
  slot: EditorSlotInfo;
  src: string;
  title: string;
}): OverlayMount | null {
  const target = resolveTarget(options.slot.selector);
  if (!target || !target.isConnected) {
    return null;
  }
  const parent = findOverlayParent(target);
  if (!parent) {
    return null;
  }
  return new ConnectedOverlay(
    options.slot,
    target,
    parent,
    options.src,
    options.title
  );
}
