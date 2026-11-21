/*
 * Editor theme catalogue.
 *
 * The four VS Code themes already ship with Monaco and are only listed here so
 * the popup and options page can offer them.
 *
 * The Catppuccin themes are compiled from the official Catppuccin for VSCode
 * extension, https://github.com/catppuccin/vscode, at revision
 * befc9e6fc41980f4241408f7049755d47c06ff45 (release catppuccin-vsc-v3.19.0).
 * The UI colours reproduce the released theme JSON in
 * https://github.com/catppuccin/vscode/releases/download/catppuccin-vsc-v3.19.0/catppuccin-vsc-3.19.0.vsix
 * (extension/themes/{latte,frappe,macchiato,mocha}.json). The palette entries
 * below match @catppuccin/palette; colours that the extension expresses as a
 * blend rather than a palette colour are listed per variant.
 *
 * Monaco does not consume TextMate scopes, so the official tokenColors are
 * projected onto Monaco's fourteen top-level token buckets: comment,
 * keyword, string, number, constant, type, class, function, variable,
 * operator, delimiter, regexp, tag, and attribute. Each rule reuses the exact
 * official foreground and fontStyle (comments, functions, types, and classes
 * are italic). The regexp bucket maps to the official "Regex regular string
 * match" rule. The extension omits menu.shadowColor, quickInput.*, and
 * editorWidget.border; those use the official palette and the same surface
 * values as their official siblings. menu.border is normalised from the
 * extension's translucent base80 default to the opaque surface2 colour of its
 * extraBordersEnabled option so Monaco context menus always have a visible,
 * non-transparent boundary.
 *
 * The additional VS Code themes are derived from the official built-in theme
 * sources in microsoft/vscode (revision bfbf12b35b9978b92b2d341e81ade49f2b18c68c,
 * extensions/theme-<name>/themes and extensions/theme-defaults/themes). Dark Modern
 * and Light Modern inherit their token colours through dark_plus/light_plus and
 * dark_vs/light_vs, which is why their resolved data lives here rather than in
 * a single source file. Hex values are normalised to lowercase, and the Red
 * theme's opaque "#rrggbbff" token colours are reduced to "#rrggbb" because
 * Monaco token rules do not carry alpha.
 *
 * Monaco's editor colours do not cover every workbench surface. The menu,
 * quick-input, and list colours are therefore part of each custom theme so the
 * context menu is never left transparent, and missing editor chrome falls back
 * to the theme's own palette or to VS Code's registered defaults (noted in
 * buildVscodeTheme).
 *
 * This module deliberately has no Monaco or extension API imports so both the
 * editor iframe and the test suite can consume it directly.
 */

export type EditorThemeBase = "vs" | "vs-dark" | "hc-black" | "hc-light";

export interface EditorThemeOption {
  readonly id: string;
  readonly label: string;
  readonly group: "vscode" | "catppuccin";
  readonly base: EditorThemeBase;
}

type CatppuccinVariant = "latte" | "frappe" | "macchiato" | "mocha";

interface CatppuccinPalette {
  readonly rosewater: string;
  readonly flamingo: string;
  readonly pink: string;
  readonly mauve: string;
  readonly red: string;
  readonly maroon: string;
  readonly peach: string;
  readonly yellow: string;
  readonly green: string;
  readonly teal: string;
  readonly sky: string;
  readonly sapphire: string;
  readonly blue: string;
  readonly lavender: string;
  readonly text: string;
  readonly subtext1: string;
  readonly subtext0: string;
  readonly overlay2: string;
  readonly overlay1: string;
  readonly overlay0: string;
  readonly surface2: string;
  readonly surface1: string;
  readonly surface0: string;
  readonly base: string;
  readonly mantle: string;
  readonly crust: string;
}

interface CatppuccinThemeOption extends EditorThemeOption {
  readonly group: "catppuccin";
  readonly variant: CatppuccinVariant;
}

type VscodeThemeVariant =
  | "monokai"
  | "solarized-dark"
  | "solarized-light"
  | "abyss"
  | "kimbie-dark"
  | "quiet-light"
  | "tomorrow-night-blue"
  | "red"
  | "dark-modern"
  | "light-modern";

interface VscodeThemeOption extends EditorThemeOption {
  readonly group: "vscode";
  readonly variant: VscodeThemeVariant;
}

/*
 * Core editor colours resolved from the official theme sources. Optional
 * values are either absent from the source JSON or already covered by the
 * documented VS Code workbench defaults in buildVscodeTheme.
 */
interface VscodePalette {
  readonly background: string;
  readonly foreground: string;
  readonly selection: string;
  readonly inactiveSelection?: string;
  readonly selectionHighlight?: string;
  readonly lineHighlight: string;
  readonly lineNumber: string;
  readonly lineNumberActive: string;
  readonly cursor: string;
  readonly widgetBackground: string;
  readonly widgetBorder: string;
  readonly accent: string;
  readonly added: string;
  readonly deleted: string;
  readonly error: string;
  readonly warning: string;
  readonly info: string;
  readonly hint: string;
  readonly scrollbar?: string;
  readonly scrollbarHover?: string;
  readonly scrollbarActive?: string;
  readonly minimapSelection?: string;
  readonly minimapFind?: string;
}

interface VscodeThemeDefinition {
  readonly palette: VscodePalette;
  readonly rules: readonly MonacoTokenRule[];
}

interface MonacoTokenRule {
  readonly token: string;
  readonly foreground: string;
  readonly fontStyle?: "italic" | "bold" | "underline" | "strikethrough";
}

interface MonacoThemeData {
  readonly base: EditorThemeBase;
  readonly inherit: false;
  readonly rules: readonly MonacoTokenRule[];
  readonly colors: Readonly<Record<string, string>>;
}

interface CatppuccinColorRule {
  readonly key: string;
  readonly color: keyof CatppuccinPalette;
  /** Two-digit hex alpha appended to the palette colour, e.g. "80". */
  readonly alpha?: string;
}

interface CatppuccinTokenRule {
  readonly token: string;
  readonly color: keyof CatppuccinPalette;
  readonly fontStyle?: MonacoTokenRule["fontStyle"];
}

/*
 * Official Catppuccin palettes, https://github.com/catppuccin/catppuccin.
 * Keep the leading "#" here: colours handed to Monaco's theme `colors` record
 * need it, while token rules need the bare six-digit form.
 */
