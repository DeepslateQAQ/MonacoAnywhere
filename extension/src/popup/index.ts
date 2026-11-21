/*
 * Bootstrap popup: read-only status plus navigation. It does not start an
 * engine, request permissions, or validate a backend.
 */

import { setLocale, t } from "../ui/i18n.js";
import { loadingIndicator, setStatus } from "../ui/primitives.js";

const SETTINGS_KEY = "settings:v1";

// Browser locale first, then the stored explicit preference in render().
setLocale("auto");

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing popup element #${id}`);
  }
  return element as T;
}

function buildModeLabel(): string {
  return t(
    __MA_BOOTSTRAP__ ? "build.mode.bootstrap" : "build.mode.production"
  );
}

function backendLabel(backend: MaBackendChoice | null): string {
  if (backend === "wasm") {
    return t("popup.backend.wasm");
  }
  if (backend === "native") {
    return t("popup.backend.native");
  }
  return t("popup.backend.none");
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

function showError(
  key:
    | "popup.error.openSetup"
    | "popup.error.openOptions"
    | "popup.error.openFixture"
    | "popup.error.init",
  error: unknown
): void {
  const node = document.getElementById("ma-popup-error");
  if (!node) {
    return;
  }
  setStatus(node, {
    kind: "error",
    text: t(key, { error: String(error) })
  });
  node.hidden = false;
}

async function render(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw: unknown = stored[SETTINGS_KEY];
  const settings: Partial<MaSettings> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Partial<MaSettings>)
      : {};

  const locale: MaLocale =
    settings.locale === "zh-CN" ||
    settings.locale === "en" ||
    settings.locale === "auto"
      ? settings.locale
      : "auto";
  const theme: MaTheme =
    settings.theme === "light" ||
    settings.theme === "dark" ||
    settings.theme === "system"
      ? settings.theme
      : "system";
  setLocale(locale);
  applyThemePreference(theme);

  const backend = settings.backend ?? null;
  requireElement("ma-popup-backend").textContent = backendLabel(backend);
  requireElement("ma-popup-oobe").textContent =
    settings.onboardingComplete === true
      ? t("popup.oobe.stored")
      : t("popup.oobe.incomplete");
  requireElement("ma-popup-build").textContent = t("popup.eyebrow", {
    mode: buildModeLabel(),
    version: __MA_BUILD_VERSION__
  });
  requireElement("ma-popup-id").textContent = chrome.runtime.id;

  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const count = scripts.filter(
      (script) =>
        script.id.startsWith("ma-main:") || script.id.startsWith("ma-iso:")
    ).length;
    requireElement("ma-popup-registrations").textContent = t(
      "popup.registrations.count",
      { count }
    );
  } catch {
    requireElement("ma-popup-registrations").textContent =
      t("common.unavailable");
  }

  requireElement("ma-open-setup").addEventListener("click", () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL("onboarding.html") })
      .then(() => window.close())
      .catch((error: unknown) => {
        showError("popup.error.openSetup", error);
      });
  });

  requireElement("ma-open-options").addEventListener("click", () => {
    void chrome.runtime
      .openOptionsPage()
      .then(() => window.close())
      .catch((error: unknown) => {
        showError("popup.error.openOptions", error);
      });
  });

  requireElement("ma-open-fixture").addEventListener("click", () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL("editor.html?fixture=1") })
      .then(() => window.close())
      .catch((error: unknown) => {
        showError("popup.error.openFixture", error);
      });
  });
}

const loadingSlot = document.getElementById("ma-popup-loading");
if (loadingSlot) {
  loadingSlot.append(
    loadingIndicator({
      label: t("popup.loading"),
      contained: true
    })
  );
}

void (async () => {
  try {
    await render();
  } catch (error: unknown) {
    showError("popup.error.init", error);
  } finally {
    loadingSlot?.replaceChildren();
  }
})();
