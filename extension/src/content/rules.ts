/*
 * Generic-site rule schema, validation, selector compiler and path matching.
 *
 * A rule is inert JSON. It names one editor on one origin/path family and an
 * optional language control. Selectors are deliberately not arbitrary CSS:
 * only `#id`, `.class`, `tag`, `[attr="value"]` and descendant combinators are
 * accepted. Pseudo-classes, pseudo-elements, universal selectors, sibling
 * combinators, selector lists and escapes are rejected, so a persisted rule
 * cannot smuggle behaviour or broaden into the whole document by accident.
 *
 * Persistence belongs to the caller; this module only parses, normalizes,
 * serializes and matches rules. The exported selector string is rebuilt from
 * the parsed AST rather than copied from user input.
 */

import { isStandard, type Standard } from "../profiles/types.js";

export const GENERIC_RULE_SCHEMA = "monacoanywhere.generic-rule/1" as const;
export type GenericRuleSchema = typeof GENERIC_RULE_SCHEMA;

export const EDITOR_KINDS = ["ace", "cm5", "cm6", "monaco", "textarea"] as const;
export type EditorKind = (typeof EDITOR_KINDS)[number];

export type LanguageMap = Readonly<Record<string, Standard | null>>;

export interface GenericRule {
  readonly schema: GenericRuleSchema;
  readonly origin: string;
  readonly pathPattern: string;
  readonly editorSelector: string;
  readonly editorKind: EditorKind;
  readonly languageSelector?: string;
  readonly languageMap: LanguageMap;
}

export interface GenericRuleInput {
  readonly origin: string;
  readonly pathPattern: string;
  readonly editorSelector: string;
  readonly editorKind: EditorKind;
  readonly languageSelector?: string;
  readonly languageMap?: Readonly<Record<string, Standard | null>>;
}

export interface RuleLocation {
  readonly origin: string;
  readonly pathname: string;
}

export class SelectorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectorValidationError";
  }
}

