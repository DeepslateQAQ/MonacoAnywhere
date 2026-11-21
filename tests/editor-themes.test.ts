import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITOR_THEME_ID,
  EDITOR_THEMES,
  defineMonacoThemes,
  editorThemePrimaryColor,
  editorThemeTone,
  isEditorThemeId,
  type EditorThemeBase
} from "../extension/src/editor/editor-themes";

const EXPECTED_IDS = [
  "vs",
  "vs-dark",
  "hc-black",
  "hc-light",
  "vscode-monokai",
  "vscode-solarized-dark",
  "vscode-solarized-light",
  "vscode-abyss",
  "vscode-kimbie-dark",
  "vscode-quiet-light",
  "vscode-tomorrow-night-blue",
  "vscode-red",
  "vscode-dark-modern",
  "vscode-light-modern",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha"
];

const BUILTIN_BASES: Record<string, EditorThemeBase> = {
  vs: "vs",
  "vs-dark": "vs-dark",
  "hc-black": "hc-black",
  "hc-light": "hc-light"
};

describe("editor theme accents", () => {
  it("provides one valid primary colour for every theme", () => {
    for (const theme of EDITOR_THEMES) {
      expect(editorThemePrimaryColor(theme.id), theme.id).toMatch(
        /^#[0-9a-f]{6}$/i
      );
    }
    expect(editorThemePrimaryColor("not-a-theme")).toBeNull();
  });

  it("maps theme bases to toolbar tone", () => {
    for (const theme of EDITOR_THEMES) {
      const expected =
        theme.base === "vs" || theme.base === "hc-light" ? "light" : "dark";
      expect(editorThemeTone(theme.id), theme.id).toBe(expected);
    }
    expect(editorThemeTone("vscode-solarized-light")).toBe("light");
    expect(editorThemeTone("vscode-quiet-light")).toBe("light");
    expect(editorThemeTone("catppuccin-latte")).toBe("light");
    expect(editorThemeTone("catppuccin-mocha")).toBe("dark");
    expect(editorThemeTone("missing")).toBe("dark");
  });
});

const VSCODE_EXPECTED: Record<string, {
  label: string;
  base: EditorThemeBase;
  background: string;
  foreground: string;
}> = {
  "vscode-monokai": {
    label: "Monokai",
    base: "vs-dark",
    background: "#272822",
    foreground: "#f8f8f2"
  },
  "vscode-solarized-dark": {
    label: "Solarized Dark",
    base: "vs-dark",
    background: "#002b36",
    foreground: "#839496"
  },
  "vscode-solarized-light": {
    label: "Solarized Light",
    base: "vs",
    background: "#fdf6e3",
    foreground: "#657b83"
  },
  "vscode-abyss": {
    label: "Abyss",
    base: "vs-dark",
    background: "#000c18",
    foreground: "#6688cc"
  },
  "vscode-kimbie-dark": {
    label: "Kimbie Dark",
    base: "vs-dark",
    background: "#221a0f",
    foreground: "#d3af86"
  },
  "vscode-quiet-light": {
    label: "Quiet Light",
    base: "vs",
    background: "#f5f5f5",
    foreground: "#333333"
  },
  "vscode-tomorrow-night-blue": {
    label: "Tomorrow Night Blue",
    base: "vs-dark",
    background: "#002451",
    foreground: "#ffffff"
  },
  "vscode-red": {
    label: "Red",
    base: "vs-dark",
    background: "#390000",
    foreground: "#f8f8f8"
  },
  "vscode-dark-modern": {
    label: "Dark Modern",
    base: "vs-dark",
    background: "#1f1f1f",
    foreground: "#cccccc"
  },
  "vscode-light-modern": {
    label: "Light Modern",
    base: "vs",
    background: "#ffffff",
    foreground: "#3b3b3b"
  }
};

interface CatppuccinExpectation {
  base: EditorThemeBase;
  background: string;
  foreground: string;
  colors: Readonly<Record<string, string>>;
  tokens: Readonly<Record<string, {
    foreground: string;
    fontStyle?: "italic" | "bold" | "underline" | "strikethrough";
  }>>;
}

