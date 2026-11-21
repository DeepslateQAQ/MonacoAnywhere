/*
 * Options page.
 *
 * All preferences go through the centralized settings module; this page keeps
 * no private settings shape. Theme and interface language persist and apply
 * immediately. No backend is validated here, and onboardingComplete is never
 * written by this page.
 */

import {
  DEFAULT_SETTINGS,
  MAX_HIDDEN_PAUSE_MS,
  MIN_HIDDEN_PAUSE_MS,
  getSettings,
  subscribeSettings,
  updateSettings,
  type BackendChoice,
  type LocalePreference,
  type Settings,
  type ThemePreference
} from "../background/state.js";
import { setLocale, t, type MessageKey } from "../ui/i18n.js";
import { loadingIndicator, setStatus } from "../ui/primitives.js";

// Localize static markup immediately; getSettings() refines this below.
setLocale("auto");

let currentSettings: Settings | null = null;

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing options element #${id}`);
  }
  return element as T;
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

function backendLabel(backend: BackendChoice | null): string {
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

function applyThemePreference(theme: ThemePreference): void {
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

function renderHeader(): void {
  requireElement("ma-build-mode").textContent = t("options.eyebrow", {
    mode: buildModeLabel()
  });
}

function renderState(settings: Settings): void {
  requireElement("ma-oobe-state").textContent =
    settings.backend === null
      ? t("options.state.none")
      : t("options.state.backend", {
          backend: backendLabel(settings.backend),
          complete: t(settings.onboardingComplete ? "common.yes" : "common.no")
        });
  requireElement("ma-site-overrides").textContent = t(
    "options.state.siteOverrides",
    { count: Object.keys(settings.siteBackends).length }
  );
}

function applyUiPreferences(settings: Settings): void {
  setLocale(settings.locale);
  applyThemePreference(settings.theme);
  renderHeader();
  renderState(settings);
}

function fillForm(settings: Settings): void {
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
  requireElement<HTMLInputElement>("ma-editor-theme").value =
    settings.editorTheme;
}

function readTheme(value: string): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function readLocale(value: string): LocalePreference {
  return value === "zh-CN" || value === "en" || value === "auto"
    ? value
    : "auto";
}

async function persistPatch(
  patch: Partial<Settings>,
  successKey: MessageKey,
  revert?: () => void
): Promise<void> {
  try {
    const next = await updateSettings(patch);
    currentSettings = next;
    applyUiPreferences(next);
    showStatus("info", t(successKey));
  } catch (error: unknown) {
    revert?.();
    showStatus(
      "error",
      t("options.error.preferenceSave", { error: String(error) })
    );
  }
}

function wireImmediatePreferences(): void {
  const themeSelect = requireElement<HTMLSelectElement>("ma-theme");
  themeSelect.addEventListener("change", () => {
    const theme = readTheme(themeSelect.value);
    void persistPatch({ theme }, "options.info.themeSaved", () => {
      themeSelect.value = currentSettings?.theme ?? "system";
    });
  });

  const localeSelect = requireElement<HTMLSelectElement>("ma-locale");
  localeSelect.addEventListener("change", () => {
    const locale = readLocale(localeSelect.value);
    void persistPatch({ locale }, "options.info.localeSaved", () => {
      localeSelect.value = currentSettings?.locale ?? "auto";
    });
  });
}

async function savePreferences(): Promise<void> {
  showStatus("info", "");

  const backendValue = requireElement<HTMLSelectElement>("ma-backend").value;
  if (
    backendValue !== "" &&
    backendValue !== "wasm" &&
    backendValue !== "native"
  ) {
    showStatus("error", t("options.error.unsupportedBackend"));
    return;
  }
  const backend: BackendChoice | null =
    backendValue === "wasm" || backendValue === "native"
      ? backendValue
      : null;

  const theme = readTheme(requireElement<HTMLSelectElement>("ma-theme").value);
  const locale = readLocale(
    requireElement<HTMLSelectElement>("ma-locale").value
  );

  const hiddenPauseMs = Number.parseInt(
    requireElement<HTMLInputElement>("ma-hidden-pause").value,
    10
  );
  if (
    !Number.isInteger(hiddenPauseMs) ||
    hiddenPauseMs < MIN_HIDDEN_PAUSE_MS ||
    hiddenPauseMs > MAX_HIDDEN_PAUSE_MS
  ) {
    showStatus(
      "error",
      t("options.error.pauseRange", {
        min: MIN_HIDDEN_PAUSE_MS,
        max: MAX_HIDDEN_PAUSE_MS
      })
    );
    return;
  }

  const clangdPath = requireElement<HTMLInputElement>(
    "ma-clangd-path"
  ).value.trim();
  const patch: Partial<Settings> = {
    backend,
    theme,
    locale,
    hiddenPauseMs,
    // Passing undefined clears the optional field in the centralized merge.
    clangdPath: clangdPath.length === 0 ? undefined : clangdPath,
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
    const wasComplete = currentSettings?.onboardingComplete === true;
    const next = await updateSettings(patch);
    currentSettings = next;
    applyUiPreferences(next);
    fillForm(next);
    showStatus(
      "info",
      t(
        wasComplete && !next.onboardingComplete
          ? "options.info.backendChanged"
          : "options.info.saved"
      )
    );
  } catch (error: unknown) {
    showStatus("error", t("options.error.save", { error: String(error) }));
  }
}

async function openSetup(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
}

function syncExternalChanges(next: Settings): void {
  currentSettings = next;
  applyUiPreferences(next);

  const backendSelect = requireElement<HTMLSelectElement>("ma-backend");
  if (document.activeElement !== backendSelect) {
    backendSelect.value = next.backend ?? "";
  }
  const themeSelect = requireElement<HTMLSelectElement>("ma-theme");
  if (document.activeElement !== themeSelect) {
    themeSelect.value = next.theme;
  }
  const localeSelect = requireElement<HTMLSelectElement>("ma-locale");
  if (document.activeElement !== localeSelect) {
    localeSelect.value = next.locale;
  }
}

async function initialise(): Promise<void> {
  currentSettings = await getSettings();
  applyUiPreferences(currentSettings);
  fillForm(currentSettings);
  requireElement("ma-extension-id").textContent = chrome.runtime.id;

  const form = requireElement<HTMLFormElement>("ma-options-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePreferences().catch((error: unknown) => {
      showStatus("error", t("options.error.save", { error: String(error) }));
    });
  });

  wireImmediatePreferences();

  requireElement("ma-open-setup").addEventListener("click", () => {
    void openSetup().catch((error: unknown) => {
      showStatus(
        "error",
        t("options.error.openSetup", { error: String(error) })
      );
    });
  });

  const unsubscribe = subscribeSettings(syncExternalChanges);
  window.addEventListener("pagehide", unsubscribe, { once: true });
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