const CATPPUCCIN_PALETTES = {
  latte: {
    rosewater: "#dc8a78",
    flamingo: "#dd7878",
    pink: "#ea76cb",
    mauve: "#8839ef",
    red: "#d20f39",
    maroon: "#e64553",
    peach: "#fe640b",
    yellow: "#df8e1d",
    green: "#40a02b",
    teal: "#179299",
    sky: "#04a5e5",
    sapphire: "#209fb5",
    blue: "#1e66f5",
    lavender: "#7287fd",
    text: "#4c4f69",
    subtext1: "#5c5f77",
    subtext0: "#6c6f85",
    overlay2: "#7c7f93",
    overlay1: "#8c8fa1",
    overlay0: "#9ca0b0",
    surface2: "#acb0be",
    surface1: "#bcc0cc",
    surface0: "#ccd0da",
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8"
  },
  frappe: {
    rosewater: "#f2d5cf",
    flamingo: "#eebebe",
    pink: "#f4b8e4",
    mauve: "#ca9ee6",
    red: "#e78284",
    maroon: "#ea999c",
    peach: "#ef9f76",
    yellow: "#e5c890",
    green: "#a6d189",
    teal: "#81c8be",
    sky: "#99d1db",
    sapphire: "#85c1dc",
    blue: "#8caaee",
    lavender: "#babbf1",
    text: "#c6d0f5",
    subtext1: "#b5bfe2",
    subtext0: "#a5adce",
    overlay2: "#949cbb",
    overlay1: "#838ba7",
    overlay0: "#737994",
    surface2: "#626880",
    surface1: "#51576d",
    surface0: "#414559",
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634"
  },
  macchiato: {
    rosewater: "#f4dbd6",
    flamingo: "#f0c6c6",
    pink: "#f5bde6",
    mauve: "#c6a0f6",
    red: "#ed8796",
    maroon: "#ee99a0",
    peach: "#f5a97f",
    yellow: "#eed49f",
    green: "#a6da95",
    teal: "#8bd5ca",
    sky: "#91d7e3",
    sapphire: "#7dc4e4",
    blue: "#8aadf4",
    lavender: "#b7bdf8",
    text: "#cad3f5",
    subtext1: "#b8c0e0",
    subtext0: "#a5adcb",
    overlay2: "#939ab7",
    overlay1: "#8087a2",
    overlay0: "#6e738d",
    surface2: "#5b6078",
    surface1: "#494d64",
    surface0: "#363a4f",
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926"
  },
  mocha: {
    rosewater: "#f5e0dc",
    flamingo: "#f2cdcd",
    pink: "#f5c2e7",
    mauve: "#cba6f7",
    red: "#f38ba8",
    maroon: "#eba0ac",
    peach: "#fab387",
    yellow: "#f9e2af",
    green: "#a6e3a1",
    teal: "#94e2d5",
    sky: "#89dceb",
    sapphire: "#74c7ec",
    blue: "#89b4fa",
    lavender: "#b4befe",
    text: "#cdd6f4",
    subtext1: "#bac2de",
    subtext0: "#a6adc8",
    overlay2: "#9399b2",
    overlay1: "#7f849c",
    overlay0: "#6c7086",
    surface2: "#585b70",
    surface1: "#45475a",
    surface0: "#313244",
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b"
  }
} as const satisfies Readonly<Record<CatppuccinVariant, CatppuccinPalette>>;

/*
 * Official Catppuccin for VSCode UI colours, generated from the released
 * v3.19.0 theme JSON at the revision documented in the module header. Values
 * are palette entries plus the official eight-digit alpha suffix; keeping the
 * palette reference (instead of repeating four literals) makes it possible to
 * audit a variant against the upstream palette at a glance.
 *
 * Keys that Monaco does not render (editor groups, marker navigation, the
 * workbench menu bar, and sticky-scroll hover) are intentionally omitted.
 */
interface CatppuccinUiColor {
  readonly key: string;
  readonly color: keyof CatppuccinPalette;
  readonly alpha?: string;
}

