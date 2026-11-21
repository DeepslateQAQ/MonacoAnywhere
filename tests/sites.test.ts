import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createAtCoderBridge,
  atCoderAccountScope,
  atCoderProblemKey,
  atCoderStableOptionId
} from "../extension/src/sites/atcoder";
import {
  createCodeforcesBridge,
  codeforcesAccountScope,
  codeforcesProblemKey,
  codeforcesLanguageOptionSet
} from "../extension/src/sites/codeforces";
import {
  createHydroBridge,
  detectHydroSiteRemote,
  hydroAccountScope,
  hydroOriginKey,
  hydroPostSubmitUrl,
  hydroProblemKey,
  readHydroLanguages
} from "../extension/src/sites/hydro";
import {
  createLuoguBridge,
  luoguAccountScope,
  luoguProblemKey,
  luoguSlotId
} from "../extension/src/sites/luogu";
import { SiteBridgeError } from "../extension/src/sites/types";
import { chooseProfileForStandard } from "../extension/src/profiles/sync";

/* ------------------------------------------------------------------ */
/* Minimal DOM fixture harness (no dependency addition).              */
/* ------------------------------------------------------------------ */

type Listener = (event: FakeEvent) => void;
type ListenerOptions = boolean | { readonly capture?: boolean };

class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  target: FakeElement | null = null;
  currentTarget: FakeElement | FakeDocument | null = null;
  defaultPrevented = false;
  propagationStopped = false;

  constructor(
    type: string,
    init: { readonly bubbles?: boolean; readonly cancelable?: boolean } = {}
  ) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

class FakeMouseEvent extends FakeEvent {}

function isCapture(options: ListenerOptions | undefined): boolean {
  return typeof options === "boolean"
    ? options
    : options?.capture === true;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

class FakeText {
  readonly nodeType = 3;
  data: string;
  parentElement: FakeElement;

  constructor(data: string, parent: FakeElement) {
    this.data = data;
    this.parentElement = parent;
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }
}

type FakeNode = FakeElement | FakeText;
type ListenerEntry = { readonly capture: boolean; readonly fn: Listener };

class FakeElement {
  readonly nodeType = 1;
  readonly localName: string;
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  parentElement: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  style = { display: "", visibility: "" };
  dataset: Record<string, string> = {};
  _value: string | undefined;
  _checked: boolean | undefined;
  _selected: boolean | undefined;
  readonly listeners = new Map<string, ListenerEntry[]>();
  private readonly attrs = new Map<string, string>();

  constructor(
    doc: FakeDocument,
    tag: string,
    attrs: Record<string, string> = {}
  ) {
    this.ownerDocument = doc;
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    for (const [name, value] of Object.entries(attrs)) {
      this.setAttribute(name, value);
    }
  }

  get children(): FakeElement[] {
    return this.childNodes.filter(
      (node): node is FakeElement => node instanceof FakeElement
    );
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = value ? [new FakeText(value, this)] : [];
  }

  get id(): string {
    return this.attrs.get("id") ?? "";
  }

  set id(value: string) {
    this.attrs.set("id", value);
  }

  get className(): string {
    return this.attrs.get("class") ?? "";
  }

  set className(value: string) {
    this.attrs.set("class", value);
  }

  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }

  get classList() {
    const self = this;
    return {
      contains(name: string): boolean {
        return self.className.split(/\s+/).includes(name);
      },
      add(name: string): void {
        const classes = new Set(
          self.className.split(/\s+/).filter(Boolean)
        );
        classes.add(name);
        self.className = Array.from(classes).join(" ");
      },
      remove(name: string): void {
        const classes = new Set(
          self.className.split(/\s+/).filter(Boolean)
        );
        classes.delete(name);
        self.className = Array.from(classes).join(" ");
      }
    };
  }

  get value(): string {
    if (this.localName === "select") {
      const index = this.selectedIndex;
      const option = this.options[index];
      return option ? option.value : "";
    }
    if (this.localName === "option") {
      const value = this.getAttribute("value");
      return value !== null ? value : this.textContent.trim();
    }
    if (this.localName === "textarea" || this.localName === "input") {
      return this._value !== undefined ? this._value : this.textContent;
    }
    return this._value ?? "";
  }

  set value(next: string) {
    if (this.localName === "select") {
      for (const option of this.options) {
        option._selected = option.value === next;
      }
      return;
    }
    if (this.localName === "option") {
      this.setAttribute("value", next);
      return;
    }
    this._value = next;
  }

  get options(): FakeElement[] {
    return this.children.filter((child) => child.localName === "option");
  }

  get selectedIndex(): number {
    const options = this.options;
    const explicit = options.findIndex(
      (option) =>
        option._selected === true ||
        (option._selected === undefined &&
          option.hasAttribute("selected"))
    );
    if (explicit >= 0) return explicit;
    return options.length > 0 ? 0 : -1;
  }

  set selectedIndex(index: number) {
    this.options.forEach((option, optionIndex) => {
      option._selected = optionIndex === index;
    });
  }

  get label(): string {
    return this.localName === "option" ? this.textContent.trim() : "";
  }

  get checked(): boolean {
    return this._checked ?? this.hasAttribute("checked");
  }

  set checked(value: boolean) {
    this._checked = value;
  }

  get selected(): boolean {
    return (
      this._selected ??
      (this.hasAttribute("selected") || this.selectedIndex === 0)
    );
  }

  set selected(value: boolean) {
    this._selected = value;
  }

  get isConnected(): boolean {
    let node: FakeElement | null = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.ownerDocument.documentElement;
  }

  appendChild<T extends FakeNode>(node: T): T {
    if (node.parentElement && node instanceof FakeElement) {
      node.parentElement.removeChild(node);
    }
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node: FakeNode): void {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    if (node instanceof FakeElement) node.parentElement = null;
  }

  remove(): void {
    if (this.parentElement) this.parentElement.removeChild(this);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const lower = name.toLowerCase();
    this.attrs.set(lower, value);
    if (lower === "style") this.applyStyle(value);
    if (lower.startsWith("data-")) {
      const key = lower
        .slice(5)
        .replace(/-([a-z])/g, (_match, letter: string) =>
          letter.toUpperCase()
        );
      this.dataset[key] = value;
    }
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name.toLowerCase());
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name.toLowerCase());
  }

  contains(node: FakeNode | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  matches(selector: string): boolean {
    return matchesSelector(this, selector);
  }

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return querySelectorAllWithin(this, selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(
    type: string,
    listener: Listener,
    options?: ListenerOptions
  ): void {
    const entry: ListenerEntry = {
      capture: isCapture(options),
      fn: listener
    };
    const list = this.listeners.get(type);
    if (list) list.push(entry);
    else this.listeners.set(type, [entry]);
  }

  removeEventListener(
    type: string,
    listener: Listener,
    options?: ListenerOptions
  ): void {
    const capture = isCapture(options);
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter(
        (entry) => entry.fn !== listener || entry.capture !== capture
      )
    );
  }

  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    const path = eventPath(this);
    for (let i = path.length - 1; i >= 1; i -= 1) {
      const target = path[i];
      if (target) emitListeners(target, event, true);
      if (event.propagationStopped) return !event.defaultPrevented;
    }
    emitListeners(this, event, "target");
    if (event.propagationStopped) return !event.defaultPrevented;
    if (event.bubbles) {
      for (let i = 1; i < path.length; i += 1) {
        const target = path[i];
        if (target) emitListeners(target, event, false);
        if (event.propagationStopped) break;
      }
    }
    return !event.defaultPrevented;
  }

  private applyStyle(value: string): void {
    for (const declaration of value.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim();
      const propertyValue = declaration.slice(separator + 1).trim();
      if (property === "display") this.style.display = propertyValue;
      if (property === "visibility") {
        this.style.visibility = propertyValue;
      }
    }
  }
}