const CATPPUCCIN_EXPECTED: Record<string, CatppuccinExpectation> = {
  "catppuccin-latte": {
    base: "vs",
    background: "#eff1f5",
    foreground: "#4c4f69",
    colors: {
      "editor.selectionBackground": "#7c7f934d",
      "editor.lineHighlightBackground": "#4c4f6912",
      "editorLineNumber.foreground": "#8c8fa1",
      "editorLineNumber.activeForeground": "#8839ef",
      "editorCursor.foreground": "#dc8a78",
      "editorWhitespace.foreground": "#7c7f9366",
      "editorBracketMatch.border": "#7c7f93",
      "editorBracketHighlight.foreground1": "#d20f39",
      "editorGutter.addedBackground": "#40a02b",
      "editorGutter.modifiedBackground": "#df8e1d",
      "editorWidget.background": "#e6e9ef",
      "editorSuggestWidget.selectedBackground": "#ccd0da",
      "editorHoverWidget.background": "#e6e9ef",
      "scrollbarSlider.background": "#acb0be80",
      "minimap.background": "#e6e9ef80",
      "menu.background": "#eff1f5",
      "menu.foreground": "#4c4f69",
      "menu.border": "#acb0be",
      "menu.selectionBackground": "#acb0be",
      "menu.selectionForeground": "#4c4f69",
      "menu.separatorBackground": "#acb0be",
      "menu.shadowColor": "#dce0e8",
      "quickInput.background": "#e6e9ef",
      "quickInput.border": "#acb0be",
      "quickInputList.focusBackground": "#ccd0da",
      "list.hoverBackground": "#ccd0da80",
      "list.activeSelectionBackground": "#ccd0da",
      "list.inactiveSelectionBackground": "#ccd0da"
    },
    tokens: {
      comment: { foreground: "#7c7f93", fontStyle: "italic" },
      keyword: { foreground: "#8839ef" },
      string: { foreground: "#40a02b" },
      number: { foreground: "#fe640b" },
      constant: { foreground: "#fe640b" },
      type: { foreground: "#df8e1d", fontStyle: "italic" },
      class: { foreground: "#df8e1d", fontStyle: "italic" },
      function: { foreground: "#1e66f5", fontStyle: "italic" },
      variable: { foreground: "#4c4f69" },
      operator: { foreground: "#179299" },
      delimiter: { foreground: "#7c7f93" },
      regexp: { foreground: "#4c4f69" },
      tag: { foreground: "#1e66f5" },
      attribute: { foreground: "#df8e1d" }
    }
  },
  "catppuccin-frappe": {
    base: "vs-dark",
    background: "#303446",
    foreground: "#c6d0f5",
    colors: {
      "editor.selectionBackground": "#949cbb40",
      "editor.lineHighlightBackground": "#c6d0f512",
      "editorLineNumber.foreground": "#838ba7",
      "editorLineNumber.activeForeground": "#ca9ee6",
      "editorCursor.foreground": "#f2d5cf",
      "editorWhitespace.foreground": "#949cbb66",
      "editorBracketMatch.border": "#949cbb",
      "editorBracketHighlight.foreground1": "#e78284",
      "editorGutter.addedBackground": "#a6d189",
      "editorGutter.modifiedBackground": "#e5c890",
      "editorWidget.background": "#292c3c",
      "editorSuggestWidget.selectedBackground": "#414559",
      "editorHoverWidget.background": "#292c3c",
      "scrollbarSlider.background": "#62688080",
      "minimap.background": "#292c3c80",
      "menu.background": "#303446",
      "menu.foreground": "#c6d0f5",
      "menu.border": "#626880",
      "menu.selectionBackground": "#626880",
      "menu.selectionForeground": "#c6d0f5",
      "menu.separatorBackground": "#626880",
      "menu.shadowColor": "#232634",
      "quickInput.background": "#292c3c",
      "quickInput.border": "#626880",
      "quickInputList.focusBackground": "#414559",
      "list.hoverBackground": "#41455980",
      "list.activeSelectionBackground": "#414559",
      "list.inactiveSelectionBackground": "#414559"
    },
    tokens: {
      comment: { foreground: "#949cbb", fontStyle: "italic" },
      keyword: { foreground: "#ca9ee6" },
      string: { foreground: "#a6d189" },
      number: { foreground: "#ef9f76" },
      constant: { foreground: "#ef9f76" },
      type: { foreground: "#e5c890", fontStyle: "italic" },
      class: { foreground: "#e5c890", fontStyle: "italic" },
      function: { foreground: "#8caaee", fontStyle: "italic" },
      variable: { foreground: "#c6d0f5" },
      operator: { foreground: "#81c8be" },
      delimiter: { foreground: "#949cbb" },
      regexp: { foreground: "#c6d0f5" },
      tag: { foreground: "#8caaee" },
      attribute: { foreground: "#e5c890" }
    }
  },
  "catppuccin-macchiato": {
    base: "vs-dark",
    background: "#24273a",
    foreground: "#cad3f5",
    colors: {
      "editor.selectionBackground": "#939ab740",
      "editor.lineHighlightBackground": "#cad3f512",
      "editorLineNumber.foreground": "#8087a2",
      "editorLineNumber.activeForeground": "#c6a0f6",
      "editorCursor.foreground": "#f4dbd6",
      "editorWhitespace.foreground": "#939ab766",
      "editorBracketMatch.border": "#939ab7",
      "editorBracketHighlight.foreground1": "#ed8796",
      "editorGutter.addedBackground": "#a6da95",
      "editorGutter.modifiedBackground": "#eed49f",
      "editorWidget.background": "#1e2030",
      "editorSuggestWidget.selectedBackground": "#363a4f",
      "editorHoverWidget.background": "#1e2030",
      "scrollbarSlider.background": "#5b607880",
      "minimap.background": "#1e203080",
      "menu.background": "#24273a",
      "menu.foreground": "#cad3f5",
      "menu.border": "#5b6078",
      "menu.selectionBackground": "#5b6078",
      "menu.selectionForeground": "#cad3f5",
      "menu.separatorBackground": "#5b6078",
      "menu.shadowColor": "#181926",
      "quickInput.background": "#1e2030",
      "quickInput.border": "#5b6078",
      "quickInputList.focusBackground": "#363a4f",
      "list.hoverBackground": "#363a4f80",
      "list.activeSelectionBackground": "#363a4f",
      "list.inactiveSelectionBackground": "#363a4f"
    },
    tokens: {
      comment: { foreground: "#939ab7", fontStyle: "italic" },
      keyword: { foreground: "#c6a0f6" },
      string: { foreground: "#a6da95" },
      number: { foreground: "#f5a97f" },
      constant: { foreground: "#f5a97f" },
      type: { foreground: "#eed49f", fontStyle: "italic" },
      class: { foreground: "#eed49f", fontStyle: "italic" },
      function: { foreground: "#8aadf4", fontStyle: "italic" },
      variable: { foreground: "#cad3f5" },
      operator: { foreground: "#8bd5ca" },
      delimiter: { foreground: "#939ab7" },
      regexp: { foreground: "#cad3f5" },
      tag: { foreground: "#8aadf4" },
      attribute: { foreground: "#eed49f" }
    }
  },
  "catppuccin-mocha": {
    base: "vs-dark",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    colors: {
      "editor.selectionBackground": "#9399b240",
      "editor.lineHighlightBackground": "#cdd6f412",
      "editorLineNumber.foreground": "#7f849c",
      "editorLineNumber.activeForeground": "#cba6f7",
      "editorCursor.foreground": "#f5e0dc",
      "editorWhitespace.foreground": "#9399b266",
      "editorBracketMatch.border": "#9399b2",
      "editorBracketHighlight.foreground1": "#f38ba8",
      "editorGutter.addedBackground": "#a6e3a1",
      "editorGutter.modifiedBackground": "#f9e2af",
      "editorWidget.background": "#181825",
      "editorSuggestWidget.selectedBackground": "#313244",
      "editorHoverWidget.background": "#181825",
      "scrollbarSlider.background": "#585b7080",
      "minimap.background": "#18182580",
      "menu.background": "#1e1e2e",
      "menu.foreground": "#cdd6f4",
      "menu.border": "#585b70",
      "menu.selectionBackground": "#585b70",
      "menu.selectionForeground": "#cdd6f4",
      "menu.separatorBackground": "#585b70",
      "menu.shadowColor": "#11111b",
      "quickInput.background": "#181825",
      "quickInput.border": "#585b70",
      "quickInputList.focusBackground": "#313244",
      "list.hoverBackground": "#31324480",
      "list.activeSelectionBackground": "#313244",
      "list.inactiveSelectionBackground": "#313244"
    },
    tokens: {
      comment: { foreground: "#9399b2", fontStyle: "italic" },
      keyword: { foreground: "#cba6f7" },
      string: { foreground: "#a6e3a1" },
      number: { foreground: "#fab387" },
      constant: { foreground: "#fab387" },
      type: { foreground: "#f9e2af", fontStyle: "italic" },
      class: { foreground: "#f9e2af", fontStyle: "italic" },
      function: { foreground: "#89b4fa", fontStyle: "italic" },
      variable: { foreground: "#cdd6f4" },
      operator: { foreground: "#94e2d5" },
      delimiter: { foreground: "#9399b2" },
      regexp: { foreground: "#cdd6f4" },
      tag: { foreground: "#89b4fa" },
      attribute: { foreground: "#f9e2af" }
    }
  }
};