const CATPPUCCIN_UI_COLORS: readonly CatppuccinUiColor[] = [
  // Core editor, selection, find, and highlight colours
  { key: "editor.background", color: "base" },
  { key: "editor.findMatchBorder", color: "red", alpha: "33" },
  { key: "editor.findMatchHighlightBorder", color: "sky", alpha: "33" },
  { key: "editor.findRangeHighlightBorder", color: "sky", alpha: "33" },
  { key: "editor.foldBackground", color: "sky", alpha: "40" },
  { key: "editor.foreground", color: "text" },
  { key: "editor.hoverHighlightBackground", color: "sky", alpha: "40" },
  { key: "editor.lineHighlightBackground", color: "text", alpha: "12" },
  { key: "editor.rangeHighlightBackground", color: "sky", alpha: "40" },
  { key: "editor.selectionHighlightBackground", color: "overlay2", alpha: "33" },
  { key: "editor.selectionHighlightBorder", color: "overlay2", alpha: "33" },
  { key: "editor.wordHighlightBackground", color: "overlay2", alpha: "33" },

  // Cursor, whitespace, and indentation guides
  { key: "editorIndentGuide.background1", color: "surface1" },
  { key: "editorIndentGuide.activeBackground1", color: "surface2" },
  { key: "editorCursor.background", color: "base" },
  { key: "editorCursor.foreground", color: "rosewater" },
  { key: "editorIndentGuide.activeBackground", color: "surface2" },
  { key: "editorIndentGuide.background", color: "surface1" },
  { key: "editorWhitespace.foreground", color: "overlay2", alpha: "66" },

  // Bracket matching and colourisation
  { key: "editorBracketMatch.background", color: "overlay2", alpha: "1a" },
  { key: "editorBracketMatch.border", color: "overlay2" },
  { key: "editorBracketHighlight.foreground1", color: "red" },
  { key: "editorBracketHighlight.foreground2", color: "peach" },
  { key: "editorBracketHighlight.foreground3", color: "yellow" },
  { key: "editorBracketHighlight.foreground4", color: "green" },
  { key: "editorBracketHighlight.foreground5", color: "sapphire" },
  { key: "editorBracketHighlight.foreground6", color: "mauve" },
  { key: "editorBracketHighlight.unexpectedBracket.foreground", color: "maroon" },

  // Line numbers, rulers, and gutter
  { key: "editorGutter.addedBackground", color: "green" },
  { key: "editorGutter.background", color: "base" },
  { key: "editorGutter.commentRangeForeground", color: "surface0" },
  { key: "editorGutter.commentGlyphForeground", color: "mauve" },
  { key: "editorGutter.deletedBackground", color: "red" },
  { key: "editorGutter.foldingControlForeground", color: "overlay2" },
  { key: "editorGutter.modifiedBackground", color: "yellow" },
  { key: "editorLineNumber.activeForeground", color: "mauve" },
  { key: "editorLineNumber.foreground", color: "overlay1" },
  { key: "editorOverviewRuler.background", color: "mantle" },
  { key: "editorOverviewRuler.border", color: "text", alpha: "12" },
  { key: "editorOverviewRuler.modifiedForeground", color: "yellow" },
  { key: "editorRuler.foreground", color: "surface2" },

  // Diagnostics, links, code lens, inlay hints, and debug highlights
  { key: "editorCodeLens.foreground", color: "overlay1" },
  { key: "editorInlayHint.foreground", color: "surface2" },
  { key: "editorInlayHint.background", color: "mantle", alpha: "bf" },
  { key: "editorInlayHint.typeForeground", color: "subtext1" },
  { key: "editorInlayHint.typeBackground", color: "mantle", alpha: "bf" },
  { key: "editorInlayHint.parameterForeground", color: "subtext0" },
  { key: "editorInlayHint.parameterBackground", color: "mantle", alpha: "bf" },
  { key: "editorLink.activeForeground", color: "mauve" },
  { key: "editor.stackFrameHighlightBackground", color: "yellow", alpha: "26" },
  { key: "editor.focusedStackFrameHighlightBackground", color: "green", alpha: "26" },
  { key: "editorLightBulb.foreground", color: "yellow" },
  { key: "editorError.foreground", color: "red" },
  { key: "editorWarning.foreground", color: "peach" },
  { key: "editorInfo.foreground", color: "blue" },

  // Editor widgets
  { key: "widget.shadow", color: "mantle", alpha: "80" },
  { key: "editorHoverWidget.background", color: "mantle" },
  { key: "editorHoverWidget.border", color: "surface2" },
  { key: "editorHoverWidget.foreground", color: "text" },
  { key: "editorSuggestWidget.background", color: "mantle" },
  { key: "editorSuggestWidget.border", color: "surface2" },
  { key: "editorSuggestWidget.foreground", color: "text" },
  { key: "editorSuggestWidget.highlightForeground", color: "mauve" },
  { key: "editorSuggestWidget.selectedBackground", color: "surface0" },
  // The extension omits editorWidget.border; use the surface2 border shared
  // by editorHoverWidget and editorSuggestWidget.
  { key: "editorWidget.border", color: "surface2" },
  { key: "editorWidget.background", color: "mantle" },
  { key: "editorWidget.foreground", color: "text" },
  { key: "editorWidget.resizeBorder", color: "surface2" },

  // Context menu and quick input. The extension omits menu.shadowColor and
  // quickInput.*; those use the official palette and the same surface values
  // as their official widget/list siblings. menu.border is the opaque
  // surface2 border from the extension's extraBordersEnabled option.
  { key: "menu.border", color: "surface2" },
  { key: "menu.shadowColor", color: "crust" },
  { key: "quickInput.background", color: "mantle" },
  { key: "quickInput.foreground", color: "text" },
  { key: "quickInput.border", color: "surface2" },
  { key: "quickInputList.focusBackground", color: "surface0" },
  { key: "quickInputList.focusForeground", color: "text" },
  { key: "menu.background", color: "base" },
  { key: "menu.foreground", color: "text" },
  { key: "menu.selectionBackground", color: "surface2" },
  { key: "menu.selectionForeground", color: "text" },
  { key: "menu.separatorBackground", color: "surface2" },

  // Lists and filter widgets
  { key: "list.activeSelectionBackground", color: "surface0" },
  { key: "list.activeSelectionForeground", color: "text" },
  { key: "list.dropBackground", color: "mauve", alpha: "33" },
  { key: "list.focusBackground", color: "surface0" },
  { key: "list.focusForeground", color: "text" },
  { key: "list.highlightForeground", color: "mauve" },
  { key: "list.hoverBackground", color: "surface0", alpha: "80" },
  { key: "list.hoverForeground", color: "text" },
  { key: "list.inactiveSelectionBackground", color: "surface0" },
  { key: "list.inactiveSelectionForeground", color: "text" },
  { key: "list.warningForeground", color: "peach" },
  { key: "listFilterWidget.background", color: "surface1" },
  { key: "listFilterWidget.noMatchesOutline", color: "red" },
  { key: "list.focusAndSelectionBackground", color: "surface1" },

  // Scrollbars
  { key: "scrollbar.shadow", color: "crust" },
  { key: "scrollbarSlider.activeBackground", color: "surface0", alpha: "66" },
  { key: "scrollbarSlider.background", color: "surface2", alpha: "80" },
  { key: "scrollbarSlider.hoverBackground", color: "overlay0" },

  // Minimap
  { key: "minimap.background", color: "mantle", alpha: "80" },
  { key: "minimap.findMatchHighlight", color: "sky", alpha: "4d" },
  { key: "minimap.selectionHighlight", color: "surface2", alpha: "bf" },
  { key: "minimap.selectionOccurrenceHighlight", color: "surface2", alpha: "bf" },
  { key: "minimap.warningHighlight", color: "peach", alpha: "bf" },
  { key: "minimap.errorHighlight", color: "red", alpha: "bf" },
  { key: "minimapSlider.background", color: "mauve", alpha: "33" },
  { key: "minimapSlider.hoverBackground", color: "mauve", alpha: "66" },
  { key: "minimapSlider.activeBackground", color: "mauve", alpha: "99" },
  { key: "minimapGutter.addedBackground", color: "green", alpha: "bf" },
  { key: "minimapGutter.deletedBackground", color: "red", alpha: "bf" },
  { key: "minimapGutter.modifiedBackground", color: "yellow", alpha: "bf" }
] as const satisfies readonly CatppuccinColorRule[];