export class RuleValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid generic rule: ${issues.join("; ")}`);
    this.name = "RuleValidationError";
    this.issues = issues;
  }
}

export type RuleParseResult =
  | { readonly ok: true; readonly rule: GenericRule }
  | { readonly ok: false; readonly issues: readonly string[] };

/* ------------------------------------------------------------------------- */
/* Selector compiler                                                          */
/* ------------------------------------------------------------------------- */

const IDENT_RE = /^(?:--|-?[A-Za-z_])[A-Za-z0-9_-]*$/;
const TAG_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
const ATTR_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const MAX_SELECTOR_LENGTH = 512;
const MAX_COMPOUNDS = 16;
const MAX_SIMPLE_SELECTORS = 32;
const MAX_ATTRIBUTE_VALUE = 128;
const FORBIDDEN_SELECTOR_CHARS = /[\u0000-\u001f\u007f<>`{}|\\]/;
const FORBIDDEN_ATTRIBUTE_CHARS = /[\u0000-\u001f\u007f"'<>`{}|\\]/;
const SCRIPT_OR_URL_VALUE = /(?:^|[\s:])(?:javascript|data|vbscript)\s*:/i;

interface AttributeSelector {
  readonly name: string;
  readonly value: string;
}

interface CompoundSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: AttributeSelector[];
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function readToken(input: string, start: number): { name: string; end: number } {
  let end = start;
  while (end < input.length && /[A-Za-z0-9_-]/.test(input[end] ?? "")) {
    end += 1;
  }
  return { name: input.slice(start, end), end };
}

function skipSpaces(input: string, start: number): number {
  let index = start;
  while (isSpace(input[index])) {
    index += 1;
  }
  return index;
}

function parseAttribute(input: string, start: number): { attr: AttributeSelector; end: number } {
  let index = skipSpaces(input, start + 1);
  const token = readToken(input, index);
  if (!token.name || !ATTR_RE.test(token.name)) {
    throw new SelectorValidationError("attribute selector needs a plain attribute name");
  }
  index = skipSpaces(input, token.end);
  if (input[index] !== "=") {
    throw new SelectorValidationError(
      'attribute selectors must use exactly [name="value"]'
    );
  }
  index = skipSpaces(input, index + 1);
  const quote = input[index];
  if (quote !== '"' && quote !== "'") {
    throw new SelectorValidationError("attribute values must be quoted");
  }
  index += 1;

  let value = "";
  let closed = false;
  while (index < input.length) {
    const ch = input[index] ?? "";
    if (ch === quote) {
      closed = true;
      index += 1;
      break;
    }
    if (FORBIDDEN_ATTRIBUTE_CHARS.test(ch)) {
      throw new SelectorValidationError(
        "attribute value contains a character that is not allowed in a rule selector"
      );
    }
    value += ch;
    index += 1;
  }
  if (!closed) {
    throw new SelectorValidationError("unterminated attribute value");
  }
  if (value.length > MAX_ATTRIBUTE_VALUE) {
    throw new SelectorValidationError("attribute value is too long");
  }
  if (
    SCRIPT_OR_URL_VALUE.test(value) ||
    value.includes("://") ||
    value.startsWith("//")
  ) {
    throw new SelectorValidationError("script and URL attribute values are not allowed");
  }

  index = skipSpaces(input, index);
  if (input[index] !== "]") {
    throw new SelectorValidationError("unterminated attribute selector");
  }
  return { attr: { name: token.name, value }, end: index + 1 };
}

function parseCompound(input: string, start: number): { compound: CompoundSelector; end: number } {
  let index = start;
  let tag: string | null = null;
  let id: string | null = null;
  const classes: string[] = [];
  const attrs: AttributeSelector[] = [];
  let simpleCount = 0;

  if (/[A-Za-z]/.test(input[index] ?? "")) {
    const token = readToken(input, index);
    if (!TAG_RE.test(token.name)) {
      throw new SelectorValidationError(`invalid tag name "${token.name}"`);
    }
    tag = token.name;
    index = token.end;
    simpleCount += 1;
  }

  while (index < input.length) {
    const ch = input[index] ?? "";
    if (isSpace(ch)) {
      break;
    }
    if (ch === "#") {
      if (id !== null) {
        throw new SelectorValidationError("a compound selector may contain only one id");
      }
      const token = readToken(input, index + 1);
      if (!token.name || !IDENT_RE.test(token.name)) {
        throw new SelectorValidationError("id selectors need a plain identifier");
      }
      id = token.name;
      index = token.end;
      simpleCount += 1;
      continue;
    }
    if (ch === ".") {
      const token = readToken(input, index + 1);
      if (!token.name || !IDENT_RE.test(token.name)) {
        throw new SelectorValidationError("class selectors need a plain identifier");
      }
      classes.push(token.name);
      index = token.end;
      simpleCount += 1;
      continue;
    }
    if (ch === "[") {
      const parsed = parseAttribute(input, index);
      attrs.push(parsed.attr);
      index = parsed.end;
      simpleCount += 1;
      continue;
    }
    if (ch === ":") {
      throw new SelectorValidationError("pseudo-classes and pseudo-elements are not allowed");
    }
    if (ch === "*") {
      throw new SelectorValidationError("the universal selector is not allowed");
    }
    if (ch === ">" || ch === "+" || ch === "~") {
      throw new SelectorValidationError("only descendant combinators are allowed");
    }
    if (ch === ",") {
      throw new SelectorValidationError("selector lists are not allowed");
    }
    throw new SelectorValidationError(`character "${ch}" is not allowed in a rule selector`);
  }

  if (simpleCount === 0) {
    throw new SelectorValidationError("empty compound selector");
  }
  if (simpleCount > MAX_SIMPLE_SELECTORS) {
    throw new SelectorValidationError("compound selector is too complex");
  }
  return { compound: { tag, id, classes, attrs }, end: index };
}

function renderCompound(compound: CompoundSelector): string {
  let output = compound.tag ?? "";
  if (compound.id !== null) {
    output += `#${compound.id}`;
  }
  for (const className of compound.classes) {
    output += `.${className}`;
  }
  for (const attr of compound.attrs) {
    output += `[${attr.name}="${attr.value}"]`;
  }
  return output;
}

/**
 * Parse and rebuild a rule selector. Throws SelectorValidationError on any
 * construct outside the documented subset. The return value is canonical:
 * whitespace collapsed, tag first, then id, classes and attributes.
 */
export function compileSelector(input: string): string {
  if (typeof input !== "string") {
    throw new SelectorValidationError("selector must be a string");
  }
  const selector = input.trim();
  if (selector.length === 0) {
    throw new SelectorValidationError("selector must not be empty");
  }
  if (selector.length > MAX_SELECTOR_LENGTH) {
    throw new SelectorValidationError("selector is too long");
  }
  if (FORBIDDEN_SELECTOR_CHARS.test(selector)) {
    throw new SelectorValidationError("selector contains a forbidden character");
  }

  const compounds: CompoundSelector[] = [];
  let index = 0;
  while (index < selector.length) {
    const parsed = parseCompound(selector, index);
    compounds.push(parsed.compound);
    index = skipSpaces(selector, parsed.end);
    if (index < selector.length && parsed.end === index) {
      throw new SelectorValidationError("unexpected trailing selector content");
    }
    if (compounds.length > MAX_COMPOUNDS) {
      throw new SelectorValidationError("selector is too complex");
    }
  }

  return compounds.map(renderCompound).join(" ");
}

/** True when `value` can be used verbatim as an id/class relative selector. */
export function isSafeCssIdentifier(value: string): boolean {
  return typeof value === "string" && IDENT_RE.test(value);
}

/** True when `value` is a tag name accepted by the rule selector grammar. */
export function isSafeTagName(value: string): boolean {
  return typeof value === "string" && TAG_RE.test(value);
}

export function isSafeSelector(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    compileSelector(value);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* Path patterns                                                              */
/* ------------------------------------------------------------------------- */

const PATH_PATTERN_RE = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;
const MAX_PATH_PATTERN_LENGTH = 512;
const MAX_PATH_LENGTH = 2048;

/**
 * Validate and return a path glob. A path is matched in full; `*` matches zero
 * or more non-slash characters and never crosses a segment boundary. Patterns
 * without a wildcard are exact and may be short (including `/`). A wildcard
 * pattern must contain at least two literal alphanumeric characters, which
 * rejects `/*`, `/**`, `/p/*` and similar accidental whole-site rules.
 */
export function normalizePathPattern(input: string): string {
  if (typeof input !== "string") {
    throw new RuleValidationError(["pathPattern must be a string"]);
  }
  const pattern = input.trim();
  if (pattern.length === 0) {
    throw new RuleValidationError(["pathPattern must not be empty"]);
  }
  if (pattern.length > MAX_PATH_PATTERN_LENGTH) {
    throw new RuleValidationError(["pathPattern is too long"]);
  }
  if (!PATH_PATTERN_RE.test(pattern)) {
    throw new RuleValidationError([
      "pathPattern must be an absolute pathname using only path characters"
    ]);
  }
  if (pattern.includes("//")) {
    throw new RuleValidationError(["pathPattern must not contain empty segments"]);
  }
  for (const segment of pattern.split("/")) {
    if (segment === "." || segment === "..") {
      throw new RuleValidationError(["pathPattern must not contain dot segments"]);
    }
  }
  if (pattern.includes("**")) {
    throw new RuleValidationError(["pathPattern does not support ** wildcards"]);
  }
  if (pattern.includes("*")) {
    const literalAlphanumeric = (pattern.match(/[A-Za-z0-9]/g) ?? []).length;
    if (literalAlphanumeric < 2) {
      throw new RuleValidationError([
        "pathPattern is too broad; include at least two literal characters"
      ]);
    }
  }
  return pattern;
}

export function isPathPattern(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    normalizePathPattern(value);
    return true;
  } catch {
    return false;
  }
}

function pathPatternRegExp(pattern: string): RegExp {
  let source = "^";
  for (const ch of pattern) {
    source +=
      ch === "*"
        ? "[^/]*"
        : /[\\^$.*+?()[\]{}|]/.test(ch)
          ? `\\${ch}`
          : ch;
  }
  return new RegExp(`${source}$`);
}

/** Match an already validated pattern against a location.pathname value. */
export function matchesPathPattern(pattern: string, pathname: string): boolean {
  const normalized = normalizePathPattern(pattern);
  if (
    typeof pathname !== "string" ||
    pathname.length === 0 ||
    pathname.length > MAX_PATH_LENGTH ||
    !pathname.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(pathname)
  ) {
    return false;
  }
  return pathPatternRegExp(normalized).test(pathname);
}

/**
 * Exact pattern for the current path. Callers may let the user broaden it in
 * their own rule editor; this helper never invents wildcards by itself.
 */
export function suggestPathPattern(pathname: string): string {
  const raw = typeof pathname === "string" ? pathname : "";
  const cut = raw.search(/[?#]/);
  let path = cut >= 0 ? raw.slice(0, cut) : raw;
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.length === 0) {
    path = "/";
  }
  if (path.length > MAX_PATH_PATTERN_LENGTH) {
    path = path.slice(0, MAX_PATH_PATTERN_LENGTH);
  }
  return isPathPattern(path) ? path : "/";
}

/* ------------------------------------------------------------------------- */
/* Origins and rules                                                          */
/* ------------------------------------------------------------------------- */

export function normalizeOrigin(input: string): string {
  if (typeof input !== "string") {
    throw new RuleValidationError(["origin must be a string"]);
  }
  const value = input.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RuleValidationError(["origin must be an absolute http(s) origin"]);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RuleValidationError(["origin must use http or https"]);
  }
  if (url.username !== "" || url.password !== "") {
    throw new RuleValidationError(["origin must not contain credentials"]);
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new RuleValidationError(["origin must not contain a path, query or fragment"]);
  }
  return url.origin;
}

export function isOrigin(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    normalizeOrigin(value);
    return true;
  } catch {
    return false;
  }
}

