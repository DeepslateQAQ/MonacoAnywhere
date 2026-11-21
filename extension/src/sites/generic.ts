/*
 * Generic-site editor and language-control adapter.
 *
 * Rules are inert JSON (see ../content/rules.ts). This module never creates or
 * probes an editor: it uses only the instance the page already attached to the
 * selected DOM node, after validating that instance's public shape.
 *
 * World constraints:
 * - Textarea/contenteditable adapters use DOM only and work in either world.
 * - Ace, CodeMirror 5/6 and Monaco instances are JavaScript expandos owned by
 *   the page, so those adapters must run in the MAIN world (or be handed the
 *   page's monaco namespace explicitly). The isolated world sees the same DOM
 *   but not page expandos.
 *
 * No adapter ever calls `ace.edit()` or otherwise constructs an editor.
 */

import {
  compileSelector,
  tryParseRule,
  type EditorKind,
  type GenericRule
} from "../content/rules.js";
import { isStandard, type Standard } from "../profiles/types.js";

export interface GenericLanguageOption {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
}

export interface ClassifiableElement {
  readonly tagName: string;
  readonly classList?: { contains(token: string): boolean } | null;
  getAttribute?(name: string): string | null;
}

/** Read one property from an untrusted page object without asserting a shape. */
function readUnknownProperty(value: unknown, key: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  try {
    return Reflect.get(value, key) as unknown;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------------- */
/* Candidate discovery and visibility                                         */
/* ------------------------------------------------------------------------- */

const CM6_POLL_MS = 250;

function elementHasClass(element: ClassifiableElement, token: string): boolean {
  if (element.classList) {
    return element.classList.contains(token);
  }
  const classes = (element.getAttribute?.("class") ?? "").split(/\s+/);
  return classes.includes(token);
}

export function isContentEditableElement(element: Element): boolean {
  const attribute = element.getAttribute("contenteditable");
  if (attribute !== null) {
    return attribute.toLowerCase() !== "false";
  }
  return readUnknownProperty(element, "isContentEditable") === true;
}

/**
 * Classify a DOM node as a generic editor candidate. Containers win over the
 * hidden textarea/contenteditable they contain; callers that walk ancestors
 * use the nearest container.
 */
export function detectEditorKind(element: ClassifiableElement): EditorKind | null {
  if (element.tagName.toUpperCase() === "TEXTAREA") {
    return "textarea";
  }
  if (elementHasClass(element, "ace_editor")) {
    return "ace";
  }
  if (elementHasClass(element, "CodeMirror")) {
    return "cm5";
  }
  if (elementHasClass(element, "cm-editor")) {
    return "cm6";
  }
  if (elementHasClass(element, "monaco-editor")) {
    return "monaco";
  }
  const editable = element.getAttribute?.("contenteditable");
  if (editable !== null && editable !== undefined && editable.toLowerCase() !== "false") {
    return "textarea";
  }
  return null;
}

export interface CandidateChoice<T> {
  readonly status: "none" | "single" | "ambiguous";
  readonly visible: readonly T[];
  readonly candidate?: T;
}

/**
 * Pure 0/1/many candidate decision. Production passes Elements and the DOM
 * visibility check; tests pass minimal objects with an injected predicate.
 */
export function chooseVisibleCandidate<T>(
  candidates: readonly T[],
  isVisible?: (candidate: T) => boolean
): CandidateChoice<T> {
  const predicate =
    isVisible ?? ((candidate: T) => isElementVisible(candidate as unknown as Element));
  const visible = candidates.filter((candidate) => predicate(candidate));
  if (visible.length === 0) {
    return { status: "none", visible };
  }
  if (visible.length > 1) {
    return { status: "ambiguous", visible };
  }
  return { status: "single", visible, candidate: visible[0] as T };
}

export function isElementVisible(element: Element): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) {
    return false;
  }
  const view = element.ownerDocument?.defaultView;
  if (!view) {
    return true;
  }
  const style = view.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse"
  );
}

function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }
  const host = readUnknownProperty(element.getRootNode?.(), "host");
  return host instanceof Element ? host : null;
}

/**
 * Find the nearest editor candidate from a pointer target. A page's hidden
 * textarea/contenteditable (Ace, CM6) is remembered while walking up, but a
 * container found above it wins.
 */
export function findEditorCandidate(target: Element): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  let node: Element | null = target;
  while (node) {
    const kind = detectEditorKind(node);
    if (kind === "ace" || kind === "cm5" || kind === "cm6" || kind === "monaco") {
      return node as HTMLElement;
    }
    if (kind === "textarea" && fallback === null) {
      fallback = node as HTMLElement;
    }
    node = parentAcrossShadow(node);
  }
  return fallback;
}