/*
 * Official transparent UI colours (the extension registers these as
 * #00000000 rather than as palette entries).
 */
const CATPPUCCIN_UI_LITERALS = {
  "editor.lineHighlightBorder": "#00000000",
  "editor.rangeHighlightBorder": "#00000000",
  "editorError.background": "#00000000",
  "editorError.border": "#00000000",
  "editorWarning.background": "#00000000",
  "editorWarning.border": "#00000000",
  "editorInfo.background": "#00000000",
  "editorInfo.border": "#00000000",
  "menu.selectionBorder": "#00000000",
  "list.focusOutline": "#00000000",
  "listFilterWidget.outline": "#00000000"
} as const satisfies Readonly<Record<string, string>>;

/*
 * Values that the upstream theme generates by blending rather than by
 * selecting a palette colour, plus the per-variant alpha of the selection
 * colours. They are copied verbatim from the released theme JSON.
 */
const CATPPUCCIN_UI_BLENDS = {
  latte: {
    "editor.findMatchBackground": "#e6adbd",
    "editor.findMatchHighlightBackground": "#a9daf0",
    "editor.findRangeHighlightBackground": "#a9daf0",
    "editor.selectionBackground": "#7c7f934d",
    "editor.wordHighlightStrongBackground": "#1e66f526"
  },
  frappe: {
    "editor.findMatchBackground": "#674b59",
    "editor.findMatchHighlightBackground": "#506373",
    "editor.findRangeHighlightBackground": "#506373",
    "editor.selectionBackground": "#949cbb40",
    "editor.wordHighlightStrongBackground": "#8caaee33"
  },
  macchiato: {
    "editor.findMatchBackground": "#604456",
    "editor.findMatchHighlightBackground": "#455c6d",
    "editor.findRangeHighlightBackground": "#455c6d",
    "editor.selectionBackground": "#939ab740",
    "editor.wordHighlightStrongBackground": "#8aadf433"
  },
  mocha: {
    "editor.findMatchBackground": "#5e3f53",
    "editor.findMatchHighlightBackground": "#3e5767",
    "editor.findRangeHighlightBackground": "#3e5767",
    "editor.selectionBackground": "#9399b240",
    "editor.wordHighlightStrongBackground": "#89b4fa33"
  }
} as const satisfies Readonly<
  Record<CatppuccinVariant, Readonly<Record<string, string>>>
>;

/*
 * TextMate scope -> Monaco token projection used by the official theme:
 *   comment   <- comment (italic)
 *   keyword   <- keyword
 *   string    <- string
 *   number    <- constant.numeric
 *   constant  <- Booleans, constants, numbers (same rule as number)
 *   type      <- Types (italic)
 *   class     <- Classes (italic)
 *   function  <- entity.name.function (italic)
 *   variable  <- Basic text & variable names
 *   operator  <- keyword.operator
 *   delimiter <- punctuation
 *   regexp    <- "Regex regular string match"
 *   tag       <- entity.name.tag
 *   attribute <- entity.other.attribute-name
 */
interface CatppuccinTokenColor {
  readonly token: string;
  readonly color: keyof CatppuccinPalette;
  readonly fontStyle?: MonacoTokenRule["fontStyle"];
}

const CATPPUCCIN_TOKEN_COLORS: readonly CatppuccinTokenColor[] = [
  { token: "comment", color: "overlay2", fontStyle: "italic" },
  { token: "keyword", color: "mauve" },
  { token: "string", color: "green" },
  { token: "number", color: "peach" },
  { token: "constant", color: "peach" },
  { token: "type", color: "yellow", fontStyle: "italic" },
  { token: "class", color: "yellow", fontStyle: "italic" },
  { token: "function", color: "blue", fontStyle: "italic" },
  { token: "variable", color: "text" },
  { token: "operator", color: "teal" },
  { token: "delimiter", color: "overlay2" },
  { token: "regexp", color: "text" },
  { token: "tag", color: "blue" },
  { token: "attribute", color: "yellow" }
] as const satisfies readonly CatppuccinTokenRule[];

/*
 * Classic VS Code themes. Core colours are the resolved official values;
 * token rules are normalised to Monaco's fourteen syntax buckets. Where a
 * theme does not define one of those buckets, the nearest official rule is
 * used (for example Monokai's "variable" default, or Red's "constant" for
 * numeric literals).
 */
const VSCODE_THEME_DATA: Readonly<
  Record<VscodeThemeVariant, VscodeThemeDefinition>