const DEFINE_THEME_IDS = [
  ...Object.keys(VSCODE_EXPECTED),
  ...Object.keys(CATPPUCCIN_EXPECTED)
];

const EXPECTED_TOKEN_TYPES = [
  "attribute",
  "class",
  "comment",
  "constant",
  "delimiter",
  "function",
  "keyword",
  "number",
  "operator",
  "regexp",
  "string",
  "tag",
  "type",
  "variable"
];

const SURFACE_COLOR_KEYS = [
  "menu.background",
  "menu.foreground",
  "menu.border",
  "menu.selectionBackground",
  "menu.selectionForeground",
  "menu.separatorBackground",
  "menu.shadowColor",
  "editorWidget.background",
  "editorWidget.foreground",
  "editorWidget.border",
  "quickInput.background",
  "quickInput.foreground",
  "quickInput.border",
  "quickInputList.focusBackground",
  "quickInputList.focusForeground",
  "list.hoverBackground",
  "list.activeSelectionBackground",
  "list.activeSelectionForeground",
  "list.inactiveSelectionBackground",
  "list.inactiveSelectionForeground"
];

const OPAQUE_MENU_KEYS = [
  "menu.background",
  "menu.foreground",
  "menu.border",
  "menu.selectionBackground",
  "menu.selectionForeground",
  "menu.separatorBackground",
  "menu.shadowColor"
];

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
const OPAQUE_COLOR = /^#[0-9a-f]{6}$/;
const TOKEN_COLOR = /^[0-9a-f]{6}$/;