export function isLanguageControlElement(element: Element): boolean {
  if (element.tagName.toUpperCase() === "SELECT") {
    return true;
  }
  const role = element.getAttribute("role");
  return (
    role !== null &&
    role.split(/\s+/).some((part) => part.toLowerCase() === "combobox")
  );
}

export function findLanguageControl(target: Element): HTMLElement | null {
  let node: Element | null = target;
  while (node) {
    if (isLanguageControlElement(node)) {
      return node as HTMLElement;
    }
    node = parentAcrossShadow(node);
  }
  return null;
}

export function describeGenericElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = (element.getAttribute("id") ?? "").trim();
  const classes = (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  let label = tag;
  if (id) {
    label += `#${id}`;
  }
  for (const className of classes) {
    label += `.${className}`;
  }
  return label.length > 80 ? `${label.slice(0, 77)}...` : label;
}

/* ------------------------------------------------------------------------- */
/* Language control                                                           */
/* ------------------------------------------------------------------------- */

interface OptionEntry {
  readonly option: GenericLanguageOption;
  readonly element: Element;
}

function normalizedOptionLabel(element: Element): string {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) {
    return text.slice(0, 200);
  }
  return (element.getAttribute("aria-label") ?? "").trim().slice(0, 200);
}

function optionIdentifier(element: Element, label: string): string | null {
  const explicit =
    element.getAttribute("data-value") ??
    element.getAttribute("value") ??
    element.getAttribute("data-id");
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed.slice(0, 128);
  }
  if (label) {
    return label.slice(0, 128);
  }
  const id = element.getAttribute("id")?.trim();
  return id ? id.slice(0, 128) : null;
}

function optionDisabled(element: Element): boolean {
  return (
    element.getAttribute("aria-disabled") === "true" ||
    element.hasAttribute("disabled")
  );
}

function selectEntries(select: HTMLSelectElement): OptionEntry[] {
  const entries: OptionEntry[] = [];
  const seen = new Set<string>();
  for (const option of Array.from(select.options)) {
    const id = option.value;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label = (option.label || option.textContent || id).trim().slice(0, 200);
    entries.push({
      option: { id, label, disabled: option.disabled },
      element: option
    });
  }
  return entries;
}

function comboboxScopes(control: Element): Element[] {
  const scopes: Element[] = [];
  const document = control.ownerDocument;
  for (const attribute of ["aria-controls", "aria-owns"]) {
    for (const id of (control.getAttribute(attribute) ?? "").split(/\s+/)) {
      if (!id) {
        continue;
      }
      const target = document.getElementById(id);
      if (target && target !== control) {
        scopes.push(target);
      }
    }
  }
  if (control.querySelector('[role="option"]')) {
    scopes.push(control);
  }
  return scopes;
}

function roleComboboxEntries(control: Element): OptionEntry[] {
  const candidates: Element[] = [];
  for (const scope of comboboxScopes(control)) {
    if ((scope.getAttribute("role") ?? "").split(/\s+/).includes("option")) {
      candidates.push(scope);
    }
    for (const option of scope.querySelectorAll('[role="option"]')) {
      candidates.push(option);
    }
  }

  const activeId = control.getAttribute("aria-activedescendant");
  if (activeId) {
    const active = control.ownerDocument.getElementById(activeId);
    if (active) {
      candidates.push(active);
    }
  }

  const entries: OptionEntry[] = [];
  const seenElements = new Set<Element>();
  const seenIds = new Set<string>();
  for (const element of candidates) {
    if (seenElements.has(element)) {
      continue;
    }
    seenElements.add(element);
    const label = normalizedOptionLabel(element);
    const id = optionIdentifier(element, label);
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    entries.push({
      option: { id, label, disabled: optionDisabled(element) },
      element
    });
  }
  return entries;
}

/** Read language options from a native select or an ARIA combobox popup. */
export function readLanguageOptions(element: Element): GenericLanguageOption[] {
  if (element.tagName.toUpperCase() === "SELECT") {
    return selectEntries(element as HTMLSelectElement).map((entry) => entry.option);
  }
  return roleComboboxEntries(element).map((entry) => entry.option);
}

export interface GenericLanguageControl {
  readonly element: HTMLElement;
  readonly role: "select" | "combobox";
  readOptionId(): string | null;
  readOptions(): GenericLanguageOption[];
  selectOption(optionId: string): boolean;
  subscribe(listener: (optionId: string | null) => void): () => void;
  dispose(): void;
}

interface ChangeHub<T> {
  subscribe(listener: (value: T) => void): () => void;
  /** Suppress notifications from a multi-step native replacement. */
  beginWrite(): void;
  /** Commit the actual result after the outermost replacement. */
  endWrite(): void;
  markSeen(): void;
  dispose(): void;
}