> = {
  monokai: {
    palette: {
      background: "#272822",
      foreground: "#f8f8f2",
      selection: "#878b9180",
      selectionHighlight: "#575b6180",
      lineHighlight: "#3e3d32",
      lineNumber: "#90908a",
      lineNumberActive: "#c2c2bf",
      cursor: "#f8f8f0",
      widgetBackground: "#1e1f1c",
      widgetBorder: "#75715e",
      accent: "#66d9ef",
      added: "#a6e22e",
      deleted: "#f92672",
      error: "#f92672",
      warning: "#e6db74",
      info: "#66d9ef",
      hint: "#75715e",
      minimapSelection: "#878b9180"
    },
    rules: [
      rule("comment", "#88846f"),
      rule("keyword", "#f92672"),
      rule("string", "#e6db74"),
      rule("number", "#ae81ff"),
      rule("constant", "#ae81ff"),
      rule("type", "#a6e22e", "underline"),
      rule("class", "#a6e22e", "underline"),
      rule("function", "#a6e22e"),
      rule("variable", "#f8f8f2"),
      rule("operator", "#f92672"),
      rule("delimiter", "#f8f8f2"),
      rule("regexp", "#e6db74"),
      rule("tag", "#f92672"),
      rule("attribute", "#a6e22e")
    ]
  },
  "solarized-dark": {
    palette: {
      background: "#002b36",
      foreground: "#839496",
      selection: "#274642",
      selectionHighlight: "#005a6faa",
      lineHighlight: "#073642",
      lineNumber: "#586e75",
      lineNumberActive: "#949494",
      cursor: "#d30102",
      widgetBackground: "#00212b",
      widgetBorder: "#073642",
      accent: "#268bd2",
      added: "#859900",
      deleted: "#dc322f",
      error: "#dc322f",
      warning: "#b58900",
      info: "#268bd2",
      hint: "#2aa198",
      minimapSelection: "#274642"
    },
    rules: [
      rule("comment", "#586e75", "italic"),
      rule("keyword", "#859900"),
      rule("string", "#2aa198"),
      rule("number", "#d33682"),
      rule("constant", "#b58900"),
      rule("type", "#cb4b16"),
      rule("class", "#cb4b16"),
      rule("function", "#268bd2"),
      rule("variable", "#268bd2"),
      rule("operator", "#859900"),
      rule("delimiter", "#839496"),
      rule("regexp", "#dc322f"),
      rule("tag", "#268bd2"),
      rule("attribute", "#93a1a1")
    ]
  },
  "solarized-light": {
    palette: {
      background: "#fdf6e3",
      foreground: "#657b83",
      selection: "#eee8d5",
      lineHighlight: "#eee8d5",
      lineNumber: "#93a1a1",
      lineNumberActive: "#567983",
      cursor: "#657b83",
      widgetBackground: "#eee8d5",
      widgetBorder: "#93a1a1",
      accent: "#268bd2",
      added: "#859900",
      deleted: "#dc322f",
      error: "#dc322f",
      warning: "#b58900",
      info: "#268bd2",
      hint: "#2aa198",
      minimapSelection: "#eee8d5"
    },
    rules: [
      rule("comment", "#93a1a1", "italic"),
      rule("keyword", "#859900"),
      rule("string", "#2aa198"),
      rule("number", "#d33682"),
      rule("constant", "#b58900"),
      rule("type", "#cb4b16"),
      rule("class", "#cb4b16"),
      rule("function", "#268bd2"),
      rule("variable", "#268bd2"),
      rule("operator", "#859900"),
      rule("delimiter", "#657b83"),
      rule("regexp", "#dc322f"),
      rule("tag", "#268bd2"),
      rule("attribute", "#93a1a1")
    ]
  },
  abyss: {
    palette: {
      background: "#000c18",
      foreground: "#6688cc",
      selection: "#770811",
      lineHighlight: "#082050",
      lineNumber: "#406385",
      lineNumberActive: "#80a2c2",
      cursor: "#ddbb88",
      widgetBackground: "#262641",
      widgetBorder: "#004c18",
      accent: "#0063a5",
      added: "#22aa44",
      deleted: "#f280d0",
      error: "#f280d0",
      warning: "#ffeebb",
      info: "#22aa44",
      hint: "#225588",
      scrollbar: "#1f2230aa",
      scrollbarHover: "#3b3f5188",
      scrollbarActive: "#3b3f5188",
      minimapSelection: "#750000",
      minimapFind: "#eeeeee44"
    },
    rules: [
      rule("comment", "#384887"),
      rule("keyword", "#225588"),
      rule("string", "#22aa44"),
      rule("number", "#f280d0"),
      rule("constant", "#f280d0"),
      rule("type", "#ffeebb", "underline"),
      rule("class", "#ffeebb", "underline"),
      rule("function", "#ddbb88"),
      rule("variable", "#6688cc"),
      rule("operator", "#225588"),
      rule("delimiter", "#6688cc"),
      rule("regexp", "#22aa44"),
      rule("tag", "#225588"),
      rule("attribute", "#ddbb88")
    ]
  },
  "kimbie-dark": {
    palette: {
      background: "#221a0f",
      foreground: "#d3af86",
      selection: "#84613daa",
      lineHighlight: "#5e452b",
      lineNumber: "#a57a4c",
      lineNumberActive: "#adadad",
      cursor: "#d3af86",
      widgetBackground: "#131510",
      widgetBorder: "#5e452b",
      accent: "#8ab1b0",
      added: "#889b4a",
      deleted: "#dc3958",
      error: "#dc3958",
      warning: "#f79a32",
      info: "#8ab1b0",
      hint: "#a57a4c",
      minimapSelection: "#84613daa"
    },
    rules: [
      rule("comment", "#a57a4c"),
      rule("keyword", "#98676a"),
      rule("string", "#889b4a"),
      rule("number", "#f79a32"),
      rule("constant", "#f79a32"),
      rule("type", "#f06431"),
      rule("class", "#f06431"),
      rule("function", "#8ab1b0"),
      rule("variable", "#dc3958"),
      rule("operator", "#d3af86"),
      rule("delimiter", "#d3af86"),
      rule("regexp", "#7e602c"),
      rule("tag", "#dc3958"),
      rule("attribute", "#f79a32")
    ]
  },
  "quiet-light": {
    palette: {
      background: "#f5f5f5",
      // The source JSON omits editor.foreground; its scopeless token rule
      // supplies #333333 as the theme's default text colour.
      foreground: "#333333",
      selection: "#c9d0d9",
      lineHighlight: "#e4f6d4",
      lineNumber: "#6d705b",
      lineNumberActive: "#9769dc",
      cursor: "#54494b",
      widgetBackground: "#f5f5f5",
      widgetBorder: "#aaaaaa",
      accent: "#4b69c6",
      added: "#448c27",
      deleted: "#aa3731",
      error: "#cd3131",
      warning: "#9c5d27",
      info: "#4b69c6",
      hint: "#7a3e9d",
      minimapSelection: "#c9d0d9",
      minimapFind: "#bf9cac"
    },
    rules: [
      rule("comment", "#aaaaaa", "italic"),
      rule("keyword", "#4b69c6"),
      rule("string", "#448c27"),
      rule("number", "#9c5d27"),
      rule("constant", "#9c5d27"),
      rule("type", "#7a3e9d", "bold"),
      rule("class", "#7a3e9d", "bold"),
      rule("function", "#aa3731", "bold"),
      rule("variable", "#7a3e9d"),
      rule("operator", "#777777"),
      rule("delimiter", "#777777"),
      rule("regexp", "#4b69c6"),
      rule("tag", "#4b69c6"),
      rule("attribute", "#4b69c6")
    ]
  },
  "tomorrow-night-blue": {
    palette: {
      background: "#002451",
      foreground: "#ffffff",
      selection: "#003f8e",
      lineHighlight: "#00346e",
      lineNumber: "#7285b7",
      lineNumberActive: "#949494",
      cursor: "#ffffff",
      widgetBackground: "#001c40",
      widgetBorder: "#ffffff44",
      accent: "#bbdaff",
      added: "#d1f1a9",
      deleted: "#ff9da4",
      error: "#ff9da4",
      warning: "#ffc58f",
      info: "#99ffff",
      hint: "#7285b7",
      minimapSelection: "#003f8e"
    },
    rules: [
      rule("comment", "#7285b7"),
      rule("keyword", "#ebbbff"),
      rule("string", "#d1f1a9"),
      rule("number", "#ffc58f"),
      rule("constant", "#ffc58f"),
      rule("type", "#ffeead"),
      rule("class", "#ffeead"),
      rule("function", "#bbdaff"),
      rule("variable", "#ff9da4"),
      rule("operator", "#99ffff"),
      rule("delimiter", "#ffffff"),
      rule("regexp", "#ff9da4"),
      rule("tag", "#ff9da4"),
      rule("attribute", "#ff9da4")
    ]
  },
  red: {
    palette: {
      background: "#390000",
      foreground: "#f8f8f8",
      selection: "#750000",
      selectionHighlight: "#f5500039",
      lineHighlight: "#ff000033",
      lineNumber: "#ff777788",
      lineNumberActive: "#ffbbbb88",
      cursor: "#970000",
      widgetBackground: "#300000",
      widgetBorder: "#220000",
      accent: "#ffd0aa",
      added: "#41a83e",
      deleted: "#ec0d1e",
      error: "#f12727",
      warning: "#fec758",
      info: "#ffb454",
      hint: "#e7c0c0",
      minimapSelection: "#750000"
    },
    rules: [
      rule("comment", "#e7c0c0", "italic"),
      rule("keyword", "#f12727"),
      rule("string", "#cd8d8d"),
      rule("number", "#994646"),
      rule("constant", "#994646"),
      rule("type", "#fec758"),
      rule("class", "#fec758"),
      rule("function", "#ffb454"),
      rule("variable", "#fb9a4b", "italic"),
      rule("operator", "#f12727"),
      rule("delimiter", "#f8f8f8"),
      rule("regexp", "#ffb454"),
      rule("tag", "#ec0d1e"),
      rule("attribute", "#fec758")
    ]
  },
  "dark-modern": {
    palette: {
      background: "#1f1f1f",
      foreground: "#cccccc",
      // Selection, line highlight, and cursor are not in dark_modern.json;
      // these are the dark workbench defaults VS Code applies over the
      // dark_plus/dark_vs base themes.
      selection: "#264f78",
      inactiveSelection: "#3a3d41",
      selectionHighlight: "#add6ff26",
      lineHighlight: "#2a2d2e",
      lineNumber: "#6e7681",
      lineNumberActive: "#cccccc",
      cursor: "#aeafad",
      widgetBackground: "#202020",
      widgetBorder: "#2b2b2b",
      accent: "#0078d4",
      added: "#2ea043",
      deleted: "#f85149",
      error: "#f85149",
      warning: "#cca700",
      info: "#3794ff",
      hint: "#6a9955",
      minimapSelection: "#264f78"
    },
    rules: [
      rule("comment", "#6a9955"),
      rule("keyword", "#569cd6"),
      rule("string", "#ce9178"),
      rule("number", "#b5cea8"),
      rule("constant", "#569cd6"),
      rule("type", "#4ec9b0"),
      rule("class", "#4ec9b0"),
      rule("function", "#dcdcaa"),
      rule("variable", "#9cdcfe"),
      rule("operator", "#d4d4d4"),
      rule("delimiter", "#d4d4d4"),
      rule("regexp", "#d16969"),
      rule("tag", "#569cd6"),
      rule("attribute", "#9cdcfe")
    ]
  },
  "light-modern": {
    palette: {
      background: "#ffffff",
      foreground: "#3b3b3b",
      // Selection, line highlight, and cursor come from the light workbench
      // defaults because light_modern.json only overrides the Modern chrome.
      selection: "#add6ff",
      inactiveSelection: "#e5ebf1",
      selectionHighlight: "#add6ff80",
      lineHighlight: "#f3f3f3",
      lineNumber: "#6e7681",
      lineNumberActive: "#171184",
      cursor: "#000000",
      widgetBackground: "#f8f8f8",
      widgetBorder: "#e5e5e5",
      accent: "#005fb8",
      added: "#2ea043",
      deleted: "#f85149",
      error: "#f85149",
      warning: "#bf8803",
      info: "#005fb8",
      hint: "#008000",
      minimapSelection: "#add6ff"
    },
    rules: [
      rule("comment", "#008000"),
      rule("keyword", "#0000ff"),
      rule("string", "#a31515"),
      rule("number", "#098658"),
      rule("constant", "#0000ff"),
      rule("type", "#267f99"),
      rule("class", "#267f99"),
      rule("function", "#795e26"),
      rule("variable", "#001080"),
      rule("operator", "#000000"),
      rule("delimiter", "#000000"),
      rule("regexp", "#811f3f"),
      rule("tag", "#800000"),
      rule("attribute", "#e50000")
    ]
  }
};