interface RecordedTheme {
  readonly name: string;
  readonly theme: Record<string, unknown>;
}

function captureDefinitions(): RecordedTheme[] {
  const calls: RecordedTheme[] = [];
  defineMonacoThemes({
    editor: {
      defineTheme(name, theme) {
        calls.push({ name, theme: theme as Record<string, unknown> });
      }
    }
  });
  return calls;
}

function themeById(id: string): (typeof EDITOR_THEMES)[number] {
  const theme = EDITOR_THEMES.find((candidate) => candidate.id === id);
  if (!theme) {
    throw new Error(`missing editor theme ${id}`);
  }
  return theme;
}

function definedTheme(
  calls: RecordedTheme[],
  name: string
): Record<string, unknown> {
  const match = calls.find((call) => call.name === name);
  if (!match) {
    throw new Error(`missing defined theme ${name}`);
  }
  return match.theme;
}

function expectCompleteTheme(
  name: string,
  theme: Record<string, unknown>,
  expectedBase: EditorThemeBase,
  expectedBackground: string,
  expectedForeground: string
): void {
  expect(theme.base, name).toBe(expectedBase);
  expect(theme.inherit, name).toBe(false);

  const colors = theme.colors as Record<string, unknown>;
  expect(colors["editor.background"], name).toBe(expectedBackground);
  expect(colors["editor.foreground"], name).toBe(expectedForeground);

  for (const [key, value] of Object.entries(colors)) {
    expect(key.length, name).toBeGreaterThan(0);
    expect(typeof value, `${name} ${key}`).toBe("string");
    if (typeof value === "string") {
      expect(value, `${name} ${key}`).toMatch(HEX_COLOR);
    }
  }

  for (const prefix of [
    "editor.selection",
    "editor.findMatch",
    "editor.lineHighlight",
    "editorLineNumber",
    "editorCursor",
    "editorWidget",
    "editorSuggestWidget",
    "editorHoverWidget",
    "scrollbar",
    "minimap",
    "editorGutter",
    "menu",
    "quickInput",
    "list"
  ]) {
    expect(
      Object.keys(colors).some((key) => key.startsWith(prefix)),
      `${name} is missing ${prefix}* colours`
    ).toBe(true);
  }

  const rules = theme.rules as Array<Record<string, unknown>>;
  const tokens = rules.map((rule) => rule.token).sort();
  expect(tokens, name).toEqual(EXPECTED_TOKEN_TYPES);

  for (const rule of rules) {
    expect(typeof rule.token, name).toBe("string");
    expect(typeof rule.foreground, name).toBe("string");
    if (typeof rule.foreground === "string") {
      expect(rule.foreground, name).toMatch(TOKEN_COLOR);
    }
    if (typeof rule.fontStyle === "string") {
      expect(
        ["italic", "bold", "underline", "strikethrough"],
        name
      ).toContain(rule.fontStyle);
    } else {
      expect(rule.fontStyle, name).toBeUndefined();
    }
  }
}