function createChangeHub<T>(
  read: () => T,
  attach: (notify: () => void) => () => void
): ChangeHub<T> {
  let last = read();
  let detach: (() => void) | null = null;
  let disposed = false;
  let writeDepth = 0;
  const listeners = new Set<(value: T) => void>();

  const notify = (): void => {
    if (disposed || writeDepth > 0) {
      return;
    }
    const value = read();
    if (Object.is(value, last)) {
      return;
    }
    last = value;
    for (const listener of [...listeners]) {
      listener(value);
    }
  };

  return {
    subscribe(listener) {
      if (disposed) {
        throw new Error("generic adapter subscription is disposed");
      }
      listeners.add(listener);
      if (detach === null) {
        try {
          detach = attach(notify);
        } catch (error) {
          listeners.delete(listener);
          throw error;
        }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && detach !== null) {
          detach();
          detach = null;
        }
      };
    },
    beginWrite() {
      writeDepth += 1;
    },
    endWrite() {
      if (writeDepth === 0) {
        return;
      }
      writeDepth -= 1;
      if (writeDepth === 0) {
        last = read();
      }
    },
    markSeen() {
      last = read();
    },
    dispose() {
      disposed = true;
      listeners.clear();
      if (detach !== null) {
        detach();
        detach = null;
      }
    }
  };
}

function dispatchInputAndChange(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickElement(element: Element): boolean {
  const clickable = element as Element & { click?: () => void };
  if (typeof clickable.click === "function") {
    clickable.click();
    return true;
  }
  if (typeof MouseEvent !== "undefined") {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }
  return false;
}

function attachComboboxSubscription(control: Element, notify: () => void): () => void {
  const document = control.ownerDocument;
  const handler = (): void => notify();
  control.addEventListener("input", handler);
  control.addEventListener("change", handler);

  const timerHost = document.defaultView;
  let scheduled: number | null = null;
  const schedule = (): void => {
    if (scheduled !== null || !timerHost) {
      return;
    }
    scheduled = timerHost.setTimeout(() => {
      scheduled = null;
      notify();
    }, 0);
  };
  document.addEventListener("click", schedule, true);
  document.addEventListener("keydown", schedule, true);

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(schedule);
    observer.observe(control, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "aria-activedescendant",
        "aria-valuetext",
        "data-value",
        "value",
        "class"
      ]
    });
    for (const scope of comboboxScopes(control)) {
      observer.observe(scope, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
    }
  }

  return () => {
    control.removeEventListener("input", handler);
    control.removeEventListener("change", handler);
    document.removeEventListener("click", schedule, true);
    document.removeEventListener("keydown", schedule, true);
    if (scheduled !== null) {
      timerHost?.clearTimeout(scheduled);
      scheduled = null;
    }
    observer?.disconnect();
  };
}

function createLanguageControl(element: Element): GenericLanguageControl | null {
  const isSelect = element.tagName.toUpperCase() === "SELECT";
  const isCombobox = !isSelect && isLanguageControlElement(element);
  if (!isSelect && !isCombobox) {
    return null;
  }

  const entries = (): OptionEntry[] =>
    isSelect
      ? selectEntries(element as HTMLSelectElement)
      : roleComboboxEntries(element);

  const readOptionId = (): string | null => {
    if (isSelect) {
      const value = (element as HTMLSelectElement).value;
      return value ? value : null;
    }

    const available = entries();
    const activeId = element.getAttribute("aria-activedescendant");
    if (activeId) {
      const active = element.ownerDocument.getElementById(activeId);
      if (active) {
        const match = available.find(
          (entry) => entry.element === active || entry.option.id === activeId
        );
        if (match) {
          return match.option.id;
        }
        const label = normalizedOptionLabel(active);
        const derived = optionIdentifier(active, label);
        if (derived) {
          return derived;
        }
      }
    }

    const value = readUnknownProperty(element, "value");
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      const match = available.find(
        (entry) => entry.option.id === trimmed || entry.option.label === trimmed
      );
      if (match) {
        return match.option.id;
      }
      if (available.length === 0) {
        return trimmed.slice(0, 128);
      }
    }

    const dataValue = element.getAttribute("data-value")?.trim();
    if (dataValue) {
      return dataValue.slice(0, 128);
    }

    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 200) {
      const match = available.find((entry) => entry.option.label === text);
      if (match) {
        return match.option.id;
      }
    }
    return null;
  };

  const attach = (notify: () => void): (() => void) => {
    if (isSelect) {
      const handler = (): void => notify();
      element.addEventListener("change", handler);
      element.addEventListener("input", handler);
      return () => {
        element.removeEventListener("change", handler);
        element.removeEventListener("input", handler);
      };
    }
    return attachComboboxSubscription(element, notify);
  };

  const hub = createChangeHub(readOptionId, attach);

  return {
    element: element as HTMLElement,
    role: isSelect ? "select" : "combobox",
    readOptionId,
    readOptions: () => entries().map((entry) => entry.option),
    selectOption(optionId) {
      if (isSelect) {
        const select = element as HTMLSelectElement;
        const option = Array.from(select.options).find(
          (candidate) => candidate.value === optionId
        );
        if (!option || option.disabled) {
          return false;
        }
        select.value = optionId;
        if (select.value !== optionId) {
          return false;
        }
        dispatchInputAndChange(element as HTMLElement);
        hub.markSeen();
        return true;
      }

      const entry = entries().find((candidate) => candidate.option.id === optionId);
      if (entry) {
        if (entry.option.disabled || !clickElement(entry.element)) {
          return false;
        }
        hub.markSeen();
        return true;
      }

      const value = readUnknownProperty(element, "value");
      if (
        element.tagName.toUpperCase() === "INPUT" &&
        typeof value === "string"
      ) {
        Reflect.set(element, "value", optionId);
        dispatchInputAndChange(element as HTMLElement);
        hub.markSeen();
        return true;
      }
      return false;
    },
    subscribe: (listener) => hub.subscribe(listener),
    dispose: () => hub.dispose()
  };
}

