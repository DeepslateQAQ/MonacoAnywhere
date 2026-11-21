/*
 * Shared native-DOM UI primitives for MonacoAnywhere surfaces.
 *
 * These helpers never interpret HTML: children are appended as text nodes or
 * DOM nodes, and attribute/property names are applied explicitly. No
 * framework and no string-to-markup path is provided.
 */
import "@kyralabs/m3e-elements/loading-indicator.js";

import { t } from "./i18n.js";

export type ElementChild = Node | string | number | null | false;

export interface DialogOptions {
  /** Localized confirm label. Defaults to common.confirm. */
  confirm?: string;
  /** Localized cancel label. Defaults to common.cancel. */
  cancel?: string;
  /** Explicit UI host for asynchronous dialogs when focus is outside the toolbar. */
  host?: ShadowRoot | HTMLElement;
}

export interface StatusOptions {
  kind: "info" | "error";
  text: string;
}

export interface LoadingIndicatorOptions {
  label: string;
  contained?: boolean;
}

const FORBIDDEN_PROPERTY_NAMES: Record<string, true> = {
  innerHTML: true,
  outerHTML: true,
  dangerouslySetInnerHTML: true
};

function applyClassName(node: HTMLElement, value: unknown): void {
  if (Array.isArray(value)) {
    node.className = value
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(" ");
    return;
  }
  node.className = String(value);
}

function applyStyle(node: HTMLElement, value: unknown): void {
  if (typeof value === "string") {
    node.style.cssText = value;
    return;
  }
  if (value && typeof value === "object") {
    Object.assign(node.style, value as Partial<CSSStyleDeclaration>);
  }
}

function applyDataset(node: HTMLElement, value: unknown): void {
  if (value && typeof value === "object") {
    Object.assign(node.dataset, value as Record<string, string>);
  }
}

function isAttributeName(name: string): boolean {
  return (
    name.startsWith("aria-") ||
    name.startsWith("data-") ||
    name === "role" ||
    name === "slot" ||
    name === "part" ||
    name.includes("-")
  );
}

/**
 * Create an element from native properties, attributes and event handlers.
 *
 * Property names are native (`onclick`, `onchange`, `value`, `checked`, …).
 * `class`/`className`, `style`, `dataset`, `aria-*` and `data-*` are accepted.
 * Children are appended as text or nodes; HTML strings are never parsed.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: readonly ElementChild[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const writable = node as unknown as Record<string, unknown>;

  for (const child of children) {
    if (child === null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }

  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (FORBIDDEN_PROPERTY_NAMES[name]) {
      throw new TypeError(`el(${tag}): ${name} is not allowed; pass nodes as children`);
    }

    if (name === "class" || name === "className") {
      applyClassName(node, value);
    } else if (name === "style") {
      applyStyle(node, value);
    } else if (name === "dataset") {
      applyDataset(node, value);
    } else if (name.startsWith("on") && name.length > 2 && typeof value === "function") {
      node.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else if (isAttributeName(name)) {
      if (value === false) {
        node.removeAttribute(name);
      } else {
        node.setAttribute(name, value === true ? "true" : String(value));
      }
    } else if (typeof value === "boolean") {
      if (typeof writable[name] === "boolean") {
        writable[name] = value;
      } else if (value) {
        node.setAttribute(name, "");
      }
    } else if (name in node) {
      writable[name] = value;
    } else {
      node.setAttribute(name, String(value));
    }
  }

  return node;
}

let dialogSequence = 0;

function deepActiveElement(): HTMLElement | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active instanceof HTMLElement ? active : null;
}

/**
 * Open a modal native <dialog> and resolve with the confirm choice.
 *
 * Escape, the scrim and the cancel button resolve false; the confirm button
 * resolves true. Focus returns to the element that opened the dialog.
 */
export function openDialog(
  title: string,
  body: Node | string,
  opts: DialogOptions = {}
): Promise<boolean> {
  const previouslyFocused = deepActiveElement();
  const root = previouslyFocused?.getRootNode();
  const host = opts.host ?? (root instanceof ShadowRoot ? root : document.body);
  const focusedUi = previouslyFocused?.closest<HTMLElement>(".ma-ui");
  const themeRoot = focusedUi && host.contains(focusedUi)
    ? focusedUi
    : host instanceof HTMLElement && host.matches(".ma-ui")
      ? host
      : host.querySelector<HTMLElement>(".ma-ui");

  dialogSequence += 1;
  const titleId = `ma-dialog-title-${dialogSequence}`;
  const bodyId = `ma-dialog-body-${dialogSequence}`;

  const dialog = el("dialog", {
    class: "ma-ui m3e-dialog ma-dialog",
    role: "dialog",
    "aria-labelledby": titleId,
    "aria-describedby": bodyId
  });
  const theme = themeRoot?.dataset.theme;
  if (theme === "light" || theme === "dark") dialog.dataset.theme = theme;
  const scrim = el("div", {
    class: "m3e-dialog__scrim",
    "aria-hidden": "true"
  });
  const container = el("div", { class: "m3e-dialog__container" });
  const headline = el(
    "h2",
    { class: "m3e-dialog__headline", id: titleId },
    [title]
  );
  const content = el(
    "div",
    { class: "m3e-dialog__content", id: bodyId },
    [body]
  );
  const actions = el("div", { class: "m3e-dialog__actions" });
  const cancelButton = el(
    "button",
    {
      type: "button",
      class: "m3e-button m3e-button--text",
      onclick: () => dialog.close("cancel")
    },
    [opts.cancel ?? t("common.cancel")]
  );
  const confirmButton = el(
    "button",
    {
      type: "button",
      class: "m3e-button m3e-button--filled",
      onclick: () => dialog.close("confirm")
    },
    [opts.confirm ?? t("common.confirm")]
  );

  actions.append(cancelButton, confirmButton);
  container.append(headline, content, actions);
  dialog.append(scrim, container);

  const { promise, resolve, reject } = Promise.withResolvers<boolean>();
  let settled = false;

  const finish = (accepted: boolean): void => {
    if (settled) return;
    settled = true;
    dialog.remove();
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
    resolve(accepted);
  };

  dialog.addEventListener("close", () => {
    finish(dialog.returnValue === "confirm");
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close("cancel");
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close("cancel");
  });
  scrim.addEventListener("click", () => dialog.close("cancel"));

  try {
    host.append(dialog);
    dialog.showModal();
  } catch (error) {
    settled = true;
    dialog.remove();
    reject(error);
  }

  return promise;
}

/**
 * Update a live status region. Errors become assertive alerts; informational
 * updates remain polite status messages.
 */
export function setStatus(node: HTMLElement, status: StatusOptions): void {
  node.setAttribute("role", status.kind === "error" ? "alert" : "status");
  node.setAttribute(
    "aria-live",
    status.kind === "error" ? "assertive" : "polite"
  );
  node.setAttribute("aria-atomic", "true");
  node.dataset.kind = status.kind;
  node.textContent = status.text;
}

/**
 * Create the real M3E loading indicator. The element freezes its first frame
 * under prefers-reduced-motion; no CSS animation is added here.
 */
export function loadingIndicator({
  label,
  contained = false
}: LoadingIndicatorOptions): HTMLElement {
  const indicator = document.createElement("m3e-loading-indicator");
  indicator.setAttribute("aria-label", label);
  if (contained) indicator.setAttribute("contained", "");
  return indicator;
}