const RULE_KEYS: Readonly<Record<string, true>> = {
  schema: true,
  origin: true,
  pathPattern: true,
  editorSelector: true,
  editorKind: true,
  languageSelector: true,
  languageMap: true
};

const EDITOR_KIND_LOOKUP: Readonly<Record<string, true>> = {
  ace: true,
  cm5: true,
  cm6: true,
  monaco: true,
  textarea: true
};

function normalizeLanguageMap(value: unknown): LanguageMap {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuleValidationError(["languageMap must be an object"]);
  }
  const record = value as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(record).length > 0) {
    throw new RuleValidationError(["languageMap must contain string keys only"]);
  }

  const map: Record<string, Standard | null> = {};
  for (const key of Object.keys(record).sort()) {
    if (key.length === 0 || key.length > 128) {
      throw new RuleValidationError(["languageMap keys must be 1..128 characters"]);
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new RuleValidationError([`languageMap key "${key}" is not allowed`]);
    }
    if (/[\u0000-\u001f\u007f]/.test(key)) {
      throw new RuleValidationError(["languageMap keys must not contain control characters"]);
    }
    const standard = record[key];
    if (standard === null) {
      map[key] = null;
    } else if (isStandard(standard)) {
      map[key] = standard;
    } else {
      throw new RuleValidationError([
        `languageMap["${key}"] must be a supported C++ standard or null`
      ]);
    }
  }
  return map;
}