const VSCODE_THEMES: readonly VscodeThemeOption[] = Object.freeze([
  {
    id: "vscode-monokai",
    label: "Monokai",
    group: "vscode",
    base: "vs-dark",
    variant: "monokai"
  },
  {
    id: "vscode-solarized-dark",
    label: "Solarized Dark",
    group: "vscode",
    base: "vs-dark",
    variant: "solarized-dark"
  },
  {
    id: "vscode-solarized-light",
    label: "Solarized Light",
    group: "vscode",
    base: "vs",
    variant: "solarized-light"
  },
  {
    id: "vscode-abyss",
    label: "Abyss",
    group: "vscode",
    base: "vs-dark",
    variant: "abyss"
  },
  {
    id: "vscode-kimbie-dark",
    label: "Kimbie Dark",
    group: "vscode",
    base: "vs-dark",
    variant: "kimbie-dark"
  },
  {
    id: "vscode-quiet-light",
    label: "Quiet Light",
    group: "vscode",
    base: "vs",
    variant: "quiet-light"
  },
  {
    id: "vscode-tomorrow-night-blue",
    label: "Tomorrow Night Blue",
    group: "vscode",
    base: "vs-dark",
    variant: "tomorrow-night-blue"
  },
  {
    id: "vscode-red",
    label: "Red",
    group: "vscode",
    base: "vs-dark",
    variant: "red"
  },
  {
    id: "vscode-dark-modern",
    label: "Dark Modern",
    group: "vscode",
    base: "vs-dark",
    variant: "dark-modern"
  },
  {
    id: "vscode-light-modern",
    label: "Light Modern",
    group: "vscode",
    base: "vs",
    variant: "light-modern"
  }
]);