/* ------------------------------------------------------------------------- */
/* Editor adapters                                                            */
/* ------------------------------------------------------------------------- */

export type EditorWriteOrigin = "user" | "sync";

export interface GenericEditorAdapter {
  readonly kind: EditorKind;
  readonly element: HTMLElement;
  read(): string;
  write(text: string, origin?: EditorWriteOrigin): void;
  subscribe(listener: (text: string) => void): () => void;
  dispose(): void;
}

export interface TextareaEditorAdapter extends GenericEditorAdapter {
  readonly kind: "textarea";
  readonly contentEditable: boolean;
  /** Shown by the UI; explains direct sync and the hidden-copy caveat. */
  readonly syncNote: string;
  /** Push overlay text into the original control and notify page listeners. */
  syncToOriginal(text?: string): void;
}

export function isTextareaEditorAdapter(
  adapter: GenericEditorAdapter
): adapter is TextareaEditorAdapter {
  return adapter.kind === "textarea" && "syncToOriginal" in adapter;
}

export const TEXTAREA_SYNC_NOTE =
  "Writes go directly to the original textarea with input/change events. Pages that submit a hidden copy instead are not assumed: if saving does not update the site, use the page's own submit control.";

function setNativeTextareaValue(element: HTMLTextAreaElement, text: string): void {
  if (typeof HTMLTextAreaElement !== "undefined") {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    );
    const setter = descriptor?.set;
    if (setter) {
      setter.call(element, text);
      return;
    }
  }
  element.value = text;
}

