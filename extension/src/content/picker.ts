/*
 * Manual editor picker for non-dedicated sites.
 *
 * The picker owns one closed-shadow-DOM host appended to the page. It never
 * rewrites page nodes, never calls a page editor, and never monkey-patches page
 * handlers. Pointer events are observed in the capture phase; on a deliberate
 * click it calls preventDefault() once and otherwise leaves page listeners
 * alone. Esc cancels and removes every listener and the host.
 *
 * Flow: pick an editor candidate -> optionally pick a language control ->
 * map each site option to a supported C++ standard (or "not recognized") ->
 * return an inert, JSON-serializable selection. The caller validates and
 * persists it with rules.ts; mounting is the caller's responsibility.
 */

import {
  compileSelector,
  createGenericRule,
  isSafeCssIdentifier,
  isSafeTagName,
  suggestPathPattern,
  type EditorKind,
  type GenericRule
} from "./rules.js";
import {
  TEXTAREA_SYNC_NOTE,
  describeGenericElement,
  detectEditorKind,
  findEditorCandidate,
  findLanguageControl,
  isElementVisible,
  readLanguageOptions,
  type GenericLanguageOption
} from "../sites/generic.js";
import {
  STANDARDS,
  isStandard,
  parseStandard,
  standardLabel,
  type Standard
} from "../profiles/types.js";

const PICKER_HOST_ID = "monacoanywhere-generic-picker";
const MAX_SELECTOR_LENGTH = 512;

const SELECTOR_ATTRIBUTES = [
  "name",
  "data-testid",
  "data-test",
  "data-qa",
  "data-language",
  "data-mode",
  "data-editor",
  "aria-label",
  "role",
  "type",
  "placeholder",
  "contenteditable"
];

export type SelectorScope = "document" | "shadow";

export interface SelectorSuggestion {
  readonly selector: string;
  readonly unique: boolean;
  readonly scope: SelectorScope;
}

export interface StandardMappingChoice {
  readonly value: Standard | null;
  readonly label: string;
}

export const STANDARD_MAPPING_CHOICES: readonly StandardMappingChoice[] = [
  { value: null, label: "Not recognized" },
  ...STANDARDS.map((standard) => ({
    value: standard,
    label: standardLabel(standard)
  }))
];

/** Suggest a standard only for an explicit supported C++ marker. */
export function suggestStandardForLabel(label: string): Standard | null {
  const match = parseStandard(label);
  return match && match.supported ? match.standard : null;
}

export interface GenericPickerSelection {
  readonly origin: string;
  readonly pathname: string;
  readonly suggestedPathPattern: string;
  readonly editorSelector: string;
  readonly editorKind: EditorKind;
  readonly editorLabel: string;
  readonly editorSelectorUnique: boolean;
  readonly editorSelectorScope: SelectorScope;
  readonly languageSelector?: string;
  readonly languageLabel?: string;
  readonly languageSelectorUnique?: boolean;
  readonly languageSelectorScope?: SelectorScope;
  readonly languageOptions: readonly GenericLanguageOption[];
  readonly languageMap: Readonly<Record<string, Standard | null>>;
  readonly syncNote?: string;
}

export interface GenericPickerStrings {
  readonly title: string;
  readonly selectEditor: string;
  readonly selectLanguage: string;
  readonly mapLanguages: string;
  readonly cancel: string;
  readonly skipLanguage: string;
  readonly confirm: string;
  readonly notRecognized: string;
  readonly noOptions: string;
  readonly shadowWarning: string;
  readonly nonUniqueWarning: string;
  readonly error: string;
  readonly mappingDescription: string;
  readonly pathPatternLabel: string;
  readonly selectedEditor: string;
}

export const PICKER_STRINGS_EN: GenericPickerStrings = {
  title: "MonacoAnywhere editor picker",
  selectEditor:
    "Move the pointer over the code editor and click it. Esc cancels.",
  selectLanguage:
    "Now click the site's C++ language control, or skip this step.",
  mapLanguages: "Map language options",
  cancel: "Cancel",
  skipLanguage: "No language control",
  confirm: "Save selection",
  notRecognized: "Not recognized",
  noOptions:
    "No options were visible for this control. The rule will be saved without a language mapping.",
  shadowWarning:
    "The selected element is inside a shadow root; a normal document selector may not find it later.",
  nonUniqueWarning:
    "This selector matches more than one element here. The rule will fall back to the original editor when that happens.",
  error: "The selection could not be validated.",
  mappingDescription:
    "Choose the C++ standard each site option provides. Unmapped options are left untouched.",
  pathPatternLabel: "Path pattern",
  selectedEditor: "Selected editor"
};