const BUILTIN_EDITOR_THEMES: readonly EditorThemeOption[] = Object.freeze([
  { id: "vs", label: "Visual Studio Light", group: "vscode", base: "vs" },
  { id: "vs-dark", label: "Visual Studio Dark", group: "vscode", base: "vs-dark" },
  { id: "hc-black", label: "High Contrast Dark", group: "vscode", base: "hc-black" },
  { id: "hc-light", label: "High Contrast Light", group: "vscode", base: "hc-light" }
]);

const CATPPUCCIN_THEMES: readonly CatppuccinThemeOption[] = Object.freeze([
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    group: "catppuccin",
    base: "vs",
    variant: "latte"
  },
  {
    id: "catppuccin-frappe",
    label: "Catppuccin Frappé",
    group: "catppuccin",
    base: "vs-dark",
    variant: "frappe"
  },
  {
    id: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    group: "catppuccin",
    base: "vs-dark",
    variant: "macchiato"
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    group: "catppuccin",
    base: "vs-dark",
    variant: "mocha"
  }
]);

export const EDITOR_THEMES: readonly EditorThemeOption[] = Object.freeze([
  ...BUILTIN_EDITOR_THEMES,
  ...VSCODE_THEMES,
  ...CATPPUCCIN_THEMES
]);

export const DEFAULT_EDITOR_THEME_ID = "vs-dark";

const EDITOR_THEME_IDS: ReadonlySet<string> = new Set(
  EDITOR_THEMES.map((theme) => theme.id)
);

export function isEditorThemeId(value: unknown): value is string {
  return typeof value === "string" && EDITOR_THEME_IDS.has(value);
}

/** Dark/light frame implied by the editor theme's base. */
export function editorThemeTone(value: unknown): "light" | "dark" {
  if (typeof value === "string") {
    const theme = EDITOR_THEMES.find((candidate) => candidate.id === value);
    if (theme) {
      return theme.base === "vs" || theme.base === "hc-light"
        ? "light"
        : "dark";
    }
  }
  return "dark";
}

const NATIVE_THEME_PRIMARY: Readonly<Record<string, string>> = {
  vs: "#0078d4",
  "vs-dark": "#007acc",
  "hc-black": "#3794ff",
  "hc-light": "#005fb8"
};

const EDITOR_THEME_PRIMARY = new Map<string, string>();
for (const theme of EDITOR_THEMES) {
  if (Object.prototype.hasOwnProperty.call(NATIVE_THEME_PRIMARY, theme.id)) {
    EDITOR_THEME_PRIMARY.set(theme.id, NATIVE_THEME_PRIMARY[theme.id]!);
    continue;
  }
  if (theme.group === "vscode" && "variant" in theme) {
    EDITOR_THEME_PRIMARY.set(
      theme.id,
      VSCODE_THEME_DATA[(theme as VscodeThemeOption).variant].palette.accent
    );
    continue;
  }
  if (theme.group === "catppuccin" && "variant" in theme) {
    const variant = (theme as CatppuccinThemeOption).variant;
    EDITOR_THEME_PRIMARY.set(theme.id, CATPPUCCIN_PALETTES[variant].mauve);
  }
}

/** The principal UI colour contributed by an editor theme. */
export function editorThemePrimaryColor(value: unknown): string | null {
  return typeof value === "string"
    ? EDITOR_THEME_PRIMARY.get(value) ?? null
    : null;
}

function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  // Ignore a pre-existing alpha pair so official eight-digit colours can be
  // re-used (for example Red's translucent line numbers).
  return `${hex.slice(0, 7)}${channel}`;
}

function tokenColor(hex: string): string {
  return hex.slice(1);
}

function rule(
  token: string,
  hex: string,
  fontStyle?: MonacoTokenRule["fontStyle"]
): MonacoTokenRule {
  return fontStyle
    ? { token, foreground: tokenColor(hex), fontStyle }
    : { token, foreground: tokenColor(hex) };
}

function buildCatppuccinTheme(
  variant: CatppuccinVariant,
  palette: CatppuccinPalette,
  base: EditorThemeBase
): MonacoThemeData {
  const rules: MonacoTokenRule[] = CATPPUCCIN_TOKEN_COLORS.map(
    ({ token, color, fontStyle }) => {
      const foreground = tokenColor(palette[color]);
      return fontStyle
        ? { token, foreground, fontStyle }
        : { token, foreground };
    }
  );

  const colors: Record<string, string> = { ...CATPPUCCIN_UI_LITERALS };
  for (const { key, color, alpha } of CATPPUCCIN_UI_COLORS) {
    colors[key] = alpha ? `${palette[color]}${alpha}` : palette[color];
  }
  Object.assign(colors, CATPPUCCIN_UI_BLENDS[variant]);

  return { base, inherit: false, rules, colors };
}

/*
 * Monaco does not supply the workbench surfaces used by menus and quick
 * input, and a few official theme files omit editor chrome that VS Code
 * registers as a base default. The fallbacks below mirror those defaults
 * where needed and derive translucent chrome from the theme's own palette.
 */