/**
 * Validate and normalize a persisted rule. Unknown fields are rejected so the
 * stored shape cannot drift silently; optional `languageSelector` is omitted
 * when absent and `languageMap` defaults to `{}`. The result is fresh JSON
 * data (no DOM nodes, functions, symbols or prototypes from the input).
 */
export function parseRule(value: unknown): GenericRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuleValidationError(["rule must be an object"]);
  }
  const record = value as Record<string, unknown>;

  const issues: string[] = [];
  if (Object.getOwnPropertySymbols(record).length > 0) {
    issues.push("rule must contain string keys only");
  }
  for (const key of Object.keys(record)) {
    if (RULE_KEYS[key] !== true) {
      issues.push(`unknown field "${key}"`);
    }
  }

  if (record.schema !== GENERIC_RULE_SCHEMA) {
    issues.push(`schema must be "${GENERIC_RULE_SCHEMA}"`);
  }

  let origin = "";
  try {
    origin = normalizeOrigin(record.origin as string);
  } catch (error) {
    issues.push(
      error instanceof RuleValidationError
        ? error.issues[0] ?? "invalid origin"
        : "invalid origin"
    );
  }

  let pathPattern = "";
  try {
    pathPattern = normalizePathPattern(record.pathPattern as string);
  } catch (error) {
    issues.push(
      error instanceof RuleValidationError
        ? error.issues[0] ?? "invalid pathPattern"
        : "invalid pathPattern"
    );
  }

  let editorSelector = "";
  try {
    editorSelector = compileSelector(record.editorSelector as string);
  } catch (error) {
    issues.push(
      error instanceof Error
        ? `editorSelector: ${error.message}`
        : "editorSelector is invalid"
    );
  }

  let editorKind: EditorKind | null = null;
  if (
    typeof record.editorKind === "string" &&
    EDITOR_KIND_LOOKUP[record.editorKind] === true
  ) {
    editorKind = record.editorKind as EditorKind;
  } else {
    issues.push(`editorKind must be one of ${EDITOR_KINDS.join(", ")}`);
  }

  let languageSelector: string | undefined;
  if (record.languageSelector !== undefined) {
    try {
      languageSelector = compileSelector(record.languageSelector as string);
    } catch (error) {
      issues.push(
        error instanceof Error
          ? `languageSelector: ${error.message}`
          : "languageSelector is invalid"
      );
    }
  }

  let languageMap: LanguageMap = {};
  try {
    languageMap = normalizeLanguageMap(record.languageMap);
  } catch (error) {
    if (error instanceof RuleValidationError) {
      issues.push(...error.issues);
    } else {
      issues.push("languageMap is invalid");
    }
  }

  if (issues.length > 0) {
    throw new RuleValidationError(issues);
  }

  const rule: GenericRule = {
    schema: GENERIC_RULE_SCHEMA,
    origin,
    pathPattern,
    editorSelector,
    editorKind: editorKind as EditorKind,
    languageMap
  };
  if (languageSelector !== undefined) {
    return {
      ...rule,
      languageSelector,
      languageMap
    };
  }
  return { ...rule, languageMap };
}