export const PICKER_STRINGS_ZH: GenericPickerStrings = {
  title: "MonacoAnywhere 编辑器拾取",
  selectEditor: "把指针移到代码编辑器上并点击。按 Esc 取消。",
  selectLanguage: "现在点击站点的 C++ 语言控件，或跳过此步骤。",
  mapLanguages: "映射语言选项",
  cancel: "取消",
  skipLanguage: "没有语言控件",
  confirm: "保存选择",
  notRecognized: "不识别",
  noOptions: "该控件当前没有可见选项。规则将不带语言映射保存。",
  shadowWarning: "所选元素位于 shadow root 内；之后按文档选择器可能找不到它。",
  nonUniqueWarning:
    "该选择器在当前页面命中多个元素；届时规则会回退到原编辑器。",
  error: "无法验证该选择。",
  mappingDescription:
    "为每个站点选项选择对应的 C++ 标准；未映射的选项不会被修改。",
  pathPatternLabel: "路径模式",
  selectedEditor: "已选编辑器"
};

export function defaultPickerStrings(locale?: string): GenericPickerStrings {
  return locale?.toLowerCase().startsWith("zh")
    ? PICKER_STRINGS_ZH
    : PICKER_STRINGS_EN;
}

export type GenericPickerCancelReason =
  | "escape"
  | "caller"
  | "pagehide"
  | "error";

export type GenericPickerOutcome =
  | { readonly status: "selected"; readonly selection: GenericPickerSelection }
  | {
      readonly status: "cancelled";
      readonly reason: GenericPickerCancelReason;
      readonly message?: string;
    };

export interface GenericPickerOptions {
  readonly document?: Document;
  readonly locale?: string;
  readonly strings?: Partial<GenericPickerStrings>;
}

export interface GenericPickerController {
  readonly result: Promise<GenericPickerOutcome>;
  cancel(): void;
}

export interface ShortcutEventLike {
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly code?: string;
  readonly key?: string;
}

/** Alt+Shift+M, the same shortcut used by the content toolbar entry point. */
export function isGenericPickerShortcut(event: ShortcutEventLike): boolean {
  return (
    event.altKey &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (event.code === "KeyM" || event.key?.toLowerCase() === "m")
  );
}

/**
 * Install the picker shortcut and return its disposer. The caller decides
 * whether a picker may open; this helper only observes the chord.
 */
export function installGenericPickerShortcut(
  trigger: () => void,
  doc: Document = document
): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (!isGenericPickerShortcut(event) || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    trigger();
  };
  doc.addEventListener("keydown", handler, true);
  return () => doc.removeEventListener("keydown", handler, true);
}

/** Build and validate the persisted rule for a picker selection. */
export function createRuleFromPickerSelection(
  selection: GenericPickerSelection,
  pathPattern: string = selection.suggestedPathPattern
): GenericRule {
  return createGenericRule({
    origin: selection.origin,
    pathPattern,
    editorSelector: selection.editorSelector,
    editorKind: selection.editorKind,
    ...(selection.languageSelector !== undefined
      ? { languageSelector: selection.languageSelector }
      : {}),
    languageMap: selection.languageMap
  });
}

/* ------------------------------------------------------------------------- */
/* Safe selector suggestions                                                  */
/* ------------------------------------------------------------------------- */

function selectorRoot(element: Element): {
  readonly root: ParentNode;
  readonly scope: SelectorScope;
} {
  const node = element.getRootNode();
  if (typeof ShadowRoot !== "undefined" && node instanceof ShadowRoot) {
    return { root: node, scope: "shadow" };
  }
  return {
    root: element.ownerDocument ?? (node as ParentNode),
    scope: "document"
  };
}

function safeClasses(element: Element): string[] {
  return Array.from(element.classList ?? [])
    .filter(isSafeCssIdentifier)
    .slice(0, 8);
}

function safeAttributeNames(element: Element): string[] {
  const names = [...SELECTOR_ATTRIBUTES];
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith("data-") && !names.includes(attribute.name)) {
      names.push(attribute.name);
    }
  }
  return names
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name))
    .slice(0, 16);
}