class FakeDocument {
  documentElement!: FakeElement;
  defaultView!: FakeWindow;
  location!: FakeLocation;
  readonly listeners = new Map<string, ListenerEntry[]>();

  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }

  get body(): FakeElement | null {
    return this.documentElement?.querySelector("body") ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement
      ? querySelectorAllWithin(this.documentElement, selector)
      : [];
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getElementById(id: string): FakeElement | null {
    return this.querySelectorAll("*").find(
      (element) => element.id === id
    ) ?? null;
  }

  addEventListener(
    type: string,
    listener: Listener,
    options?: ListenerOptions
  ): void {
    const entry: ListenerEntry = {
      capture: isCapture(options),
      fn: listener
    };
    const list = this.listeners.get(type);
    if (list) list.push(entry);
    else this.listeners.set(type, [entry]);
  }

  removeEventListener(
    type: string,
    listener: Listener,
    options?: ListenerOptions
  ): void {
    const capture = isCapture(options);
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter(
        (entry) => entry.fn !== listener || entry.capture !== capture
      )
    );
  }
}

class FakeWindow {
  document: FakeDocument;
  location: FakeLocation;
  Event = FakeEvent;
  MouseEvent = FakeMouseEvent;
  setTimeout = setTimeout;
  clearTimeout = clearTimeout;

  constructor(doc: FakeDocument, location: FakeLocation) {
    this.document = doc;
    this.location = location;
    doc.defaultView = this;
  }
}