describe("editor theme catalogue", () => {
  it("uses the exact expected id set without duplicates", () => {
    const ids = EDITOR_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("describes built-in VS Code themes with their native bases", () => {
    for (const [id, base] of Object.entries(BUILTIN_BASES)) {
      const theme = themeById(id);
      expect(theme.group).toBe("vscode");
      expect(theme.base).toBe(base);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });

  it("describes the added VS Code themes with their expected labels and bases", () => {
    for (const [id, expected] of Object.entries(VSCODE_EXPECTED)) {
      const theme = themeById(id);
      expect(theme.group).toBe("vscode");
      expect(theme.base).toBe(expected.base);
      expect(theme.label).toBe(expected.label);
    }
  });

  it("describes Catppuccin themes with the expected Monaco bases", () => {
    for (const [id, expected] of Object.entries(CATPPUCCIN_EXPECTED)) {
      const theme = themeById(id);
      expect(theme.group).toBe("catppuccin");
      expect(theme.base).toBe(expected.base);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });

  it("defaults to the standard dark theme", () => {
    expect(DEFAULT_EDITOR_THEME_ID).toBe("vs-dark");
    expect(isEditorThemeId(DEFAULT_EDITOR_THEME_ID)).toBe(true);
  });
});

describe("defineMonacoThemes", () => {
  it("defines only the ten VS Code and four Catppuccin themes", () => {
    const calls = captureDefinitions();
    const names = calls.map((call) => call.name);

    expect(names).toEqual(DEFINE_THEME_IDS);
    expect(new Set(names).size).toBe(DEFINE_THEME_IDS.length);
    for (const builtin of Object.keys(BUILTIN_BASES)) {
      expect(names).not.toContain(builtin);
    }
  });

  it("ships complete Catppuccin theme data", () => {
    const calls = captureDefinitions();
    const defined = calls.filter((call) =>
      Object.hasOwn(CATPPUCCIN_EXPECTED, call.name)
    );

    expect(defined).toHaveLength(Object.keys(CATPPUCCIN_EXPECTED).length);
    for (const { name, theme } of defined) {
      const expected = CATPPUCCIN_EXPECTED[name];
      if (!expected) {
        continue;
      }
      expectCompleteTheme(
        name,
        theme,
        expected.base,
        expected.background,
        expected.foreground
      );
    }
  });

  it("reproduces the official Catppuccin UI colours", () => {
    const calls = captureDefinitions();

    for (const [name, expected] of Object.entries(CATPPUCCIN_EXPECTED)) {
      const colors = definedTheme(calls, name).colors as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(expected.colors)) {
        expect(colors[key], `${name} ${key}`).toBe(value);
      }
    }
  });

  it("reproduces the official Catppuccin token colours and font styles", () => {
    const calls = captureDefinitions();

    for (const [name, expected] of Object.entries(CATPPUCCIN_EXPECTED)) {
      const rules = definedTheme(calls, name).rules as Array<
        Record<string, unknown>
      >;
      const byToken = new Map(
        rules.map((rule) => [rule.token, rule] as const)
      );

      for (const [token, tokenExpected] of Object.entries(expected.tokens)) {
        const actual = byToken.get(token);
        expect(actual, `${name} ${token}`).toBeDefined();
        expect(actual?.foreground, `${name} ${token}`).toBe(
          String(tokenExpected.foreground).replace(/^#/, "")
        );
        expect(actual?.fontStyle, `${name} ${token}`).toBe(
          tokenExpected.fontStyle
        );
      }
    }
  });

  it("keeps every Catppuccin menu surface opaque", () => {
    const calls = captureDefinitions();

    for (const name of Object.keys(CATPPUCCIN_EXPECTED)) {
      const colors = definedTheme(calls, name).colors as Record<
        string,
        unknown
      >;
      for (const key of OPAQUE_MENU_KEYS) {
        const value = colors[key];
        expect(typeof value, `${name} ${key}`).toBe("string");
        if (typeof value === "string") {
          expect(value, `${name} ${key}`).toMatch(OPAQUE_COLOR);
        }
      }
    }
  });

  it("ships complete VS Code theme data", () => {
    const calls = captureDefinitions();
    const defined = calls.filter((call) =>
      Object.hasOwn(VSCODE_EXPECTED, call.name)
    );

    expect(defined).toHaveLength(Object.keys(VSCODE_EXPECTED).length);
    for (const { name, theme } of defined) {
      const expected = VSCODE_EXPECTED[name];
      if (!expected) {
        continue;
      }
      expectCompleteTheme(
        name,
        theme,
        expected.base,
        expected.background,
        expected.foreground
      );
    }
  });

  it("provides opaque menu, widget, quick input, and list surfaces", () => {
    const calls = captureDefinitions();
    expect(calls).toHaveLength(DEFINE_THEME_IDS.length);

    for (const { name, theme } of calls) {
      const colors = theme.colors as Record<string, unknown>;
      const menuBackground = colors["menu.background"];
      expect(typeof menuBackground, `${name} menu.background`).toBe("string");
      if (typeof menuBackground === "string") {
        expect(menuBackground, `${name} menu.background`).toMatch(OPAQUE_COLOR);
      }

      for (const key of SURFACE_COLOR_KEYS) {
        const value = colors[key];
        expect(typeof value, `${name} ${key}`).toBe("string");
        if (typeof value === "string") {
          expect(value, `${name} ${key}`).toMatch(HEX_COLOR);
        }
      }
    }
  });

  it("can be called with an editor-only theme host", () => {
    const names: string[] = [];
    const result = defineMonacoThemes({
      editor: {
        defineTheme(name: string, _theme: unknown): void {
          names.push(name);
        }
      }
    });

    expect(result).toBeUndefined();
    expect(names).toHaveLength(DEFINE_THEME_IDS.length);
  });
});

describe("isEditorThemeId", () => {
  it("accepts every catalogued id", () => {
    for (const theme of EDITOR_THEMES) {
      expect(isEditorThemeId(theme.id)).toBe(true);
    }
  });

  it("rejects unknown, malformed, and non-string values", () => {
    const rejected: unknown[] = [
      "",
      " ",
      "vs dark",
      "VS-DARK",
      "catppuccin",
      "catppuccin-espresso",
      "vscode",
      "vscode-monokai-light",
      "monokai",
      "hcdark",
      "constructor",
      "__proto__",
      "toString",
      null,
      undefined,
      0,
      1,
      true,
      false,
      {},
      [],
      Object.create(null)
    ];

    for (const value of rejected) {
      expect(isEditorThemeId(value)).toBe(false);
    }
  });
});