function attributeSelector(element: Element, name: string): string | null {
  const value = element.getAttribute(name);
  if (value === null || value.length > 128) {
    return null;
  }
  const candidate = `[${name}="${value}"]`;
  try {
    return compileSelector(candidate);
  } catch {
    return null;
  }
}

function directSelectorCandidates(element: Element): string[] {
  const rawTag = element.tagName.toLowerCase();
  const tag = isSafeTagName(rawTag) ? rawTag : "";
  const id = (element.getAttribute("id") ?? "").trim();
  const idPart = isSafeCssIdentifier(id) ? `#${id}` : "";
  const classes = safeClasses(element);
  const attributes = safeAttributeNames(element)
    .map((name) => attributeSelector(element, name))
    .filter((value): value is string => value !== null);
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string): void => {
    if (!value || value.length > MAX_SELECTOR_LENGTH || seen.has(value)) {
      return;
    }
    try {
      const selector = compileSelector(value);
      if (!seen.has(selector)) {
        seen.add(selector);
        candidates.push(selector);
      }
    } catch {
      // Generated pieces are already checked; keep going on the next shape.
    }
  };

  if (idPart) {
    push(`${tag}${idPart}`);
    push(idPart);
  }

  for (let first = 0; first < classes.length; first += 1) {
    for (let second = first + 1; second < classes.length; second += 1) {
      push(`${tag}.${classes[first]}.${classes[second]}`);
      push(`.${classes[first]}.${classes[second]}`);
    }
    push(`${tag}.${classes[first]}`);
    push(`.${classes[first]}`);
  }

  for (const attribute of attributes) {
    push(`${tag}${attribute}`);
    push(attribute);
  }

  for (const attribute of attributes.slice(0, 4)) {
    for (const className of classes.slice(0, 2)) {
      push(`${tag}.${className}${attribute}`);
      push(`.${className}${attribute}`);
    }
  }

  if (tag) {
    push(tag);
  }
  return candidates;
}