interface FakeLocation {
  href: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

function fakeLocation(href: string): FakeLocation {
  const url = new URL(href);
  return {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  };
}

function eventPath(start: FakeElement): Array<FakeElement | FakeDocument> {
  const path: Array<FakeElement | FakeDocument> = [];
  let node: FakeElement | FakeDocument | null = start;
  while (node) {
    path.push(node);
    if (node instanceof FakeElement) {
      node = node.parentElement ?? node.ownerDocument;
    } else {
      node = null;
    }
  }
  return path;
}

function emitListeners(
  target: FakeElement | FakeDocument,
  event: FakeEvent,
  filter: boolean | "target"
): void {
  const list = target.listeners.get(event.type);
  if (!list) return;
  for (const entry of [...list]) {
    if (filter !== "target" && entry.capture !== filter) continue;
    event.currentTarget = target;
    entry.fn(event);
    if (event.propagationStopped) return;
  }
}

interface AttributeTest {
  readonly name: string;
  readonly operator?: string;
  readonly value?: string;
}

interface CompoundSelector {
  readonly tag: string | null;
  readonly id: string | null;
  readonly classes: readonly string[];
  readonly attributes: readonly AttributeTest[];
}

function parseCompound(selector: string): CompoundSelector {
  let tag: string | null = null;
  let id: string | null = null;
  const classes: string[] = [];
  const attributes: AttributeTest[] = [];
  let index = 0;
  if (selector[index] === "*") {
    index += 1;
  } else {
    const match = /^[a-zA-Z][\w-]*/.exec(selector);
    if (match) {
      tag = match[0].toLowerCase();
      index = match[0].length;
    }
  }
  while (index < selector.length) {
    const char = selector[index];
    if (char === "#") {
      const match = /^#([\w-]+)/.exec(selector.slice(index));
      if (!match) break;
      id = match[1] ?? null;
      index += match[0].length;
      continue;
    }
    if (char === ".") {
      const match = /^\.([\w-]+)/.exec(selector.slice(index));
      if (!match) break;
      const name = match[1];
      if (name) classes.push(name);
      index += match[0].length;
      continue;
    }
    if (char === "[") {
      const close = selector.indexOf("]", index + 1);
      if (close < 0) break;
      const body = selector.slice(index + 1, close).trim();
      const match =
        /^([\w:-]+)(?:(=|\^=|\$=|\*=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/.exec(
          body
        );
      if (match?.[1]) {
        attributes.push({
          name: match[1].toLowerCase(),
          operator: match[2],
          value: match[3] ?? match[4] ?? match[5] ?? ""
        });
      }
      index = close + 1;
      continue;
    }
    break;
  }
  return { tag, id, classes, attributes };
}

function matchesCompound(
  element: FakeElement,
  selector: CompoundSelector
): boolean {
  if (selector.tag && selector.tag !== element.localName) return false;
  if (selector.id && selector.id !== element.id) return false;
  for (const name of selector.classes) {
    if (!element.classList.contains(name)) return false;
  }
  for (const attribute of selector.attributes) {
    if (!element.hasAttribute(attribute.name)) return false;
    if (!attribute.operator) continue;
    const value = element.getAttribute(attribute.name) ?? "";
    const expected = attribute.value ?? "";
    if (attribute.operator === "=" && value !== expected) return false;
    if (attribute.operator === "^=" && !value.startsWith(expected)) {
      return false;
    }
    if (attribute.operator === "$=" && !value.endsWith(expected)) {
      return false;
    }
    if (attribute.operator === "*=" && !value.includes(expected)) {
      return false;
    }
  }
  return true;
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  for (const group of selector.split(",")) {
    const parts = group.trim().split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) continue;
    if (!matchesCompound(element, parseCompound(last))) continue;
    let current: FakeElement | null = element.parentElement;
    let matched = true;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      const part = parts[index];
      if (!part) continue;
      const compound = parseCompound(part);
      while (current && !matchesCompound(current, compound)) {
        current = current.parentElement;
      }
      if (!current) {
        matched = false;
        break;
      }
      current = current.parentElement;
    }
    if (matched) return true;
  }
  return false;
}

function querySelectorAllWithin(
  root: FakeElement,
  selector: string
): FakeElement[] {
  const results: FakeElement[] = [];
  const visit = (element: FakeElement): void => {
    for (const child of element.children) {
      if (matchesSelector(child, selector)) results.push(child);
      visit(child);
    }
  };
  visit(root);
  return results;
}

const VOID_TAGS: Record<string, true> = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true
};

function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function parseHtml(html: string, doc: FakeDocument): void {
  const root = doc.createElement("html");
  doc.documentElement = root;
  const stack: FakeElement[] = [root];
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf("<", index);
    if (start < 0) {
      appendText(html.slice(index));
      break;
    }
    if (start > index) appendText(html.slice(index, start));
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("</", start)) {
      const end = html.indexOf(">", start + 2);
      if (end < 0) break;
      const name = html.slice(start + 2, end).trim().toLowerCase();
      closeElement(name);
      index = end + 1;
      continue;
    }
    const end = html.indexOf(">", start + 1);
    if (end < 0) break;
    index = end + 1;
    let raw = html.slice(start + 1, end);
    if (raw.startsWith("!") || raw.startsWith("?")) continue;
    let selfClosing = false;
    if (raw.endsWith("/")) {
      selfClosing = true;
      raw = raw.slice(0, -1);
    }
    const match = /^\s*([a-zA-Z][\w:-]*)([\s\S]*)$/.exec(raw);
    if (!match?.[1]) continue;
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[2] ?? "");
    if (tag === "html" && stack.length === 1) {
      for (const [name, value] of Object.entries(attrs)) {
        root.setAttribute(name, value);
      }
      continue;
    }
    const element = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      element.setAttribute(name, value);
    }
    const parent = stack[stack.length - 1];
    if (!parent) break;
    parent.appendChild(element);
    if (VOID_TAGS[tag] || selfClosing) continue;
    stack.push(element);
    if (tag === "script" || tag === "style") {
      const closeIndex = html.toLowerCase().indexOf(`</${tag}`, index);
      if (closeIndex >= 0) {
        element.appendChild(
          new FakeText(html.slice(index, closeIndex), element)
        );
        index = closeIndex;
      }
    }
  }

  function appendText(text: string): void {
    if (!text) return;
    const parent = stack[stack.length - 1];
    if (parent) parent.appendChild(new FakeText(text, parent));
  }

  function closeElement(name: string): void {
    for (let cursor = stack.length - 1; cursor >= 1; cursor -= 1) {
      const element = stack[cursor];
      if (element?.localName === name) {
        stack.length = cursor;
        return;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fixture helpers and fake site editors.                             */
/* ------------------------------------------------------------------ */

const FIXTURE_DIR = new URL("./fixtures/", import.meta.url);

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_DIR), "utf8");
}

