import { describe, expect, it } from "vitest";

import {
  GENERIC_RULE_SCHEMA,
  RuleValidationError,
  SelectorValidationError,
  compileSelector,
  createGenericRule,
  deserializeRule,
  isGenericRule,
  isPathPattern,
  isSafeSelector,
  matchesPathPattern,
  normalizePathPattern,
  normalizeRule,
  parseRule,
  ruleMatchesLocation,
  serializeRule,
  suggestPathPattern,
  tryParseRule
} from "../extension/src/content/rules";
import {
  chooseVisibleCandidate,
  detectEditorKind,
  mappedStandard,
  optionsForStandard,
  resolveGenericEditor
} from "../extension/src/sites/generic";
import type { ClassifiableElement } from "../extension/src/sites/generic";
import type { Standard } from "../extension/src/profiles/types";

interface FakeCandidate {
  readonly id: string;
  readonly visible: boolean;
}

function isFakeVisible(candidate: FakeCandidate): boolean {
  return candidate.visible;
}

function fakeElement(
  tagName: string,
  classes: readonly string[] = [],
  attributes: Readonly<Record<string, string>> = {}
): ClassifiableElement {
  return {
    tagName,
    classList: { contains: (token: string) => classes.includes(token) },
    getAttribute: (name: string) => attributes[name] ?? null
  };
}

const baseRule = {
  schema: GENERIC_RULE_SCHEMA,
  origin: "https://example.com",
  pathPattern: "/problems/*",
  editorSelector: "textarea[name='code']",
  editorKind: "textarea",
  languageMap: { "54": "c++17", "0": null }
} as const;

describe("compileSelector", () => {
  it("accepts the documented subset and canonicalizes it", () => {
    expect(compileSelector("  div#app  .cm-editor  ")).toBe(
      "div#app .cm-editor"
    );
    expect(compileSelector("form textarea[name='code']")).toBe(
      'form textarea[name="code"]'
    );
    expect(compileSelector("div.foo#main.bar[b='2'][a='1']")).toBe(
      'div#main.foo.bar[b="2"][a="1"]'
    );
    expect(compileSelector('textarea[data-lang="c++17"]')).toBe(
      'textarea[data-lang="c++17"]'
    );
    expect(compileSelector('[contenteditable=""]')).toBe(
      '[contenteditable=""]'
    );
    expect(compileSelector("my-editor#main")).toBe("my-editor#main");
    expect(compileSelector(".cm-editor.cm-focused")).toBe(
      ".cm-editor.cm-focused"
    );
  });

  it("rejects injection, pseudo selectors and broad combinators", () => {
    const rejected = [
      "*",
      "div *",
      ":has(textarea)",
      "textarea::before",
      "div:not(.x)",
      "div > span",
      "a + b",
      "a ~ b",
      "a, b",
      "[name]",
      '[name^="x"]',
      '[name$="x"]',
      '[name*="x"]',
      '[name="x" i]',
      "#a#b",
      "javascript:foo",
      'a[href="javascript:alert(1)"]',
      'a[href="https://example.com"]',
      ".x\\:y",
      "div {",
      "div)",
      "",
      "div,textarea"
    ];

    for (const selector of rejected) {
      expect(() => compileSelector(selector), selector).toThrow(
        SelectorValidationError
      );
      expect(isSafeSelector(selector)).toBe(false);
    }
  });

  it("rejects selectors that are too long or contain control characters", () => {
    expect(() => compileSelector(`div#${"a".repeat(600)}`)).toThrow(
      SelectorValidationError
    );
    expect(() => compileSelector("div\u0000span")).toThrow(
      SelectorValidationError
    );
  });
});