function isUniqueSelector(
  root: ParentNode,
  selector: string,
  element: Element
): boolean {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/**
 * Prefer a unique, low-specificity selector: id, classes, then attributes,
 * then a descendant path through stable ancestors, then a bare tag. Generated
 * selectors always pass compileSelector. If nothing is unique, the first
 * direct candidate is returned with `unique: false` so the caller can warn and
 * the resolver can fall back safely.
 */
export function suggestSafeSelector(element: Element): SelectorSuggestion {
  const { root, scope } = selectorRoot(element);
  const direct = directSelectorCandidates(element);
  for (const selector of direct) {
    if (isUniqueSelector(root, selector, element)) {
      return { selector, unique: true, scope };
    }
  }

  const elementCandidates = direct.slice(0, 6);
  let ancestor = element.parentElement;
  for (let depth = 0; depth < 4 && ancestor; depth += 1) {
    const ancestors = directSelectorCandidates(ancestor).slice(0, 5);
    for (const ancestorSelector of ancestors) {
      for (const elementSelector of elementCandidates.slice(0, 4)) {
        const combined = `${ancestorSelector} ${elementSelector}`;
        if (combined.length > MAX_SELECTOR_LENGTH) {
          continue;
        }
        let normalized: string;
        try {
          normalized = compileSelector(combined);
        } catch {
          continue;
        }
        if (isUniqueSelector(root, normalized, element)) {
          return { selector: normalized, unique: true, scope };
        }
      }
    }
    ancestor = ancestor.parentElement;
  }

  const rawTag = element.tagName.toLowerCase();
  const fallback = direct[0] ?? (isSafeTagName(rawTag) ? rawTag : "div");
  return { selector: fallback, unique: false, scope };
}

/* ------------------------------------------------------------------------- */
/* Picker overlay                                                             */
/* ------------------------------------------------------------------------- */

const PICKER_CSS = `
:host { color-scheme: light dark; }
*, *::before, *::after { box-sizing: border-box; }
.layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #17121f;
}
[hidden] { display: none !important; }
.highlight {
  position: fixed;
  z-index: 2147483000;
  border: 2px solid #6f5cff;
  border-radius: 5px;
  background: rgba(111, 92, 255, 0.14);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45);
  pointer-events: none;
}
.badge {
  position: fixed;
  z-index: 2147483001;
  max-width: min(520px, calc(100vw - 16px));
  padding: 5px 9px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-radius: 6px;
  background: #17121f;
  color: #ffffff;
  font-size: 12px;
  pointer-events: none;
}
.bar {
  position: fixed;
  z-index: 2147483002;
  top: 12px;
  left: 50%;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  max-width: calc(100vw - 24px);
  padding: 8px 10px 8px 14px;
  border: 1px solid #d8d2e8;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(26, 20, 45, 0.18);
  pointer-events: auto;
  transform: translateX(-50%);
}
.title { font-weight: 650; white-space: nowrap; }
.hint { max-width: 48vw; color: #50475e; }
.panel {
  position: fixed;
  z-index: 2147483002;
  bottom: 16px;
  left: 50%;
  width: min(700px, calc(100vw - 24px));
  max-height: 64vh;
  overflow: auto;
  padding: 16px;
  border: 1px solid #d8d2e8;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 12px 36px rgba(26, 20, 45, 0.22);
  pointer-events: auto;
  transform: translateX(-50%);
}
.panel-title { margin: 0 0 6px; font-size: 15px; font-weight: 700; }
.panel-text { margin: 0 0 12px; color: #50475e; }
.warning { margin: 0 0 10px; color: #8a4b00; }
.rows { display: grid; gap: 10px; }
.row {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid #ece8f4;
  border-radius: 8px;
}
.option-label { display: grid; gap: 3px; font-weight: 600; }
.option-id {
  overflow-wrap: anywhere;
  color: #6b627b;
  font: 11px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.option-disabled { color: #8a4b00; font-weight: 500; }
.standard-select {
  width: 100%;
  min-height: 32px;
  padding: 4px 6px;
  border: 1px solid #cfc7df;
  border-radius: 6px;
  background: #ffffff;
  color: inherit;
  font: inherit;
}
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.button {
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid #cfc7df;
  border-radius: 999px;
  background: #ffffff;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.button.primary { border-color: #4e3cc7; background: #4e3cc7; color: #ffffff; }
.error { margin: 10px 0 0; color: #a31919; }
@media (prefers-color-scheme: dark) {
  .layer { color: #f1edf8; }
  .bar, .panel { border-color: #443b58; background: #211c2c; }
  .hint, .panel-text { color: #c8c0d8; }
  .row { border-color: #3a324b; }
  .option-id { color: #b7adc9; }
  .standard-select, .button { border-color: #554a6b; background: #2b2439; color: #f1edf8; }
  .button.primary { border-color: #8a78ff; background: #6f5cff; }
  .highlight { background: rgba(138, 120, 255, 0.18); }
  .warning { color: #ffbd66; }
  .error { color: #ff8d8d; }
}
`;

interface PickedEditor {
  readonly element: HTMLElement;
  readonly kind: EditorKind;
  readonly label: string;
  readonly suggestion: SelectorSuggestion;
}

interface PickedLanguage {
  readonly element: HTMLElement;
  readonly label: string;
  readonly suggestion: SelectorSuggestion;
  readonly options: readonly GenericLanguageOption[];
}

function makeElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function makeButton(
  doc: Document,
  text: string,
  primary = false
): HTMLButtonElement {
  const button = makeElement(doc, "button", primary ? "button primary" : "button", text);
  button.type = "button";
  return button;
}

/**
 * Open the picker for one document. There is no implicit singleton: the caller
 * should keep one controller alive at a time. The returned promise resolves
 * exactly once with a pure-data selection or a cancellation reason.
 */
export function openGenericPicker(
  options: GenericPickerOptions = {}
): GenericPickerController {
  const doc =
    options.document ?? (typeof document === "undefined" ? undefined : document);
  let settled = false;
  const { promise: result, resolve: resolveResult } =
    Promise.withResolvers<GenericPickerOutcome>();

  if (!doc || !doc.documentElement) {
    resolveResult({
      status: "cancelled",
      reason: "error",
      message: "The picker needs a document"
    });
    return { result, cancel: () => {} };
  }

  const pageDocument = doc;
  const strings: GenericPickerStrings = {
    ...defaultPickerStrings(
      options.locale ||
        pageDocument.documentElement.lang ||
        pageDocument.defaultView?.navigator.language
    ),
    ...(options.strings ?? {})
  };
  const previousFocus = pageDocument.activeElement;

  const host = pageDocument.createElement("div");
  host.id = PICKER_HOST_ID;
  host.style.position = "fixed";
  host.style.setProperty("inset", "0");
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  host.style.setProperty("color-scheme", "light dark");

  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: "closed" });
  } catch (error) {
    resolveResult({
      status: "cancelled",
      reason: "error",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Shadow DOM is unavailable"
    });
    return { result, cancel: () => {} };
  }

  const style = pageDocument.createElement("style");
  style.textContent = PICKER_CSS;
  const layer = makeElement(pageDocument, "div", "layer");
  const highlight = makeElement(pageDocument, "div", "highlight");
  highlight.hidden = true;
  const badge = makeElement(pageDocument, "div", "badge");
  badge.hidden = true;

  const bar = makeElement(pageDocument, "div", "bar");
  const title = makeElement(pageDocument, "div", "title", strings.title);
  const hint = makeElement(pageDocument, "div", "hint", strings.selectEditor);
  hint.setAttribute("aria-live", "polite");
  const skipButton = makeButton(pageDocument, strings.skipLanguage);
  skipButton.hidden = true;
  const cancelButton = makeButton(pageDocument, strings.cancel);
  bar.append(title, hint, skipButton, cancelButton);

  const panel = makeElement(pageDocument, "div", "panel");
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", strings.title);

  layer.append(highlight, badge, bar, panel);
  shadow.append(style, layer);
  pageDocument.documentElement.append(host);

  let step: "editor" | "language" | "mapping" = "editor";
  let hovered: Element | null = null;
  let selectedEditor: PickedEditor | null = null;
  let selectedLanguage: PickedLanguage | null = null;
  let badgeText = "";

  const eventTarget: EventTarget = pageDocument.defaultView ?? pageDocument;

  const detachListeners = (): void => {
    eventTarget.removeEventListener("pointerdown", onPointerDown, true);
    eventTarget.removeEventListener("pointermove", onPointerMove, true);
    eventTarget.removeEventListener("keydown", onKeyDown, true);
    eventTarget.removeEventListener("scroll", onScroll, true);
    eventTarget.removeEventListener("resize", onResize);
    eventTarget.removeEventListener("pagehide", onPageHide);
  };

  const finish = (outcome: GenericPickerOutcome): void => {
    if (settled) {
      return;
    }
    settled = true;
    detachListeners();
    host.remove();
    if (
      previousFocus instanceof HTMLElement &&
      previousFocus.isConnected
    ) {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {
        // Focus restoration is best effort; tab state may have changed.
      }
    }
    resolveResult(outcome);
  };

  const hideHighlight = (): void => {
    highlight.hidden = true;
    badge.hidden = true;
  };

  const renderHighlight = (element: Element | null, text: string): void => {
    if (!element || !element.isConnected) {
      hideHighlight();
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) {
      hideHighlight();
      return;
    }
    highlight.hidden = false;
    highlight.style.left = `${Math.max(0, rect.left)}px`;
    highlight.style.top = `${Math.max(0, rect.top)}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    badge.hidden = false;
    badge.textContent = text;
    const viewportWidth = pageDocument.defaultView?.innerWidth ?? 1024;
    badge.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - 320))}px`;
    badge.style.top = `${
      rect.top >= 34 ? rect.top - 30 : rect.bottom + 6
    }px`;
  };

  const updateHighlight = (): void => {
    if (step === "mapping" || !hovered) {
      hideHighlight();
      return;
    }
    renderHighlight(hovered, badgeText);
  };

  const eventElement = (event: Event): Element | null => {
    for (const item of event.composedPath()) {
      if (item instanceof Element) {
        return item;
      }
    }
    return event.target instanceof Element ? event.target : null;
  };

  const warningsFor = (): string[] => {
    const warnings: string[] = [];
    if (!selectedEditor) {
      return warnings;
    }
    if (!selectedEditor.suggestion.unique) {
      warnings.push(strings.nonUniqueWarning);
    }
    if (selectedEditor.suggestion.scope === "shadow") {
      warnings.push(strings.shadowWarning);
    }
    if (selectedLanguage) {
      if (!selectedLanguage.suggestion.unique) {
        warnings.push(strings.nonUniqueWarning);
      }
      if (selectedLanguage.suggestion.scope === "shadow") {
        warnings.push(strings.shadowWarning);
      }
    }
    return [...new Set(warnings)];
  };

  const appendWarnings = (parent: HTMLElement): void => {
    for (const warning of warningsFor()) {
      parent.append(makeElement(pageDocument, "p", "warning", warning));
    }
  };

  const pageLocation = pageDocument.location;
  const origin = pageLocation?.origin ?? "";
  const pathname = pageLocation?.pathname ?? "/";

  const buildSelection = (
    language: PickedLanguage | null,
    languageMap: Readonly<Record<string, Standard | null>>
  ): GenericPickerSelection | null => {
    if (!selectedEditor) {
      return null;
    }
    const editor = selectedEditor;
    const base: GenericPickerSelection = {
      origin,
      pathname,
      suggestedPathPattern: suggestPathPattern(pathname),
      editorSelector: editor.suggestion.selector,
      editorKind: editor.kind,
      editorLabel: editor.label,
      editorSelectorUnique: editor.suggestion.unique,
      editorSelectorScope: editor.suggestion.scope,
      languageOptions: language
        ? language.options.map((option) => ({ ...option }))
        : [],
      languageMap: { ...languageMap },
      ...(language
        ? {
            languageSelector: language.suggestion.selector,
            languageLabel: language.label,
            languageSelectorUnique: language.suggestion.unique,
            languageSelectorScope: language.suggestion.scope
          }
        : {}),
      ...(editor.kind === "textarea" ? { syncNote: TEXTAREA_SYNC_NOTE } : {})
    };
    return base;
  };

  const showPanelError = (parent: HTMLElement, error: unknown): void => {
    let node = parent.querySelector<HTMLElement>(".error");
    if (!node) {
      node = makeElement(pageDocument, "p", "error");
      node.setAttribute("role", "alert");
      parent.append(node);
    }
    node.textContent =
      error instanceof Error && error.message ? error.message : strings.error;
    node.hidden = false;
  };

  const renderLanguageStep = (): void => {
    panel.replaceChildren();
    panel.hidden = true;
    skipButton.hidden = false;
  };

  const renderMappingStep = (language: PickedLanguage): void => {
    skipButton.hidden = true;
    panel.replaceChildren();
    panel.hidden = false;
    panel.append(
      makeElement(pageDocument, "div", "panel-title", strings.mapLanguages),
      makeElement(pageDocument, "p", "panel-text", strings.mappingDescription),
      makeElement(
        pageDocument,
        "p",
        "panel-text",
        `${strings.pathPatternLabel}: ${suggestPathPattern(pathname)}`
      )
    );
    appendWarnings(panel);

    const selects = new Map<string, HTMLSelectElement>();
    const rows = makeElement(pageDocument, "div", "rows");
    for (const option of language.options) {
      const row = makeElement(pageDocument, "div", "row");
      const label = makeElement(pageDocument, "label", "option-label");
      label.append(
        makeElement(
          pageDocument,
          "span",
          undefined,
          option.label || option.id
        ),
        makeElement(pageDocument, "code", "option-id", option.id)
      );
      if (option.disabled) {
        label.append(
          makeElement(pageDocument, "span", "option-disabled", "disabled")
        );
      }

      const select = makeElement(pageDocument, "select", "standard-select");
      for (const choice of STANDARD_MAPPING_CHOICES) {
        const element = makeElement(
          pageDocument,
          "option",
          undefined,
          choice.value === null ? strings.notRecognized : choice.label
        );
        element.value = choice.value ?? "";
        select.append(element);
      }
      const suggested = suggestStandardForLabel(option.label);
      select.value = suggested ?? "";
      select.setAttribute(
        "aria-label",
        `${option.label || option.id}: ${strings.mapLanguages}`
      );
      label.append(select);
      selects.set(option.id, select);
      row.append(label);
      rows.append(row);
    }

    if (language.options.length === 0) {
      panel.append(makeElement(pageDocument, "p", "panel-text", strings.noOptions));
    } else {
      panel.append(rows);
    }

    const actions = makeElement(pageDocument, "div", "actions");
    const confirm = makeButton(pageDocument, strings.confirm, true);
    confirm.addEventListener("click", () => {
      const languageMap: Record<string, Standard | null> = {};
      for (const option of language.options) {
        const value = selects.get(option.id)?.value ?? "";
        languageMap[option.id] = isStandard(value) ? value : null;
      }
      const selection = buildSelection(language, languageMap);
      if (!selection) {
        showPanelError(panel, strings.error);
        return;
      }
      try {
        createRuleFromPickerSelection(selection);
      } catch (error) {
        showPanelError(panel, error);
        return;
      }
      finish({ status: "selected", selection });
    });
    actions.append(confirm);
    panel.append(actions);

    for (const select of selects.values()) {
      select.focus({ preventScroll: true });
      break;
    }
  };

  function onPointerMove(event: Event): void {
    if (step === "mapping") {
      return;
    }
    if (event.composedPath().includes(host)) {
      hovered = null;
      hideHighlight();
      return;
    }
    const target = eventElement(event);
    if (!target) {
      hovered = null;
      hideHighlight();
      return;
    }

    if (step === "editor") {
      const candidate = findEditorCandidate(target);
      if (candidate && isElementVisible(candidate)) {
        hovered = candidate;
        const kind = detectEditorKind(candidate)?.toUpperCase() ?? "EDITOR";
        badgeText = `${kind} · ${describeGenericElement(candidate)}`;
        renderHighlight(candidate, badgeText);
        return;
      }
    } else if (step === "language") {
      const control = findLanguageControl(target);
      if (control && isElementVisible(control)) {
        hovered = control;
        badgeText = `LANGUAGE · ${describeGenericElement(control)}`;
        renderHighlight(control, badgeText);
        return;
      }
    }

    hovered = null;
    hideHighlight();
  }

  function onPointerDown(event: Event): void {
    const pointer = event as PointerEvent;
    if (
      settled ||
      pointer.button !== 0 ||
      step === "mapping" ||
      event.composedPath().includes(host)
    ) {
      return;
    }
    const target = eventElement(event);
    if (!target) {
      return;
    }

    if (step === "editor") {
      const candidate = findEditorCandidate(target);
      const kind = candidate ? detectEditorKind(candidate) : null;
      if (!candidate || !kind || !isElementVisible(candidate)) {
        return;
      }
      event.preventDefault();
      const picked: PickedEditor = {
        element: candidate,
        kind,
        label: describeGenericElement(candidate),
        suggestion: suggestSafeSelector(candidate)
      };
      selectedEditor = picked;
      step = "language";
      hovered = null;
      hideHighlight();
      hint.textContent = `${strings.selectedEditor}: ${picked.label}. ${strings.selectLanguage}`;
      renderLanguageStep();
      return;
    }

    if (step === "language") {
      const control = findLanguageControl(target);
      if (!control || !isElementVisible(control)) {
        return;
      }
      event.preventDefault();
      const picked: PickedLanguage = {
        element: control,
        label: describeGenericElement(control),
        suggestion: suggestSafeSelector(control),
        options: readLanguageOptions(control)
      };
      selectedLanguage = picked;
      step = "mapping";
      hovered = null;
      hideHighlight();
      hint.textContent = strings.mapLanguages;
      renderMappingStep(picked);
    }
  }

  function onKeyDown(event: Event): void {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key !== "Escape" && keyboard.code !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finish({ status: "cancelled", reason: "escape" });
  }

  function onScroll(): void {
    if (step !== "mapping") {
      updateHighlight();
    }
  }

  function onResize(): void {
    if (step !== "mapping") {
      updateHighlight();
    }
  }

  function onPageHide(): void {
    finish({ status: "cancelled", reason: "pagehide" });
  }

  skipButton.addEventListener("click", () => {
    const selection = buildSelection(null, {});
    if (!selection) {
      return;
    }
    try {
      createRuleFromPickerSelection(selection);
    } catch (error) {
      panel.hidden = false;
      panel.replaceChildren();
      showPanelError(panel, error);
      return;
    }
    finish({ status: "selected", selection });
  });

  cancelButton.addEventListener("click", () => {
    finish({ status: "cancelled", reason: "caller" });
  });

  eventTarget.addEventListener("pointerdown", onPointerDown, {
    capture: true,
    passive: false
  });
  eventTarget.addEventListener("pointermove", onPointerMove, {
    capture: true,
    passive: true
  });
  eventTarget.addEventListener("keydown", onKeyDown, true);
  eventTarget.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true
  });
  eventTarget.addEventListener("resize", onResize);
  eventTarget.addEventListener("pagehide", onPageHide);

  return {
    result,
    cancel: () => finish({ status: "cancelled", reason: "caller" })
  };
}