function buildVscodeTheme(
  definition: VscodeThemeDefinition,
  base: EditorThemeBase
): MonacoThemeData {
  const { palette } = definition;
  const inactiveSelection =
    palette.inactiveSelection ?? withAlpha(palette.foreground, 0.12);
  const selectionHighlight =
    palette.selectionHighlight ?? withAlpha(palette.foreground, 0.18);
  const scrollbar =
    palette.scrollbar ?? withAlpha(palette.foreground, 0.18);
  const scrollbarHover =
    palette.scrollbarHover ?? withAlpha(palette.foreground, 0.28);
  const scrollbarActive =
    palette.scrollbarActive ?? withAlpha(palette.foreground, 0.38);
  const minimapSelection = palette.minimapSelection ?? palette.selection;
  const minimapFind =
    palette.minimapFind ?? withAlpha(palette.warning, 0.5);
  const menuShadow = withAlpha("#000000", 0.35);

  return {
    base,
    inherit: false,
    rules: definition.rules,
    colors: {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      "editor.selectionBackground": palette.selection,
      "editor.inactiveSelectionBackground": inactiveSelection,
      "editor.selectionHighlightBackground": selectionHighlight,
      "editor.selectionHighlightBorder": withAlpha(palette.accent, 0.3),
      "editor.wordHighlightBackground": withAlpha(palette.foreground, 0.12),
      "editor.wordHighlightStrongBackground": withAlpha(palette.foreground, 0.2),
      "editor.findMatchBackground": withAlpha(palette.warning, 0.4),
      "editor.findMatchHighlightBackground": withAlpha(palette.warning, 0.25),
      "editor.findRangeHighlightBackground": withAlpha(palette.foreground, 0.1),
      "editor.lineHighlightBackground": palette.lineHighlight,
      "editor.lineHighlightBorder": withAlpha(palette.background, 0),
      "editorLineNumber.foreground": palette.lineNumber,
      "editorLineNumber.activeForeground": palette.lineNumberActive,
      "editorLineNumber.dimmedForeground": withAlpha(palette.lineNumber, 0.6),
      "editorCursor.foreground": palette.cursor,
      "editorWhitespace.foreground": withAlpha(palette.foreground, 0.3),
      "editorIndentGuide.background1": withAlpha(palette.foreground, 0.2),
      "editorIndentGuide.activeBackground1": withAlpha(palette.foreground, 0.35),
      "editorBracketMatch.background": withAlpha(palette.foreground, 0.15),
      "editorBracketMatch.border": withAlpha(palette.foreground, 0.4),
      "editorBracketHighlight.foreground1": palette.accent,
      "editorBracketHighlight.foreground2": palette.warning,
      "editorBracketHighlight.foreground3": palette.added,
      "editorBracketHighlight.foreground4": palette.deleted,
      "editorBracketHighlight.foreground5": palette.info,
      "editorBracketHighlight.foreground6": palette.hint,
      "editorGutter.background": palette.background,
      "editorGutter.modifiedBackground": withAlpha(palette.accent, 0.7),
      "editorGutter.addedBackground": withAlpha(palette.added, 0.7),
      "editorGutter.deletedBackground": withAlpha(palette.deleted, 0.7),
      "editorOverviewRuler.border": withAlpha(palette.foreground, 0.2),
      "editorOverviewRuler.errorForeground": palette.error,
      "editorOverviewRuler.warningForeground": palette.warning,
      "editorOverviewRuler.infoForeground": palette.info,
      "editorError.foreground": palette.error,
      "editorWarning.foreground": palette.warning,
      "editorInfo.foreground": palette.info,
      "editorHint.foreground": palette.hint,
      "editorLink.activeForeground": palette.accent,
      "editorWidget.background": palette.widgetBackground,
      "editorWidget.foreground": palette.foreground,
      "editorWidget.border": palette.widgetBorder,
      "editorSuggestWidget.background": palette.widgetBackground,
      "editorSuggestWidget.foreground": palette.foreground,
      "editorSuggestWidget.border": palette.widgetBorder,
      "editorSuggestWidget.highlightForeground": palette.accent,
      "editorSuggestWidget.selectedBackground": withAlpha(palette.accent, 0.25),
      "editorHoverWidget.background": palette.widgetBackground,
      "editorHoverWidget.foreground": palette.foreground,
      "editorHoverWidget.border": palette.widgetBorder,
      "menu.background": palette.widgetBackground,
      "menu.foreground": palette.foreground,
      "menu.border": palette.widgetBorder,
      "menu.selectionBackground": withAlpha(palette.accent, 0.35),
      "menu.selectionForeground": palette.foreground,
      "menu.separatorBackground": palette.widgetBorder,
      "menu.shadowColor": menuShadow,
      "quickInput.background": palette.widgetBackground,
      "quickInput.foreground": palette.foreground,
      "quickInput.border": palette.widgetBorder,
      "quickInputList.focusBackground": withAlpha(palette.accent, 0.3),
      "quickInputList.focusForeground": palette.foreground,
      "list.hoverBackground": withAlpha(palette.foreground, 0.08),
      "list.activeSelectionBackground": withAlpha(palette.accent, 0.3),
      "list.activeSelectionForeground": palette.foreground,
      "list.inactiveSelectionBackground": withAlpha(palette.foreground, 0.12),
      "list.inactiveSelectionForeground": palette.foreground,
      "list.highlightForeground": palette.accent,
      "scrollbar.shadow": menuShadow,
      "scrollbarSlider.background": scrollbar,
      "scrollbarSlider.hoverBackground": scrollbarHover,
      "scrollbarSlider.activeBackground": scrollbarActive,
      "minimap.background": palette.background,
      "minimap.selectionHighlight": minimapSelection,
      "minimap.findMatchHighlight": minimapFind,
      "minimapSlider.background": withAlpha(palette.foreground, 0.15),
      "minimapSlider.hoverBackground": withAlpha(palette.foreground, 0.25),
      "minimapSlider.activeBackground": withAlpha(palette.foreground, 0.35)
    }
  };
}

const VSCODE_MONACO_THEMES: readonly {
  readonly id: string;
  readonly definition: MonacoThemeData;
}[] = Object.freeze(
  VSCODE_THEMES.map((theme) => ({
    id: theme.id,
    definition: buildVscodeTheme(
      VSCODE_THEME_DATA[theme.variant],
      theme.base
    )
  }))
);

const CATPPUCCIN_MONACO_THEMES: readonly {
  readonly id: string;
  readonly definition: MonacoThemeData;
}[] = Object.freeze(
  CATPPUCCIN_THEMES.map((theme) => ({
    id: theme.id,
    definition: buildCatppuccinTheme(
      theme.variant,
      CATPPUCCIN_PALETTES[theme.variant],
      theme.base
    )
  }))
);

const CUSTOM_MONACO_THEMES: readonly {
  readonly id: string;
  readonly definition: MonacoThemeData;
}[] = Object.freeze([...VSCODE_MONACO_THEMES, ...CATPPUCCIN_MONACO_THEMES]);

export function defineMonacoThemes(monaco: {
  editor: { defineTheme(name: string, theme: unknown): void };
}): void {
  for (const { id, definition } of CUSTOM_MONACO_THEMES) {
    monaco.editor.defineTheme(id, definition);
  }
}
