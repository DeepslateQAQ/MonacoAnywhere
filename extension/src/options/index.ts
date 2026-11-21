/*
 * Bootstrap options page.
 *
 * Preferences are stored locally under settings:v1. There is no fake clangd
 * detection or validation: the current build has no engine or native host.
 * The page preserves onboardingComplete and never invents a successful check.
 */

import { setLocale, t } from "../ui/i18n.js";
import { loadingIndicator, setStatus } from "../ui/primitives.js";

const SETTINGS_KEY = "settings:v1";
const MIN_PAUSE_MS = 1000;
const MAX_PAUSE_MS = 86_400_000;
const DEFAULT_SETTINGS: MaSettings = {
  backend: null,
  siteBackends: {},
  theme: "system",
  locale: "auto",
  hiddenPauseMs: 30000,
  queryDriverAllowlist: [],
  extraIncludeDirs: [],
  editorFontFamily: '"IBM Plex Mono", Consolas, monospace',
  editorTheme: "vs-dark",
  onboardingComplete: false
};

// Browser locale first, then the stored explicit preference in initialise().
setLocale("auto");

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing options element #${id}`);
  }
  return element as T;
}

async function readSettings(): Promise<MaSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value: unknown = stored[SETTINGS_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...(value as Partial<MaSettings>) };
}

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  ];
}

function showStatus(kind: "info" | "error", text: string): void {
  const node = requireElement("ma-options-status");
  setStatus(node, { kind, text });
  node.hidden = text.length === 0;
}

function backendLabel(backend: MaBackendChoice | null): string {
  if (backend === "wasm") {
    return t("options.backend.wasm");
  }
  if (backend === "native") {
    return t("options.backend.native");
  }
  return t("options.backend.none");
}

function buildModeLabel(): string {
  return t(
    __MA_BOOTSTRAP__ ? "build.mode.bootstrap" : "build.mode.production"
  );
}

function renderHeader(): void {
  requireElement("ma-build-mode").textContent = t("options.eyebrow", {
    mode: buildModeLabel()
  });
}

function applyThemePreference(theme: MaTheme): void {
  const root = document.querySelector<HTMLElement>(".ma-ui");
  if (!root) {
    return;
  }
  if (theme === "light" || theme === "dark") {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
}

function fillForm(settings: MaSettings): void {
  requireElement<HTMLSelectElement>("ma-backend").value = settings.backend ?? "";
  requireElement<HTMLSelectElement>("ma-theme").value = settings.theme;
  requireElement<HTMLSelectElement>("ma-locale").value = settings.locale;
  requireElement<HTMLInputElement>("ma-hidden-pause").value = String(
    settings.hiddenPauseMs
  );
  requireElement<HTMLInputElement>("ma-clangd-path").value =
    settings.clangdPath ?? "";
  requireElement<HTMLTextAreaElement>("ma-query-driver").value =
    settings.queryDriverAllowlist.join("\n");
  requireElement<HTMLTextAreaElement>("ma-extra-includes").value =
    settings.extraIncludeDirs.join("\n");
  requireElement<HTMLInputElement>("ma-editor-font").value =
    settings.editorFontFamily;
  requireElement<HTMLInputElement>("ma-editor-theme").value = settings.editorTheme;

  const oobe = requireElement("ma-oobe-state");
  oobe.textContent =
    settings.backend === null
      ? t("options.state.none")
      : t("options.state.backend", {
          backend: backendLabel(settings.backend),
          complete: String(settings.onboardingComplete)
        });
}

async function savePreferences(): Promise<void> {
  showStatus("info", "");

  const backendValue = requireElement<HTMLSelectElement>("ma-backend").value;
  if (backendValue !== "" && backendValue !== "wasm" && backendValue !== "native") {
    showStatus("error", t("options.error.unsupportedBackend"));
    return;
  }
  const backend: MaBackendChoice | null =
    backendValue === "wasm" || backendValue === "native" ? backendValue : null;

  const themeValue = requireElement<HTMLSelectElement>("ma-theme").value;
  const theme: MaTheme =
    themeValue === "light" || themeValue === "dark" || themeValue === "system"
      ? themeValue
      : "system";

  const localeValue = requireElement<HTMLSelectElement>("ma-locale").value;
  const locale: MaLocale =
    localeValue === "zh-CN" || localeValue === "en" || localeValue === "auto"
      ? localeValue
      : "auto";

  const hiddenPauseMs = Number.parseInt(
    requireElement<HTMLInputElement>("ma-hidden-pause").value,
    10
  );
  if (
    !Number.isInteger(hiddenPauseMs) ||
    hiddenPauseMs < MIN_PAUSE_MS ||
    hiddenPauseMs > MAX_PAUSE_MS
  ) {
    showStatus(
      "error",
      t("options.error.pauseRange", {
        min: MIN_PAUSE_MS,
        max: MAX_PAUSE_MS
      })
    );
    return;
  }

  const clangdPath = requireElement<HTMLInputElement>("ma-clangd-path").value.trim();
  const patch: Partial<MaSettings> = {
    backend,
    theme,
    locale,
    hiddenPauseMs,
    queryDriverAllowlist: parseList(
      requireElement<HTMLTextAreaElement>("ma-query-driver").value
    ),
    extraIncludeDirs: parseList(
      requireElement<HTMLTextAreaElement>("ma-extra-includes").value
    ),
    editorFontFamily:
      requireElement<HTMLInputElement>("ma-editor-font").value.trim() ||
      DEFAULT_SETTINGS.editorFontFamily,
    editorTheme:
      requireElement<HTMLInputElement>("ma-editor-theme").value.trim() ||
      DEFAULT_SETTINGS.editorTheme
  };

  try {
    const current = await readSettings();
    const next: MaSettings = { ...current, ...patch };
    if (clangdPath.length === 0) {
      delete next.clangdPath;
    } else {
      next.clangdPath = clangdPath;
    }
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    setLocale(next.locale);
    applyThemePreference(next.theme);
    renderHeader();
    fillForm(next);
    showStatus("info", t("options.info.saved"));
  } catch (error: unknown) {
    showStatus(
      "error",
      t("options.error.save", { error: String(error) })
    );
  }
}

async function openSetup(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
}

async function initialise(): Promise<void> {
  const settings = await readSettings();
  setLocale(settings.locale);
  applyThemePreference(settings.theme);

  fillForm(settings);
  renderHeader();
  requireElement("ma-extension-id").textContent = chrome.runtime.id;

  const form = requireElement<HTMLFormElement>("ma-options-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePreferences().catch((error: unknown) => {
      showStatus(
        "error",
        t("options.error.save", { error: String(error) })
      );
    });
  });

  requireElement("ma-open-setup").addEventListener("click", () => {
    void openSetup().catch((error: unknown) => {
      showStatus(
        "error",
        t("options.error.openSetup", { error: String(error) })
      );
    });
  });
}

const loadingSlot = document.getElementById("ma-options-loading");
if (loadingSlot) {
  loadingSlot.append(
    loadingIndicator({
      label: t("options.loading"),
      contained: true
    })
  );
}

void initialise()
  .catch((error: unknown) => {
    const errorNode = document.getElementById("ma-options-status");
    if (errorNode) {
      setStatus(errorNode, {
        kind: "error",
        text: t("options.error.init", { error: String(error) })
      });
      errorNode.hidden = false;
    }
  })
  .finally(() => {
    loadingSlot?.replaceChildren();
  });