function createTextareaAdapter(element: HTMLElement): TextareaEditorAdapter {
  const contentEditable = isContentEditableElement(element);
  const read = (): string => {
    if (contentEditable) {
      return element.textContent ?? "";
    }
    const value = readUnknownProperty(element, "value");
    return typeof value === "string" ? value : "";
  };

  const hub = createChangeHub(read, (notify) => {
    const handler = (): void => notify();
    element.addEventListener("input", handler);
    element.addEventListener("change", handler);
    let observer: MutationObserver | null = null;
    if (contentEditable && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(handler);
      observer.observe(element, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
    return () => {
      element.removeEventListener("input", handler);
      element.removeEventListener("change", handler);
      observer?.disconnect();
    };
  });

  const write = (text: string, _origin?: EditorWriteOrigin): void => {
    hub.beginWrite();
    try {
      if (contentEditable) {
        element.textContent = text;
      } else {
        setNativeTextareaValue(element as HTMLTextAreaElement, text);
      }
      dispatchInputAndChange(element);
    } finally {
      hub.endWrite();
    }
  };

  return {
    kind: "textarea",
    element,
    contentEditable,
    syncNote: TEXTAREA_SYNC_NOTE,
    read,
    write,
    syncToOriginal(text) {
      write(text ?? read());
    },
    subscribe: (listener) => hub.subscribe(listener),
    dispose: () => hub.dispose()
  };
}

interface AceEditorLike {
  getValue(): string;
  setValue(value: string, cursor?: number): void;
  getSession?(): unknown;
}

interface EmitterLike {
  on(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
  removeListener?(event: string, listener: () => void): unknown;
}

function asAceEditor(value: unknown): AceEditorLike | null {
  if (
    typeof readUnknownProperty(value, "getValue") !== "function" ||
    typeof readUnknownProperty(value, "setValue") !== "function"
  ) {
    return null;
  }
  return value as AceEditorLike;
}

function asEmitter(value: unknown): EmitterLike | null {
  return typeof readUnknownProperty(value, "on") === "function"
    ? (value as EmitterLike)
    : null;
}

function detachEmitter(emitter: EmitterLike, event: string, listener: () => void): void {
  if (typeof emitter.off === "function") {
    emitter.off(event, listener);
    return;
  }
  emitter.removeListener?.(event, listener);
}

function findClassHost(element: Element, className: string): HTMLElement | null {
  let host: Element | null = elementHasClass(element, className)
    ? element
    : element.closest(`.${className}`);
  if (host === null) {
    host = element.querySelector(`.${className}`);
  }
  return host && host.nodeType === 1 ? (host as HTMLElement) : null;
}

function createAceAdapter(host: HTMLElement, editor: AceEditorLike): GenericEditorAdapter {
  const read = (): string => editor.getValue();
  const hub = createChangeHub(read, (notify) => {
    const emitter = asEmitter(editor.getSession?.()) ?? asEmitter(editor);
    if (!emitter) {
      return () => {};
    }
    const handler = (): void => notify();
    emitter.on("change", handler);
    return () => detachEmitter(emitter, "change", handler);
  });
  return {
    kind: "ace",
    element: host,
    read,
    write(text) {
      hub.beginWrite();
      try {
        editor.setValue(text, -1);
      } finally {
        hub.endWrite();
      }
    },
    subscribe: (listener) => hub.subscribe(listener),
    dispose: () => hub.dispose()
  };
}

interface CodeMirror5Like {
  getValue(): string;
  setValue(value: string): void;
  on(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

function asCodeMirror5(value: unknown): CodeMirror5Like | null {
  if (
    typeof readUnknownProperty(value, "getValue") !== "function" ||
    typeof readUnknownProperty(value, "setValue") !== "function" ||
    typeof readUnknownProperty(value, "on") !== "function"
  ) {
    return null;
  }
  return value as CodeMirror5Like;
}

function createCodeMirror5Adapter(
  host: HTMLElement,
  instance: CodeMirror5Like
): GenericEditorAdapter {
  const read = (): string => instance.getValue();
  const hub = createChangeHub(read, (notify) => {
    const handler = (): void => notify();
    instance.on("change", handler);
    return () => {
      if (typeof instance.off === "function") {
        instance.off("change", handler);
      }
    };
  });
  return {
    kind: "cm5",
    element: host,
    read,
    write(text) {
      hub.beginWrite();
      try {
        instance.setValue(text);
      } finally {
        hub.endWrite();
      }
    },
    subscribe: (listener) => hub.subscribe(listener),
    dispose: () => hub.dispose()
  };
}

interface CodeMirror6ViewLike {
  state: {
    doc: {
      length: number;
      toString(): string;
    };
  };
  dispatch(spec: unknown): void;
  dom?: Element;
}

function asCodeMirror6View(value: unknown): CodeMirror6ViewLike | null {
  const state = readUnknownProperty(value, "state");
  const doc = readUnknownProperty(state, "doc");
  if (
    typeof state !== "object" ||
    state === null ||
    typeof doc !== "object" ||
    doc === null ||
    typeof readUnknownProperty(doc, "toString") !== "function" ||
    typeof readUnknownProperty(value, "dispatch") !== "function"
  ) {
    return null;
  }
  return value as CodeMirror6ViewLike;
}

/**
 * CM6 does not expose a public post-construction change listener. The view is
 * obtained from `.cmTile.view` (or `.cmView`) and validated through the view
 * constructor's own `findFromDOM`; subscriptions then combine a DOM input
 * listener with a 250 ms document snapshot while at least one listener exists.
 */
function findCodeMirror6View(host: Element): CodeMirror6ViewLike | null {
  const candidates: unknown[] = [
    readUnknownProperty(readUnknownProperty(host, "cmTile"), "view"),
    readUnknownProperty(host, "cmView")
  ];
  const content = host.querySelector?.(".cm-content");
  if (content) {
    candidates.push(
      readUnknownProperty(readUnknownProperty(content, "cmTile"), "view"),
      readUnknownProperty(content, "cmView")
    );
  }

  for (const candidate of candidates) {
    const view = asCodeMirror6View(candidate);
    if (!view) {
      continue;
    }
    const constructor = readUnknownProperty(view, "constructor");
    const findFromDOM = readUnknownProperty(constructor, "findFromDOM");
    if (typeof findFromDOM !== "function") {
      continue;
    }
    let resolved: unknown;
    try {
      resolved = findFromDOM.call(constructor, host);
    } catch {
      continue;
    }
    if (resolved !== view) {
      continue;
    }
    if (
      view.dom &&
      view.dom !== host &&
      !view.dom.contains(host) &&
      !host.contains(view.dom)
    ) {
      continue;
    }
    return view;
  }
  return null;
}

function createCodeMirror6Adapter(
  host: HTMLElement,
  view: CodeMirror6ViewLike
): GenericEditorAdapter {
  const read = (): string => view.state.doc.toString();
  const hub = createChangeHub(read, (notify) => {
    const dom = view.dom ?? host;
    const timerHost = dom.ownerDocument?.defaultView;
    const handler = (): void => notify();
    dom.addEventListener("input", handler, true);
    const timer = timerHost
      ? timerHost.setInterval(notify, CM6_POLL_MS)
      : null;
    return () => {
      dom.removeEventListener("input", handler, true);
      if (timer !== null) {
        timerHost?.clearInterval(timer);
      }
    };
  });
  return {
    kind: "cm6",
    element: host,
    read,
    write(text) {
      hub.beginWrite();
      try {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: text
          }
        });
      } finally {
        hub.endWrite();
      }
    },
    subscribe: (listener) => hub.subscribe(listener),
    dispose: () => hub.dispose()
  };
}

interface MonacoModelLike {
  getValue(): string;
  getFullModelRange?(): unknown;
  setValue?(text: string): void;
}

interface MonacoEditorLike {
  getModel?(): unknown;
  getValue?(): string;
  setValue?(text: string): void;
  getDomNode?(): unknown;
  executeEdits?(source: string, edits: readonly unknown[]): unknown;
  onDidChangeModelContent?(listener: () => void): unknown;
}

function asMonacoModel(value: unknown): MonacoModelLike | null {
  return typeof readUnknownProperty(value, "getValue") === "function"
    ? (value as MonacoModelLike)
    : null;
}

function asMonacoEditor(value: unknown): MonacoEditorLike | null {
  if (
    typeof readUnknownProperty(value, "getModel") !== "function" &&
    typeof readUnknownProperty(value, "getValue") !== "function"
  ) {
    return null;
  }
  return value as MonacoEditorLike;
}

function monacoEditors(monaco: unknown): unknown[] {
  const editor = readUnknownProperty(monaco, "editor");
  const getEditors = readUnknownProperty(editor, "getEditors");
  if (typeof getEditors !== "function") {
    return [];
  }
  try {
    const value = getEditors.call(editor) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function findMonacoEditor(
  host: HTMLElement,
  monaco: unknown
): MonacoEditorLike | null {
  let containing: MonacoEditorLike | null = null;
  for (const candidate of monacoEditors(monaco)) {
    const editor = asMonacoEditor(candidate);
    if (!editor) {
      continue;
    }
    const dom = editor.getDomNode?.();
    if (dom === host) {
      return editor;
    }
    if (dom instanceof Element && (dom.contains(host) || host.contains(dom))) {
      containing ??= editor;
    }
  }
  return containing;
}

function monacoModel(editor: MonacoEditorLike): MonacoModelLike | null {
  return asMonacoModel(editor.getModel?.());
}

function createMonacoAdapter(
  host: HTMLElement,
  editor: MonacoEditorLike
): GenericEditorAdapter {
  const read = (): string => {
    const model = monacoModel(editor);
    if (model) {
      return model.getValue();
    }
    return typeof editor.getValue === "function" ? editor.getValue() : "";
  };

  const hub = createChangeHub(read, (notify) => {
    if (typeof editor.onDidChangeModelContent !== "function") {
      return () => {};
    }
    const disposable = editor.onDidChangeModelContent(() => notify());
    const dispose = readUnknownProperty(disposable, "dispose");
    if (dispose) {
      return () => {
        if (typeof dispose === "function") {
          dispose.call(disposable);
        }
      };
    }
    if (typeof disposable === "function") {
      const cleanup = disposable;
      return () => cleanup.call(undefined);
    }
    return () => {};
  });

  return {
    kind: "monaco",
    element: host,
    read,
    write(text) {
      hub.beginWrite();
      try {
        const model = monacoModel(editor);
        if (
          model &&
          typeof model.getFullModelRange === "function" &&
          typeof editor.executeEdits === "function"
        ) {
          editor.executeEdits("monacoanywhere", [
            { range: model.getFullModelRange(), text }
          ]);
        } else if (model && typeof model.setValue === "function") {
          model.setValue(text);
        } else if (typeof editor.setValue === "function") {
          editor.setValue(text);
        } else {
          throw new Error("Monaco editor does not expose a writable model");
        }
      } finally {
        hub.endWrite();
      }
    },
    subscribe: (listener) => hub.subscribe(listener),
    dispose: () => hub.dispose()
  };
}

export interface GenericAdapterEnvironment {
  readonly monaco?: unknown;
  readonly pageWindow?: Window & typeof globalThis;
}

function pageMonaco(element: Element, environment: GenericAdapterEnvironment): unknown {
  if (environment.monaco !== undefined) {
    return environment.monaco;
  }
  const view = environment.pageWindow ?? element.ownerDocument?.defaultView;
  return readUnknownProperty(view, "monaco");
}

/**
 * Build an adapter for one already resolved element. Returns null when the
 * page instance cannot be validated; it never creates a replacement instance.
 */
export function createGenericAdapter(
  rule: GenericRule,
  element: Element,
  environment: GenericAdapterEnvironment = {}
): GenericEditorAdapter | null {
  switch (rule.editorKind) {
    case "textarea": {
      if (detectEditorKind(element) !== "textarea") {
        return null;
      }
      return createTextareaAdapter(element as HTMLElement);
    }
    case "ace": {
      const host = findClassHost(element, "ace_editor");
      if (!host) {
        return null;
      }
      const editor = asAceEditor(
        readUnknownProperty(readUnknownProperty(host, "env"), "editor")
      );
      return editor ? createAceAdapter(host, editor) : null;
    }
    case "cm5": {
      const host = findClassHost(element, "CodeMirror");
      if (!host) {
        return null;
      }
      const instance = asCodeMirror5(readUnknownProperty(host, "CodeMirror"));
      return instance ? createCodeMirror5Adapter(host, instance) : null;
    }
    case "cm6": {
      const host = findClassHost(element, "cm-editor");
      if (!host) {
        return null;
      }
      const view = findCodeMirror6View(host);
      return view ? createCodeMirror6Adapter(host, view) : null;
    }
    case "monaco": {
      const host = findClassHost(element, "monaco-editor");
      if (!host) {
        return null;
      }
      const editor = findMonacoEditor(host, pageMonaco(element, environment));
      return editor ? createMonacoAdapter(host, editor) : null;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Rule resolution                                                            */
/* ------------------------------------------------------------------------- */

export type GenericFallbackReason =
  | "invalid-rule"
  | "no-document"
  | "no-candidate"
  | "ambiguous-candidates"
  | "unsupported-editor";

export type GenericLanguageFallbackReason =
  | "invalid-rule"
  | "no-document"
  | "absent"
  | "no-candidate"
  | "ambiguous-candidates"
  | "unsupported-control";

export interface GenericResolveOptions extends GenericAdapterEnvironment {
  readonly document?: Document;
  readonly root?: ParentNode;
  readonly isVisible?: (element: Element) => boolean;
}

export interface GenericEditorFallback {
  readonly status: "fallback";
  readonly reason: GenericFallbackReason;
  readonly candidateCount: number;
  readonly issues?: readonly string[];
  readonly detail?: string;
}

export type GenericEditorResolution =
  | {
      readonly status: "ready";
      readonly adapter: GenericEditorAdapter;
      readonly candidateCount: 1;
    }
  | GenericEditorFallback;

export interface GenericLanguageFallback {
  readonly status: "fallback";
  readonly reason: GenericLanguageFallbackReason;
  readonly candidateCount: number;
  readonly issues?: readonly string[];
}

export type GenericLanguageResolution =
  | {
      readonly status: "ready";
      readonly control: GenericLanguageControl;
      readonly candidateCount: 1;
    }
  | GenericLanguageFallback;

function querySelectorMatches(
  root: ParentNode,
  selector: string
): Element[] | null {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return null;
  }
}

/**
 * Resolve a rule to exactly one visible candidate. Zero candidates, multiple
 * visible candidates, or an unverifiable page instance all return an explicit
 * fallback reason; the caller must keep the original editor in those cases.
 */
export function resolveGenericEditor(
  rule: unknown,
  options: GenericResolveOptions = {}
): GenericEditorResolution {
  const parsed = tryParseRule(rule);
  if (!parsed.ok) {
    return {
      status: "fallback",
      reason: "invalid-rule",
      candidateCount: 0,
      issues: parsed.issues
    };
  }

  const pageDocument =
    options.document ?? (typeof document === "undefined" ? undefined : document);
  const root = options.root ?? pageDocument;
  if (!root) {
    return { status: "fallback", reason: "no-document", candidateCount: 0 };
  }

  let selector: string;
  try {
    selector = compileSelector(parsed.rule.editorSelector);
  } catch {
    return { status: "fallback", reason: "invalid-rule", candidateCount: 0 };
  }

  const matches = querySelectorMatches(root, selector);
  if (matches === null) {
    return { status: "fallback", reason: "invalid-rule", candidateCount: 0 };
  }

  const choice = chooseVisibleCandidate(matches, options.isVisible);
  if (choice.status === "none") {
    return { status: "fallback", reason: "no-candidate", candidateCount: 0 };
  }
  if (choice.status === "ambiguous") {
    return {
      status: "fallback",
      reason: "ambiguous-candidates",
      candidateCount: choice.visible.length
    };
  }

  let adapter: GenericEditorAdapter | null = null;
  try {
    adapter = createGenericAdapter(parsed.rule, choice.candidate as Element, {
      monaco: options.monaco,
      pageWindow: options.pageWindow
    });
  } catch {
    adapter = null;
  }
  if (!adapter) {
    return {
      status: "fallback",
      reason: "unsupported-editor",
      candidateCount: 1,
      detail: parsed.rule.editorKind
    };
  }
  return { status: "ready", adapter, candidateCount: 1 };
}

/**
 * Resolve the optional language selector to exactly one visible control.
 * Absent selectors and ambiguous matches are reported, never guessed.
 */
export function resolveGenericLanguageControl(
  rule: unknown,
  options: GenericResolveOptions = {}
): GenericLanguageResolution {
  const parsed = tryParseRule(rule);
  if (!parsed.ok) {
    return {
      status: "fallback",
      reason: "invalid-rule",
      candidateCount: 0,
      issues: parsed.issues
    };
  }
  if (parsed.rule.languageSelector === undefined) {
    return { status: "fallback", reason: "absent", candidateCount: 0 };
  }

  const pageDocument =
    options.document ?? (typeof document === "undefined" ? undefined : document);
  const root = options.root ?? pageDocument;
  if (!root) {
    return { status: "fallback", reason: "no-document", candidateCount: 0 };
  }

  let selector: string;
  try {
    selector = compileSelector(parsed.rule.languageSelector);
  } catch {
    return { status: "fallback", reason: "invalid-rule", candidateCount: 0 };
  }

  const matches = querySelectorMatches(root, selector);
  if (matches === null) {
    return { status: "fallback", reason: "invalid-rule", candidateCount: 0 };
  }

  const choice = chooseVisibleCandidate(matches, options.isVisible);
  if (choice.status === "none") {
    return { status: "fallback", reason: "no-candidate", candidateCount: 0 };
  }
  if (choice.status === "ambiguous") {
    return {
      status: "fallback",
      reason: "ambiguous-candidates",
      candidateCount: choice.visible.length
    };
  }

  let control: GenericLanguageControl | null = null;
  try {
    control = createLanguageControl(choice.candidate as Element);
  } catch {
    control = null;
  }
  if (!control) {
    return {
      status: "fallback",
      reason: "unsupported-control",
      candidateCount: 1
    };
  }
  return { status: "ready", control, candidateCount: 1 };
}

/* ------------------------------------------------------------------------- */
/* Language mapping helpers                                                   */
/* ------------------------------------------------------------------------- */

export type GenericStandardSelection =
  | { readonly status: "selected"; readonly optionId: string }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous"; readonly optionIds: readonly string[] }
  | { readonly status: "unsupported"; readonly optionId: string };

export function mappedStandard(
  optionId: string,
  languageMap: Readonly<Record<string, Standard | null>>
): Standard | null {
  const value = Object.prototype.hasOwnProperty.call(languageMap, optionId)
    ? languageMap[optionId]
    : null;
  return isStandard(value) ? value : null;
}

export function optionsForStandard(
  languageMap: Readonly<Record<string, Standard | null>>,
  standard: Standard
): string[] {
  return Object.keys(languageMap).filter(
    (optionId) => languageMap[optionId] === standard
  );
}

/**
 * Select the single option explicitly mapped to `standard`. Multiple mapped
 * options are reported instead of picking one; no mapping leaves the site
 * control untouched.
 */
export function selectStandardLanguage(
  control: GenericLanguageControl,
  languageMap: Readonly<Record<string, Standard | null>>,
  standard: Standard
): GenericStandardSelection {
  const optionIds = optionsForStandard(languageMap, standard);
  if (optionIds.length === 0) {
    return { status: "missing" };
  }
  if (optionIds.length > 1) {
    return { status: "ambiguous", optionIds };
  }
  const optionId = optionIds[0] as string;
  return control.selectOption(optionId)
    ? { status: "selected", optionId }
    : { status: "unsupported", optionId };
}
