/*
 * Bootstrap onboarding.
 *
 * This page can save a backend preference, but it cannot complete OOBE: the
 * engine, data pack, and real fixture validation do not exist in this slice.
 * It never presents a simulated check as success and never writes
 * onboardingComplete.
 */

import { setLocale, t, type MessageKey } from "../ui/i18n.js";
import { el, setStatus } from "../ui/primitives.js";

const SETTINGS_KEY = "settings:v1";
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
    throw new Error(`Missing onboarding element #${id}`);
  }
  return element as T;
}

async function readSettings(): Promise<MaSettings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const value: unknown = stored[SETTINGS_KEY];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...(value as Partial<MaSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(patch: Partial<MaSettings>): Promise<void> {
  const current = await readSettings();
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...current, ...patch }
  });
}

function selectedBackend(): MaBackendChoice | null {
  const selected = document.querySelector<HTMLInputElement>(
    'input[name="ma-backend"]:checked'
  );
  const value = selected?.value;
  return value === "wasm" || value === "native" ? value : null;
}

function setRadio(backend: MaBackendChoice | null): void {
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="ma-backend"]');
  radios.forEach((radio) => {
    radio.checked = backend !== null && radio.value === backend;
  });
}

function showStatus(kind: "info" | "error", text: string): void {
  const node = requireElement("ma-onboarding-status");
  setStatus(node, { kind, text });
  node.hidden = text.length === 0;
}

function clearStatus(): void {
  showStatus("info", "");
}

function showStep(step: 1 | 2 | 3): void {
  for (const number of [1, 2, 3] as const) {
    requireElement(`ma-step-${number}`).hidden = number !== step;
    const marker = requireElement(`ma-step-marker-${number}`);
    if (number === step) {
      marker.setAttribute("aria-current", "step");
      marker.dataset.active = "true";
    } else {
      marker.removeAttribute("aria-current");
      delete marker.dataset.active;
    }
  }
  clearStatus();
}

function backendTitleKey(backend: MaBackendChoice): MessageKey {
  return backend === "wasm"
    ? "onboarding.guidance.wasm.title"
    : "onboarding.guidance.native.title";
}

function renderBackendGuidance(backend: MaBackendChoice): void {
  const guidance = requireElement("ma-backend-guidance");
  const heading = el("h3", {}, [t(backendTitleKey(backend))]);
  const first = el("p", {}, [
    t(
      backend === "wasm"
        ? "onboarding.guidance.wasm.first"
        : "onboarding.guidance.native.first"
    )
  ]);
  const second = el("p", {}, [
    t(
      backend === "wasm"
        ? "onboarding.guidance.wasm.second"
        : "onboarding.guidance.native.second"
    )
  ]);

  const content: Array<Node | string> = [heading, first];
  if (backend === "native") {
    content.push(
      el("p", { class: "ma-meta" }, [
        `${t("common.extensionId")}: `,
        el("code", {}, [chrome.runtime.id])
      ])
    );
  }
  content.push(second);
  guidance.replaceChildren(...content);
}

function renderValidationStep(backend: MaBackendChoice | null): void {
  requireElement("ma-validation-description").textContent = t(
    "onboarding.validation.description",
    { method: "textDocument/completion" }
  );
  requireElement("ma-validation-status").textContent =
    backend === null
      ? t("onboarding.validation.chooseBackend")
      : t("onboarding.validation.unavailable");
}

async function openOptions(): Promise<void> {
  await chrome.runtime.openOptionsPage();
}

function buildModeLabel(): string {
  return t(
    __MA_BOOTSTRAP__ ? "build.mode.bootstrap" : "build.mode.production"
  );
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

async function initialise(): Promise<void> {
  const settings = await readSettings();
  setLocale(settings.locale);
  applyThemePreference(settings.theme);

  const storedBackend = settings.backend;
  setRadio(storedBackend);
  if (storedBackend !== null) {
    renderBackendGuidance(storedBackend);
  }
  renderValidationStep(storedBackend);

  requireElement("ma-build-mode").textContent = t("onboarding.eyebrow", {
    mode: buildModeLabel()
  });

  requireElement("ma-next-1").addEventListener("click", () => {
    const backend = selectedBackend();
    if (backend === null) {
      showStatus("error", t("onboarding.error.selectBackend"));
      return;
    }
    void writeSettings({ backend })
      .then(() => {
        renderBackendGuidance(backend);
        renderValidationStep(backend);
        showStep(2);
        showStatus("info", t("onboarding.info.saved"));
      })
      .catch((error: unknown) => {
        showStatus(
          "error",
          t("onboarding.error.save", { error: String(error) })
        );
      });
  });

  requireElement("ma-back-2").addEventListener("click", () => {
    showStep(1);
  });
  requireElement("ma-next-2").addEventListener("click", () => {
    renderValidationStep(selectedBackend());
    showStep(3);
  });
  requireElement("ma-back-3").addEventListener("click", () => {
    showStep(2);
  });
  requireElement("ma-open-options").addEventListener("click", () => {
    void openOptions().catch((error: unknown) => {
      showStatus(
        "error",
        t("onboarding.error.openOptions", { error: String(error) })
      );
    });
  });

  if (settings.onboardingComplete) {
    showStatus("info", t("onboarding.info.completeStored"));
  }
}

void initialise().catch((error: unknown) => {
  const errorNode = document.getElementById("ma-onboarding-status");
  if (errorNode) {
    setStatus(errorNode, {
      kind: "error",
      text: t("onboarding.error.init", { error: String(error) })
    });
    errorNode.hidden = false;
  }
});
