/*
 * Build-time constants and the bootstrap settings shape shared by extension
 * entries. These declarations are intentionally global: every entry is bundled
 * separately, while the final settings module will live in background/state.ts.
 */

declare const __MA_BUILD_MODE__: "bootstrap" | "production";
declare const __MA_BOOTSTRAP__: boolean;
declare const __MA_BUILD_VERSION__: string;

type MaBackendChoice = "wasm" | "native";
type MaSiteBackend = MaBackendChoice | "site";
type MaTheme = "system" | "light" | "dark";
type MaLocale = "auto" | "zh-CN" | "en";

interface MaSettings {
  backend: MaBackendChoice | null;
  siteBackends: Record<string, MaSiteBackend>;
  theme: MaTheme;
  locale: MaLocale;
  hiddenPauseMs: number;
  clangdPath?: string;
  queryDriverAllowlist: string[];
  extraIncludeDirs: string[];
  editorFontFamily: string;
  editorTheme: string;
  onboardingComplete: boolean;
}

interface MaBuildInfo {
  mode: "bootstrap" | "production";
  version: string;
}