describe("path patterns", () => {
  it("matches whole pathnames and keeps wildcards inside one segment", () => {
    expect(matchesPathPattern("/problems/*", "/problems/123")).toBe(true);
    expect(matchesPathPattern("/problems/*", "/problems/123/submit")).toBe(
      false
    );
    expect(matchesPathPattern("/contest/*/submit", "/contest/abc/submit")).toBe(
      true
    );
    expect(matchesPathPattern("/a", "/a")).toBe(true);
    expect(matchesPathPattern("/", "/")).toBe(true);
    expect(matchesPathPattern("/files/%.*", "/files/%.txt")).toBe(true);
    expect(matchesPathPattern("/files/%.*", "/files/x.txt")).toBe(false);
  });

  it("normalizes valid patterns and rejects broad or malformed ones", () => {
    expect(normalizePathPattern(" /problems/* ")).toBe("/problems/*");
    expect(isPathPattern("/")).toBe(true);
    expect(isPathPattern("/problems/*")).toBe(true);

    const rejected = [
      "problems/*",
      "/*",
      "/**",
      "/*/*",
      "/p/*",
      "https://example.com/*",
      "/a?b",
      "/a#b",
      "/a b",
      "/../x",
      "/a/./b",
      "/a//b",
      "/a\\b",
      "/a[b]"
    ];
    for (const pattern of rejected) {
      expect(() => normalizePathPattern(pattern), pattern).toThrow(
        RuleValidationError
      );
      expect(isPathPattern(pattern)).toBe(false);
    }
  });

  it("suggests an exact path without query or fragment", () => {
    expect(suggestPathPattern("/problems/42?x=1#y")).toBe("/problems/42");
    expect(suggestPathPattern("/")).toBe("/");
    expect(suggestPathPattern("relative/path")).toBe("/relative/path");
  });
});

describe("rule normalization", () => {
  it("normalizes field values and defaults the language map", () => {
    const rule = normalizeRule({
      schema: GENERIC_RULE_SCHEMA,
      origin: "https://Example.COM:443/",
      pathPattern: " /problems/* ",
      editorSelector: " .cm-editor ",
      editorKind: "cm6",
      languageSelector: "select[name='lang']",
      languageMap: { "54": "c++17", placeholder: null }
    });

    expect(rule).toEqual({
      schema: GENERIC_RULE_SCHEMA,
      origin: "https://example.com",
      pathPattern: "/problems/*",
      editorSelector: ".cm-editor",
      editorKind: "cm6",
      languageSelector: 'select[name="lang"]',
      languageMap: { "54": "c++17", placeholder: null }
    });

    const withoutLanguage = createGenericRule({
      origin: "https://example.com",
      pathPattern: "/submit",
      editorSelector: "textarea",
      editorKind: "textarea"
    });
    expect(withoutLanguage).toEqual({
      schema: GENERIC_RULE_SCHEMA,
      origin: "https://example.com",
      pathPattern: "/submit",
      editorSelector: "textarea",
      editorKind: "textarea",
      languageMap: {}
    });
    expect(isGenericRule(withoutLanguage)).toBe(true);
  });

  it("round-trips through JSON without functions or DOM state", () => {
    const rule = parseRule(baseRule);
    const serialized = serializeRule(baseRule);
    expect(serialized).toBe(JSON.stringify(rule));
    expect(deserializeRule(serialized)).toEqual(rule);
    expect(JSON.parse(serialized)).toEqual(rule);
  });

  it("rejects unknown fields, bad enums, origins and maps", () => {
    const invalid = [
      { ...baseRule, extra: true },
      { ...baseRule, schema: "monacoanywhere.generic-rule/2" },
      { ...baseRule, editorKind: "codemirror" },
      { ...baseRule, origin: "file:///tmp/page" },
      { ...baseRule, origin: "https://example.com/path" },
      { ...baseRule, origin: "https://user:pass@example.com" },
      { ...baseRule, pathPattern: "/*" },
      { ...baseRule, editorSelector: "div:has(textarea)" },
      { ...baseRule, languageSelector: "div > select" },
      { ...baseRule, languageMap: { "54": "c++26" } },
      { ...baseRule, languageMap: { "54": "c++17", "": null } },
      { ...baseRule, languageMap: [] },
      { ...baseRule, languageMap: { ["__proto__"]: null } },
      { ...baseRule, onLoad: () => undefined }
    ];

    for (const candidate of invalid) {
      expect(() => parseRule(candidate)).toThrow(RuleValidationError);
    }

    const result = tryParseRule({ ...baseRule, extra: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join("\n")).toContain('unknown field "extra"');
    }
  });

  it("matches only the normalized origin and path pattern", () => {
    const rule = parseRule(baseRule);
    expect(
      ruleMatchesLocation(rule, {
        origin: "https://example.com",
        pathname: "/problems/1001"
      })
    ).toBe(true);
    expect(
      ruleMatchesLocation(rule, {
        origin: "https://example.com",
        pathname: "/problems/1001/submit"
      })
    ).toBe(false);
    expect(
      ruleMatchesLocation(rule, {
        origin: "https://other.example",
        pathname: "/problems/1001"
      })
    ).toBe(false);
    expect(
      ruleMatchesLocation(rule, { origin: "not an origin", pathname: "/x" })
    ).toBe(false);
  });
});