function loadFixture(
  name: string,
  href: string
): { doc: FakeDocument; win: FakeWindow; location: FakeLocation } {
  const doc = new FakeDocument();
  const location = fakeLocation(href);
  doc.location = location;
  const win = new FakeWindow(doc, location);
  parseHtml(fixture(name), doc);
  return { doc, win, location };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function setWindowGlobal(
  win: FakeWindow,
  name: string,
  value: unknown
): void {
  Reflect.set(win, name, value);
}

function attachCm6(element: FakeElement, initial: string) {
  let text = initial;
  const constructor = function EditorView(): void {} as unknown as {
    findFromDOM?: (node: unknown) => unknown;
  };
  const view: Record<string, unknown> = {};
  Object.defineProperty(view, "state", {
    get: () => ({
      doc: {
        length: text.length,
        toString: () => text
      }
    })
  });
  view.dispatch = (spec: {
    changes: { readonly insert: string };
  }) => {
    text = spec.changes.insert;
    element.dispatchEvent(
      new FakeEvent("input", { bubbles: true })
    );
  };
  view.contentDOM = element;
  view.constructor = constructor;
  constructor.findFromDOM = (node: unknown) =>
    node === element ? view : null;
  Reflect.set(element, "cmTile", { view });
  return {
    view,
    getText: () => text,
    setText(next: string): void {
      text = next;
      element.dispatchEvent(new FakeEvent("input", { bubbles: true }));
    }
  };
}

function makeAce(initial: string) {
  let text = initial;
  const listeners = new Set<() => void>();
  const session = {
    on(event: string, listener: () => void): void {
      if (event === "change") listeners.add(listener);
    },
    off(event: string, listener: () => void): void {
      if (event === "change") listeners.delete(listener);
    }
  };
  const editor = {
    getValue: () => text,
    setValue(next: string): void {
      text = next;
      for (const listener of [...listeners]) listener();
    },
    getSession: () => session
  };
  return {
    editor,
    getText: () => text,
    fire(): void {
      for (const listener of [...listeners]) listener();
    },
    setSilent(next: string): void {
      text = next;
    }
  };
}

function makeMonaco(container: FakeElement, initial: string) {
  let text = initial;
  const listeners = new Set<() => void>();
  const model = {
    getValue: () => text,
    getFullModelRange: () => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: text.length + 1
    }),
    onDidChangeContent(listener: () => void) {
      listeners.add(listener);
      return {
        dispose: () => listeners.delete(listener)
      };
    }
  };
  const editor = {
    getModel: () => model,
    executeEdits(
      _source: string,
      edits: readonly { readonly text: string }[]
    ): boolean {
      const edit = edits[0];
      if (!edit) return false;
      text = edit.text;
      for (const listener of [...listeners]) listener();
      return true;
    },
    onDidChangeModelContent(listener: () => void) {
      listeners.add(listener);
      return {
        dispose: () => listeners.delete(listener)
      };
    },
    getDomNode: () => container
  };
  return {
    monaco: { editor: { getEditors: () => [editor] } },
    editor,
    model,
    getText: () => text,
    setSilent(next: string): void {
      text = next;
    },
    fire(): void {
      for (const listener of [...listeners]) listener();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Luogu                                                              */
/* ------------------------------------------------------------------ */

describe("Luogu adapter", () => {
  it("extracts stable context and validates CM6 ownership", () => {
    const { doc, win, location } = loadFixture(
      "luogu.html",
      "https://www.luogu.com.cn/problem/P1001#submit"
    );
    const content = doc.querySelector(".cm-content");
    if (!content) throw new Error("fixture missing .cm-content");
    const cm = attachCm6(content, "#include <iostream>\nint main(){}");

    expect(luoguProblemKey(location)).toBe("P1001");
    expect(luoguAccountScope(doc)).toBe("642504");
    expect(luoguSlotId(content, 0)).toBe("submit:0");

    const bridge = createLuoguBridge({
      document: doc,
      window: win,
      location
    });
    const context = bridge.context();
    expect(context.site).toBe("luogu");
    expect(context.originKey).toBe("https://www.luogu.com.cn");
    expect(context.problemKey).toBe("P1001");
    expect(context.accountScope).toBe("642504");

    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("CM6 slot not located");
    expect(slot.kind).toBe("cm6");
    expect(slot.retainedMonaco).toBe(false);
    expect(slot.element).toBe(content.parentElement);
    expect(slot.selector.length).toBeGreaterThan(0);
    expect(bridge.readNative(slot)).toContain("int main()");
    expect(bridge.slotIds()).toEqual(["submit:0"]);

    bridge.writeNative(slot, "int x;", "sync");
    expect(cm.getText()).toBe("int x;");
    expect(bridge.readNative(slot)).toBe("int x;");

    const events: string[] = [];
    const unsubscribe = bridge.subscribeNative(slot, (text, origin) => {
      events.push(`${origin}:${text}`);
    });
    bridge.writeNative(slot, "int y;", "sync");
    expect(events).toEqual([]);
    cm.setText("int z;");
    expect(events).toEqual(["user:int z;"]);
    unsubscribe();
    bridge.destroy();
  });

  it("rejects a view whose findFromDOM does not own the element", () => {
    const { doc, win, location } = loadFixture(
      "luogu.html",
      "https://www.luogu.com.cn/problem/P1001"
    );
    const content = doc.querySelector(".cm-content");
    if (!content) throw new Error("fixture missing .cm-content");
    const cm = attachCm6(content, "int main(){}");
    const constructor = (
      cm.view as unknown as { constructor: { findFromDOM: () => unknown } }
    ).constructor;
    constructor.findFromDOM = () => ({ different: true });
    const bridge = createLuoguBridge({ document: doc, window: win, location });
    expect(bridge.locateEditors()).toEqual([]);
    bridge.destroy();
  });

  it("maps exact labels, keeps duplicate C++14 explicit, and suppresses echoes", async () => {
    const { doc, win, location } = loadFixture(
      "luogu.html",
      "https://www.luogu.com.cn/problem/P1001#submit"
    );
    const content = doc.querySelector(".cm-content");
    if (!content) throw new Error("fixture missing .cm-content");
    attachCm6(content, "int main(){}");
    const bridge = createLuoguBridge({ document: doc, window: win, location });
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("CM6 slot not located");

    expect(bridge.readLanguageOption(slot)).toBe("C++14 (GCC 9)");
    const set = bridge.languageOptionSet(slot);
    expect(set.complete).toBe(true);
    expect(set.options.map((option) => option.optionId)).toContain("C++23");
    expect(set.options.map((option) => option.optionId)).toContain(
      "C++14 (GCC 9)"
    );

    const profiles = bridge.languageProfiles(slot);
    const duplicate = profiles.profiles.filter(
      (profile) => profile.standard === "c++14"
    );
    expect(duplicate).toHaveLength(2);
    expect(chooseProfileForStandard(profiles.profiles, "c++14").kind).toBe(
      "many"
    );
    expect(chooseProfileForStandard(profiles.profiles, "c++23").kind).toBe(
      "one"
    );

    const trigger = doc.querySelector(".combo-wrapper.lang-select .text");
    const dropdown = doc.querySelector(".dropdown");
    if (!trigger || !dropdown) throw new Error("fixture missing combo");
    trigger.addEventListener("click", () => {
      dropdown.style.display = "";
    });
    for (const item of dropdown.querySelectorAll("li")) {
      const label = item.textContent.trim();
      item.addEventListener("click", () => {
        trigger.textContent = label;
      });
    }

    const languageEvents: string[] = [];
    const unsubscribe = bridge.subscribeLanguage(slot, (optionId, origin) => {
      languageEvents.push(`${origin}:${optionId}`);
    });
    await settle();

    expect(bridge.selectLanguageOption(slot, "C++23")).toBe(true);
    await settle();
    expect(bridge.readLanguageOption(slot)).toBe("C++23");
    expect(languageEvents).toEqual([]);

    const c20 = dropdown
      .querySelectorAll("li")
      .find((item) => item.textContent.trim() === "C++20");
    if (!c20) throw new Error("fixture missing C++20");
    c20.dispatchEvent(new FakeMouseEvent("click", { bubbles: true }));
    await settle();
    expect(languageEvents).toEqual(["user:C++20"]);

    unsubscribe();
    bridge.destroy();
  });

  it("degrades language sync when more than one combo is visible", () => {
    const { doc, win, location } = loadFixture(
      "luogu.html",
      "https://www.luogu.com.cn/problem/P1001#submit"
    );
    const content = doc.querySelector(".cm-content");
    if (!content) throw new Error("fixture missing .cm-content");
    attachCm6(content, "int main(){}");
    const bridge = createLuoguBridge({ document: doc, window: win, location });
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("CM6 slot not located");

    const ide = doc.querySelector("#ide");
    const hiddenCombo = doc.querySelector(
      "#ide .combo-wrapper.lang-select"
    );
    if (!ide || !hiddenCombo) throw new Error("fixture missing IDE combo");
    ide.style.display = "";
    hiddenCombo.style.display = "";

    const control = bridge.locateLanguageControl(slot);
    expect(control?.kind).toBe("unsupported");
    expect(bridge.readLanguageOption(slot)).toBeNull();
    expect(bridge.languageIssue(slot)).toContain("Multiple visible");
    expect(bridge.selectLanguageOption(slot, "C++17")).toBe(false);
    bridge.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* AtCoder                                                            */
/* ------------------------------------------------------------------ */

describe("AtCoder adapter", () => {
  function setup() {
    const loaded = loadFixture(
      "atcoder.html",
      "https://atcoder.jp/contests/abc380/submit"
    );
    const editorElement = loaded.doc.querySelector("#editor");
    if (!editorElement) throw new Error("fixture missing #editor");
    const ace = makeAce("int main() { return 0; }");
    Reflect.set(editorElement, "env", { editor: ace.editor });
    const bridge = createAtCoderBridge({
      document: loaded.doc,
      window: loaded.win,
      location: loaded.location
    });
    return { ...loaded, editorElement, ace, bridge };
  }

  it("uses #editor.env.editor and syncs text through Ace", () => {
    const { bridge, ace } = setup();
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("Ace slot not located");
    expect(slot.kind).toBe("ace");
    expect(slot.retainedMonaco).toBe(false);
    expect(bridge.readNative(slot)).toContain("int main()");

    bridge.writeNative(slot, "int value;", "sync");
    expect(ace.getText()).toBe("int value;");

    const events: string[] = [];
    const unsubscribe = bridge.subscribeNative(slot, (text, origin) => {
      events.push(`${origin}:${text}`);
    });
    bridge.writeNative(slot, "int other;", "sync");
    expect(events).toEqual([]);
    ace.setSilent("int external;");
    ace.fire();
    expect(events).toEqual(["user:int external;"]);
    unsubscribe();
    bridge.destroy();
  });

  it("falls back to the plain textarea without touching the POST checkbox", () => {
    const { doc, bridge, ace } = setup();
    const toggle = doc.querySelector(".btn-toggle-editor");
    const textarea = doc.querySelector("#plain-textarea") as
      | FakeElement
      | null;
    const checkbox = doc.querySelector("#toggleEditorCheckbox");
    if (!toggle || !textarea || !checkbox) {
      throw new Error("fixture missing plain-mode controls");
    }
    toggle.classList.add("active");
    textarea.style.display = "";
    let checkboxChanges = 0;
    checkbox.addEventListener("change", () => {
      checkboxChanges += 1;
    });

    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("textarea slot not located");
    expect(slot.kind).toBe("textarea");
    expect(bridge.readNative(slot)).toBe("int main() { return 0; }");
    bridge.writeNative(slot, "int plain;", "sync");
    expect(textarea.value).toBe("int plain;");
    expect(checkboxChanges).toBe(0);
    expect(ace.getText()).toBe("int main() { return 0; }");
    bridge.destroy();
  });

  it("parses AtCoder rules, generates stable ids, and suppresses language echoes", async () => {
    const { doc, bridge } = setup();
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("Ace slot not located");
    const select = doc.querySelector(
      'select[name="data.LanguageId"]'
    ) as FakeElement | null;
    if (!select) throw new Error("fixture missing language select");

    const current = bridge.readLanguageOption(slot);
    expect(current).toBe(
      atCoderStableOptionId("C++23 (GCC 15.2.0)", "6017")
    );

    const profiles = bridge.languageProfiles(slot);
    const gcc23 = profiles.profiles.find(
      (profile) => profile.standard === "c++23"
    );
    expect(gcc23?.dialect).toBe("gnu++");
    expect(gcc23?.macros).toContain("ATCODER");
    const ioi = profiles.profiles.find(
      (profile) => profile.standard === "c++20"
    );
    expect(ioi?.macros).toContain("EVAL");

    const ioiId = atCoderStableOptionId(
      "C++ IOI-Style(GNU++20) (GCC 14.2.0)",
      "6054"
    );
    const events: string[] = [];
    const unsubscribe = bridge.subscribeLanguage(slot, (optionId, origin) => {
      events.push(`${origin}:${optionId}`);
    });
    await settle();
    expect(bridge.selectLanguageOption(slot, ioiId)).toBe(true);
    expect(select.value).toBe("6054");
    await settle();
    expect(events).toEqual([]);

    const clangId = atCoderStableOptionId(
      "C++23 (Clang 21.1.0)",
      "6116"
    );
    select.value = "6116";
    select.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    await settle();
    expect(events).toEqual([`user:${clangId}`]);
    unsubscribe();
    bridge.destroy();
  });

  it("extracts AtCoder account, task key, and ignores numeric value changes in ids", () => {
    const { doc, location } = loadFixture(
      "atcoder.html",
      "https://atcoder.jp/contests/abc380/submit"
    );
    expect(atCoderAccountScope(doc)).toBe("alice");
    expect(atCoderProblemKey(location, doc)).toBe("abc380_a");
    expect(
      atCoderProblemKey({
        href: "https://atcoder.jp/contests/abc380/tasks/abc380_b"
      })
    ).toBe("abc380_b");
    expect(
      atCoderStableOptionId("C++23 (GCC 15.2.0)", "9999")
    ).toBe(atCoderStableOptionId("C++23 (GCC 15.2.0)", "6017"));
  });
});

/* ------------------------------------------------------------------ */
/* Codeforces                                                         */
/* ------------------------------------------------------------------ */

describe("Codeforces adapter", () => {
  function setup() {
    const loaded = loadFixture(
      "codeforces.html",
      "https://codeforces.com/problemset/submit"
    );
    const editorElement = loaded.doc.querySelector("#editor");
    if (!editorElement) throw new Error("fixture missing #editor");
    const ace = makeAce("int main() { return 0; }");
    Reflect.set(editorElement, "env", { editor: ace.editor });
    setWindowGlobal(loaded.win, "editor", {
      getValue: () => "BOGUS window.editor",
      setValue: () => undefined,
      getSession: () => ({ on: () => undefined })
    });
    const bridge = createCodeforcesBridge({
      document: loaded.doc,
      window: loaded.win,
      location: loaded.location
    });
    return { ...loaded, editorElement, ace, bridge };
  }

  it("uses #editor.env.editor, ignores window.editor, and syncs the form textarea", () => {
    const { doc, bridge, ace } = setup();
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("Ace slot not located");
    expect(bridge.readNative(slot)).toBe("int main() { return 0; }");
    expect(bridge.readNative(slot)).not.toContain("BOGUS");

    bridge.writeNative(slot, "long long x;", "sync");
    expect(ace.getText()).toBe("long long x;");
    const textarea = doc.querySelector("#sourceCodeTextarea");
    expect(textarea?.value).toBe("long long x;");

    const events: string[] = [];
    const unsubscribe = bridge.subscribeNative(slot, (text, origin) => {
      events.push(`${origin}:${text}`);
    });
    bridge.writeNative(slot, "long long y;", "sync");
    expect(events).toEqual([]);
    ace.setSilent("long long z;");
    ace.fire();
    expect(events).toEqual(["user:long long z;"]);
    unsubscribe();
    bridge.destroy();
  });

  it("reads runtime programTypeId options and ignores C/GCC C profiles", async () => {
    const { bridge, doc } = setup();
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("Ace slot not located");
    const select = doc.querySelector(
      'select[name="programTypeId"]'
    ) as FakeElement | null;
    if (!select) throw new Error("fixture missing language select");

    expect(bridge.readLanguageOption(slot)).toBe("91");
    const set = codeforcesLanguageOptionSet(select as never);
    expect(set.complete).toBe(true);
    expect(set.options.map((option) => option.optionId)).toContain("42");
    expect(set.options.map((option) => option.optionId)).toContain("89");

    const profiles = bridge.languageProfiles(slot);
    expect(profiles.profiles.map((profile) => profile.optionId)).toEqual([
      "42",
      "50",
      "54",
      "61",
      "73",
      "89",
      "91"
    ]);
    expect(
      profiles.profiles.every((profile) =>
        profile.standard.startsWith("c++")
      )
    ).toBe(true);
    expect(
      profiles.unrecognized.some((entry) =>
        entry.label.includes("GCC C")
      )
    ).toBe(false);

    const events: string[] = [];
    const unsubscribe = bridge.subscribeLanguage(slot, (optionId, origin) => {
      events.push(`${origin}:${optionId}`);
    });
    await settle();
    expect(bridge.selectLanguageOption(slot, "54")).toBe(true);
    expect(select.value).toBe("54");
    await settle();
    expect(events).toEqual([]);

    select.value = "73";
    select.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    await settle();
    expect(events).toEqual(["user:73"]);
    unsubscribe();
    bridge.destroy();
  });

  it("extracts account and problem identity and rejects foreign slots", () => {
    const { doc, location, bridge } = setup();
    expect(codeforcesAccountScope(doc)).toBe("tourist");
    expect(codeforcesProblemKey(location)).toBe("/problemset/submit");
    expect(
      codeforcesProblemKey({
        href: "https://codeforces.com/contest/1234/problem/A"
      })
    ).toBe("contest:1234:A");
    expect(
      codeforcesProblemKey({
        href: "https://codeforces.com/gym/100001/problem/B"
      })
    ).toBe("gym:100001:B");
    expect(() =>
      bridge.readNative({ slotId: "foreign" } as never)
    ).toThrow(SiteBridgeError);
    bridge.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* Hydro                                                              */
/* ------------------------------------------------------------------ */

describe("Hydro adapter", () => {
  function loadHydro(href = "https://yundouxueyuan.com/d/SZXQ/p/2314/submit") {
    const loaded = loadFixture("hydro.html", href);
    const stateNode = loaded.doc.querySelector("#ma-test-state");
    if (!stateNode) throw new Error("fixture missing state");
    const state = JSON.parse(stateNode.textContent) as {
      LANGS?: unknown;
      UiContext?: unknown;
      externalModules?: unknown;
    };
    setWindowGlobal(loaded.win, "LANGS", state.LANGS);
    setWindowGlobal(loaded.win, "UiContext", state.UiContext);
    setWindowGlobal(
      loaded.win,
      "externalModules",
      state.externalModules
    );
    return loaded;
  }

  function setupMonaco() {
    const loaded = loadHydro();
    const container = loaded.doc.querySelector(
      ".ScratchpadMonacoEditor"
    );
    if (!container) throw new Error("fixture missing Monaco container");
    const monaco = makeMonaco(container, "int main() { return 0; }");
    setWindowGlobal(loaded.win, "monaco", monaco.monaco);
    setWindowGlobal(loaded.win, "editor", monaco.editor);
    const bridge = createHydroBridge({
      document: loaded.doc,
      window: loaded.win,
      location: loaded.location
    });
    return { ...loaded, container, monaco, bridge };
  }

  function setupTextarea() {
    const loaded = loadHydro();
    const monacoVariant = loaded.doc.querySelector("#monaco-variant");
    const submitVariant = loaded.doc.querySelector("#submit-variant");
    if (!monacoVariant || !submitVariant) {
      throw new Error("fixture missing Hydro variants");
    }
    monacoVariant.remove();
    submitVariant.style.display = "";
    const bridge = createHydroBridge({
      document: loaded.doc,
      window: loaded.win,
      location: loaded.location
    });
    return { ...loaded, bridge };
  }

  it("retains validated Monaco and uses executeEdits without rebuilding it", () => {
    const { bridge, container, monaco, doc } = setupMonaco();
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("Monaco slot not located");
    expect(slot.kind).toBe("monaco");
    expect(slot.retainedMonaco).toBe(true);
    expect(slot.element).toBe(container);
    expect(slot.monaco).toBe(monaco.monaco);
    expect(slot.nativeEditor).toBe(monaco.editor);
    expect(bridge.readNative(slot)).toBe("int main() { return 0; }");

    bridge.writeNative(slot, "int x;", "sync");
    expect(monaco.getText()).toBe("int x;");
    expect(bridge.readNative(slot)).toBe("int x;");

    const events: string[] = [];
    const unsubscribe = bridge.subscribeNative(slot, (text, origin) => {
      events.push(`${origin}:${text}`);
    });
    bridge.writeNative(slot, "int y;", "sync");
    expect(events).toEqual([]);
    monaco.setSilent("int z;");
    monaco.fire();
    expect(events).toEqual(["user:int z;"]);
    unsubscribe();

    const remote = bridge.remoteLsp();
    expect(remote.state).toBe("active");
    expect(remote.lspHost).toBe("wss://hydro.ac");
    expect(remote.features).toContain("monaco-cpp@lsp");
    expect(hydroPostSubmitUrl(doc.defaultView)).toBe(
      "/d/SZXQ/p/2314/submit"
    );
    const context = bridge.context();
    expect(context.originKey).toBe(
      "https://yundouxueyuan.com/d/SZXQ"
    );
    expect(context.problemKey).toBe("p:2314");
    expect(context.accountScope).toBe("77");
    expect(context.submitUrl).toBe("/d/SZXQ/p/2314/submit");
    bridge.destroy();
  });

  it("reads the online IDE language select without a name attribute", () => {
    const { bridge, doc } = setupMonaco();
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("Monaco slot not located");
    const select = doc.querySelector("select.select");
    if (!select) throw new Error("fixture missing IDE language select");
    expect(bridge.readLanguageOption(slot)).toBe("cc.ccnoio2");
    const set = bridge.languageOptionSet(slot);
    expect(set.complete).toBe(true);
    expect(set.options.map((option) => option.optionId)).toEqual([
      "cc.cc14o2",
      "cc.ccnoio2",
      "cc.noi",
      "cc.noio2"
    ]);
    const profiles = bridge.languageProfiles(slot);
    expect(
      profiles.profiles.every((profile) => profile.standard === "c++14")
    ).toBe(true);
    bridge.destroy();
  });

  it("falls back to the submit textarea and marks the dialect unverified", async () => {
    const { bridge, doc } = setupTextarea();
    const [slot] = bridge.locateEditors();
    if (!slot) throw new Error("textarea slot not located");
    expect(slot.kind).toBe("textarea");
    expect(bridge.readNative(slot)).toBe("int main() { return 0; }");
    bridge.writeNative(slot, "int submit;", "sync");
    const textarea = doc.querySelector('textarea[name="code"]');
    expect(textarea?.value).toBe("int submit;");

    const events: string[] = [];
    const unsubscribe = bridge.subscribeNative(slot, (text, origin) => {
      events.push(`${origin}:${text}`);
    });
    bridge.writeNative(slot, "int submit2;", "sync");
    expect(events).toEqual([]);
    if (textarea) {
      textarea.value = "int external;";
      textarea.dispatchEvent(new FakeEvent("input", { bubbles: true }));
    }
    expect(events).toEqual(["user:int external;"]);

    const select = doc.querySelector('select[name="lang"]') as
      | FakeElement
      | null;
    if (!select) throw new Error("fixture missing Hydro lang select");
    expect(bridge.readLanguageOption(slot)).toBe("cc.cc14o2");
    const set = bridge.languageOptionSet(slot);
    expect(set.complete).toBe(true);
    expect(
      set.options.find((option) => option.optionId === "cc.cc14o2")
        ?.dialectVerified
    ).toBe(false);
    const profiles = bridge.languageProfiles(slot);
    const cpp17 = profiles.profiles.find(
      (profile) => profile.standard === "c++17"
    );
    expect(cpp17?.dialect).toBe("c++");
    expect(cpp17?.provenance.verified).toBe("unverified");
    expect(
      profiles.unsupported.some((entry) => entry.standard === "c++26")
    ).toBe(true);

    const languageEvents: string[] = [];
    const unsubscribeLanguage = bridge.subscribeLanguage(
      slot,
      (optionId, origin) => {
        languageEvents.push(`${origin}:${optionId}`);
      }
    );
    await settle();
    expect(bridge.selectLanguageOption(slot, "cc.cc17o2")).toBe(true);
    expect(select.value).toBe("cc.cc17o2");
    await settle();
    expect(languageEvents).toEqual([]);
    select.value = "cc.cc14o2";
    select.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    await settle();
    expect(languageEvents).toEqual(["user:cc.cc14o2"]);

    unsubscribeLanguage();
    unsubscribe();
    bridge.destroy();
  });

  it("reads LANGS, detection helpers, and degrades without a visible textarea", () => {
    const { doc, win, location } = loadHydro(
      "https://hydro.example/d/XY/p/1"
    );
    const languages = readHydroLanguages(win);
    expect(languages["cc.cc17o2"]).toBeDefined();
    expect(hydroOriginKey(location)).toBe("https://hydro.example/d/XY");
    expect(hydroProblemKey(location)).toBe("p:1");
    expect(hydroAccountScope(win)).toBe("77");
    expect(detectHydroSiteRemote(win).state).toBe("active");

    const bridge = createHydroBridge({ document: doc, window: win, location });
    expect(bridge.locateEditors()).toEqual([]);
    expect(bridge.languageIssue({ slotId: "none" } as never)).toBeNull();
    expect(() => bridge.readNative({ slotId: "none" } as never)).toThrow(
      SiteBridgeError
    );
    bridge.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* Shared fixture sanity                                              */
/* ------------------------------------------------------------------ */

describe("dedicated fixture sanity", () => {
  it("contains the recon selectors without network access", () => {
    const luogu = fixture("luogu.html");
    expect(luogu).toContain("cm-content");
    expect(luogu).toContain("C++14 (GCC 9)");
    expect(luogu).toContain("lentille-context");

    const atcoder = fixture("atcoder.html");
    expect(atcoder).toContain('name="data.LanguageId"');
    expect(atcoder).toContain("C++ IOI-Style(GNU++20)");
    expect(atcoder).toContain('name="data.TaskScreenName"');

    const codeforces = fixture("codeforces.html");
    expect(codeforces).toContain('name="programTypeId"');
    expect(codeforces).toContain("GNU G++23 14.2.0");
    expect(codeforces).toContain("sourceCodeTextarea");

    const hydro = fixture("hydro.html");
    expect(hydro).toContain('data-app="Hydro"');
    expect(hydro).toContain('name="lang"');
    expect(hydro).toContain('name="code"');
    expect(hydro).toContain("monaco-cpp@lsp");
  });
});