export const normalizeRule = parseRule;

export function tryParseRule(value: unknown): RuleParseResult {
  try {
    return { ok: true, rule: parseRule(value) };
  } catch (error) {
    if (error instanceof RuleValidationError) {
      return { ok: false, issues: error.issues };
    }
    return { ok: false, issues: [error instanceof Error ? error.message : "invalid rule"] };
  }
}

export function isGenericRule(value: unknown): value is GenericRule {
  return tryParseRule(value).ok;
}

/** Build a rule from picker output or any other trusted draft, then validate. */
export function createGenericRule(input: GenericRuleInput): GenericRule {
  const candidate: Record<string, unknown> = {
    schema: GENERIC_RULE_SCHEMA,
    origin: input.origin,
    pathPattern: input.pathPattern,
    editorSelector: input.editorSelector,
    editorKind: input.editorKind,
    languageMap: input.languageMap ?? {}
  };
  if (input.languageSelector !== undefined) {
    candidate.languageSelector = input.languageSelector;
  }
  return parseRule(candidate);
}

/** Deterministic JSON for storage. Keys follow the schema order. */
export function serializeRule(rule: unknown): string {
  return JSON.stringify(parseRule(rule));
}

export function deserializeRule(text: string): GenericRule {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new RuleValidationError(["rule text is not valid JSON"]);
  }
  return parseRule(value);
}

export function ruleMatchesLocation(rule: GenericRule, location: RuleLocation): boolean {
  let origin: string;
  try {
    origin = normalizeOrigin(location.origin);
  } catch {
    return false;
  }
  return origin === rule.origin && matchesPathPattern(rule.pathPattern, location.pathname);
}
