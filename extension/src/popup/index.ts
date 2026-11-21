/*
 * Extension popup.
 *
 * Reads centralized settings only. It never starts an engine, requests host
 * permission, or writes onboardingComplete. With no backend selected the
 * setup action is labelled "Continue setup"; language services are reported
 * as unavailable for this build instead of claiming a working backend.
 */

import { getSettings, type BackendChoice } from "../background/state.js";
import { setLocale, t } from "../ui/i18n.js";
import { loadingIndicator, setStatus } from "../ui/primitives.js";

// Browser locale first, then getSettings() refines this below.
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

function backendLabel(backend: BackendChoice | null): string {
  if (backend === "wasm") {
    return t("popup.backend.wasm");
  }
  if (backend === "native") {
    return t("popup.backend.native");
  }
  return t("popup.backend.none");
}

function applyThemePreference(theme: "system" | "light" | "dark"): void {
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
  const settings = await getSettings();
  setLocale(settings.locale);
  applyThemePreference(settings.theme);

  requireElement("ma-popup-backend").textContent = backendLabel(
    settings.backend
  );
  requireElement("ma-popup-services").textContent = t(
    "popup.services.unavailable"
  );
  requireElement("ma-popup-oobe").textContent = settings.onboardingComplete
    ? t("popup.oobe.stored")
    : t("popup.oobe.incomplete");
  requireElement("ma-popup-build").textContent = t("popup.eyebrow", {
    mode: buildModeLabel(),
    version: __MA_BUILD_VERSION__
  });
  requireElement("ma-popup-id").textContent = chrome.runtime.id;

  const setupButton = requireElement<HTMLButtonElement>("ma-open-setup");
  setupButton.textContent = t(
    settings.backend === null || !settings.onboardingComplete
      ? "popup.continueSetup"
      : "popup.openSetup"
  );

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

  setupButton.addEventListener("click", () => {
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