describe("generic candidate selection", () => {
  it("returns none, single, and ambiguous without DOM", () => {
    const candidates: FakeCandidate[] = [
      { id: "a", visible: false },
      { id: "b", visible: true },
      { id: "c", visible: false }
    ];

    expect(
      chooseVisibleCandidate(candidates, isFakeVisible)
    ).toMatchObject({
      status: "single",
      visible: [{ id: "b", visible: true }],
      candidate: { id: "b", visible: true }
    });

    expect(
      chooseVisibleCandidate(
        candidates.map((candidate) => ({ ...candidate, visible: false })),
        isFakeVisible
      )
    ).toEqual({ status: "none", visible: [] });

    const ambiguous = chooseVisibleCandidate(
      candidates.map((candidate) => ({ ...candidate, visible: true })),
      isFakeVisible
    );
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.visible).toHaveLength(3);
    expect(ambiguous.candidate).toBeUndefined();
  });

  it("classifies supported editor kinds from minimal fake elements", () => {
    expect(detectEditorKind(fakeElement("TEXTAREA"))).toBe("textarea");
    expect(
      detectEditorKind(fakeElement("DIV", ["ace_editor"]))
    ).toBe("ace");
    expect(
      detectEditorKind(fakeElement("DIV", ["CodeMirror"]))
    ).toBe("cm5");
    expect(
      detectEditorKind(fakeElement("DIV", ["cm-editor"]))
    ).toBe("cm6");
    expect(
      detectEditorKind(fakeElement("DIV", ["monaco-editor"]))
    ).toBe("monaco");
    expect(
      detectEditorKind(
        fakeElement("DIV", [], { contenteditable: "true" })
      )
    ).toBe("textarea");
    expect(
      detectEditorKind(
        fakeElement("DIV", [], { contenteditable: "false" })
      )
    ).toBeNull();
    expect(detectEditorKind(fakeElement("DIV", ["cm-content"]))).toBeNull();
  });

  it("reports invalid-rule and missing-document fallbacks", () => {
    expect(
      resolveGenericEditor({ schema: "wrong" })
    ).toMatchObject({
      status: "fallback",
      reason: "invalid-rule"
    });

    expect(resolveGenericEditor(baseRule)).toMatchObject({
      status: "fallback",
      reason: "no-document"
    });
  });
});

describe("language map helpers", () => {
  it("reads mapped standards and lists duplicate candidates", () => {
    const languageMap: Record<string, Standard | null> = {
      "1": "c++17",
      "2": "c++17",
      "3": null
    };
    expect(mappedStandard("1", languageMap)).toBe("c++17");
    expect(mappedStandard("3", languageMap)).toBeNull();
    expect(mappedStandard("missing", languageMap)).toBeNull();
    expect(optionsForStandard(languageMap, "c++17")).toEqual(["1", "2"]);
    expect(optionsForStandard(languageMap, "c++20")).toEqual([]);
  });
});
