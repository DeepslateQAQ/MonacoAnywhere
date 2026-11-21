/*
 * Setup wizard (OOBE).
 *
 * Four steps: backend → resources → validation → completion. The backend is
 * never preselected. Resource preparation, native-host detection, and fixture
 * validation are shown truthfully: this integration ships no data downloader
 * and no fixture completion client, so validation cannot succeed and this
 * page never writes onboardingComplete. A failed check preserves the chosen
 * backend and never switches it automatically.
 */

import {
  getSettings,
  subscribeSettings,
  updateSettings,
  type BackendChoice,
  type Settings
} from "../background/state.js";
import { setLocale, t, type MessageKey } from "../ui/i18n.js";
import { el, setStatus } from "../ui/primitives.js";
import {
  detectNativeHost,
  probeFixtureValidation,
  probePackagedResources
} from "./probe.js";

type Step = 1 | 2 | 3 | 4;

const STEPS: readonly Step[] = [1, 2, 3, 4];

// Localize static markup immediately; getSettings() refines this below.
setLocale("auto");

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing onboarding element #${id}`);
  }
  return element as T;
}

let currentSettings: Settings | null = null;
let currentStep: Step = 1;
let backendSelectionDirty = false;

function buildModeLabel(): string {
  return t(
    __MA_BOOTSTRAP__ ? "build.mode.bootstrap" : "build.mode.production"
  );
}

function applyThemePreference(theme: Settings["theme"]): void {
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

function showStatus(kind: "info" | "error", text: string): void {
  const node = requireElement("ma-onboarding-status");
  setStatus(node, { kind, text });
  node.hidden = text.length === 0;
}

function showStep(step: Step): void {
  currentStep = step;
  for (const number of STEPS) {
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
  showStatus("info", "");
}

function selectedBackend(): BackendChoice | null {
  const selected = document.querySelector<HTMLInputElement>(
    'input[name="ma-backend"]:checked'
  );
  const value = selected?.value;
  return value === "wasm" || value === "native" ? value : null;
}

/**
 * Render the stored choice. A null backend leaves both radios unchecked,
 * regardless of any browser default restoration.
 */
function setRadio(backend: BackendChoice | null): void {
  document
    .querySelectorAll<HTMLInputElement>('input[name="ma-backend"]')
    .forEach((radio) => {
      radio.checked = backend !== null && radio.value === backend;
    });
}

function backendTitleKey(backend: BackendChoice): MessageKey {
  return backend === "wasm"
    ? "onboarding.guidance.wasm.title"
    : "onboarding.guidance.native.title";
}

function renderBackendGuidance(backend: BackendChoice | null): void {
  const guidance = requireElement("ma-backend-guidance");
  if (backend === null) {
    guidance.replaceChildren();
    return;
  }
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

function presentLabel(present: boolean): string {
  return t(
    present
      ? "onboarding.resources.artifact.present"
      : "onboarding.resources.artifact.absent"
  );
}

function renderResourceStep(): void {
  const backend = currentSettings?.backend ?? null;
  const description = requireElement("ma-resource-description");
  const status = requireElement("ma-resource-status");
  const extra = requireElement("ma-resource-extra");
  const checkButton = requireElement<HTMLButtonElement>("ma-resource-check");

  extra.replaceChildren();
  if (backend === null) {
    description.textContent = t("onboarding.validation.chooseBackend");
    status.textContent = t("onboarding.resources.chooseBackend");
    checkButton.textContent = t("onboarding.resources.check");
    checkButton.disabled = true;
    return;
  }

  checkButton.disabled = false;
  if (backend === "wasm") {
    description.textContent = t("onboarding.resources.wasmBody");
    status.textContent = t("onboarding.resources.wasmNotChecked");
    checkButton.textContent = t("onboarding.resources.check");
    return;
  }

  description.textContent = t("onboarding.resources.nativeBody");
  status.textContent = t("onboarding.resources.nativeNotChecked");
  checkButton.textContent = t("onboarding.resources.detect");
  extra.append(
    el("p", { class: "ma-meta" }, [t("onboarding.resources.nativeCommand")]),
    el("pre", { class: "ma-command" }, [
      el("code", {}, [
        `monacoanywhere-host install --extension-id ${chrome.runtime.id}`
      ])
    ])
  );
}

async function checkResources(): Promise<void> {
  const backend = currentSettings?.backend ?? null;
  if (backend === null) {
    showStep(1);
    showStatus("error", t("onboarding.error.selectBackend"));
    return;
  }
  const button = requireElement<HTMLButtonElement>("ma-resource-check");
  const status = requireElement("ma-resource-status");
  button.disabled = true;
  status.textContent = t(
    backend === "wasm"
      ? "onboarding.resources.checking"
      : "onboarding.resources.nativeChecking"
  );

  try {
    if (backend === "wasm") {
      const probe = await probePackagedResources();
      status.textContent = t("onboarding.resources.wasmProbe", {
        downloader: t("onboarding.resources.downloader.missing"),
        engine: presentLabel(probe.engineAvailable),
        catalogue: presentLabel(probe.cataloguePresent),
        packs:
          probe.packCount === null
            ? t("common.unavailable")
            : String(probe.packCount)
      });
      return;
    }

    const detection = await detectNativeHost();
    switch (detection.status) {
      case "responded":
        status.textContent = t("onboarding.resources.nativeResponded", {
          detail: detection.summary
        });
        break;
      case "missing":
        status.textContent = t("onboarding.resources.nativeMissing", {
          error: detection.error
        });
        break;
      case "empty":
        status.textContent = t("onboarding.resources.nativeEmpty");
        break;
      case "failed":
        status.textContent = t("onboarding.resources.nativeFailed", {
          error: detection.error
        });
        break;
    }
  } catch (error: unknown) {
    const text = t("onboarding.resources.checkError", {
      error: String(error)
    });
    status.textContent = text;
    showStatus("error", text);
  } finally {
    button.disabled = false;
  }
}

function renderValidationStep(): void {
  const backend = currentSettings?.backend ?? null;
  requireElement("ma-validation-description").textContent = t(
    "onboarding.validation.description",
    { method: "textDocument/completion" }
  );
  const status = requireElement("ma-validation-status");
  status.textContent =
    backend === null
      ? t("onboarding.validation.chooseBackend")
      : t("onboarding.validation.readyToCheck");
  requireElement<HTMLButtonElement>("ma-validate").disabled = backend === null;
}

async function checkValidation(): Promise<void> {
  const backend = currentSettings?.backend ?? null;
  if (backend === null) {
    showStep(1);
    showStatus("error", t("onboarding.error.selectBackend"));
    return;
  }
  const button = requireElement<HTMLButtonElement>("ma-validate");
  const status = requireElement("ma-validation-status");
  button.disabled = true;
  status.textContent = t("onboarding.validation.checking");

  try {
    const probe = await probeFixtureValidation(backend);
    status.textContent = t("onboarding.validation.unavailable", {
      backend: backend === "wasm" ? t("onboarding.backend.wasm.title") : t("onboarding.backend.native.title"),
      engine: presentLabel(probe.engineAvailable),
      client: t("onboarding.validation.clientMissing")
    });
    // No completion request was sent, so setup remains incomplete. The stored
    // backend preference is left exactly as it was.
    showStatus("info", t("onboarding.info.validationUnavailable"));
  } catch (error: unknown) {
    const text = t("onboarding.validation.checkFailed", {
      error: String(error)
    });
    status.textContent = text;
    showStatus("error", text);
  } finally {
    button.disabled = false;
  }
}

function renderCompletionStep(): void {
  const complete = currentSettings?.onboardingComplete === true;
  requireElement("ma-complete-description").textContent = complete
    ? t("onboarding.complete.stored")
    : t("onboarding.complete.blocked");
  requireElement("ma-complete-status").textContent = t(
    "onboarding.complete.requirementStatus"
  );
  // Nothing on this page can satisfy the real validation requirement, so the
  // finish control is always unavailable. onboardingComplete is never written.
  requireElement<HTMLButtonElement>("ma-finish").disabled = true;
}

function renderHeader(): void {
  requireElement("ma-build-mode").textContent = t("onboarding.eyebrow", {
    mode: buildModeLabel()
  });
}

function renderCurrentStep(): void {
  if (currentStep === 1) {
    return;
  }
  if (currentSettings?.backend === null) {
    showStep(1);
    setRadio(null);
    backendSelectionDirty = false;
    return;
  }
  renderBackendGuidance(currentSettings?.backend ?? null);
  if (currentStep === 2) {
    renderResourceStep();
  } else if (currentStep === 3) {
    renderValidationStep();
  } else {
    renderCompletionStep();
  }
}

async function commitBackend(backend: BackendChoice): Promise<void> {
  const button = requireElement<HTMLButtonElement>("ma-next-1");
  button.disabled = true;
  try {
    currentSettings = await updateSettings({ backend });
    backendSelectionDirty = false;
    setRadio(currentSettings.backend);
    renderBackendGuidance(currentSettings.backend);
    renderResourceStep();
    showStep(2);
    showStatus("info", t("onboarding.info.saved"));
    if (currentSettings.backend === "wasm") {
      await checkResources();
    }
  } catch (error: unknown) {
    showStatus(
      "error",
      t("onboarding.error.save", { error: String(error) })
    );
  } finally {
    button.disabled = false;
  }
}

async function openOptions(): Promise<void> {
  await chrome.runtime.openOptionsPage();
}

function wireEvents(): void {
  document
    .querySelectorAll<HTMLInputElement>('input[name="ma-backend"]')
    .forEach((radio) => {
      radio.addEventListener("change", () => {
        backendSelectionDirty = true;
      });
    });

  requireElement("ma-next-1").addEventListener("click", () => {
    const backend = selectedBackend();
    if (backend === null) {
      showStatus("error", t("onboarding.error.selectBackend"));
      return;
    }
    void commitBackend(backend);
  });

  requireElement("ma-back-2").addEventListener("click", () => {
    setRadio(currentSettings?.backend ?? null);
    backendSelectionDirty = false;
    showStep(1);
  });

  requireElement("ma-resource-check").addEventListener("click", () => {
    void checkResources();
  });

  requireElement("ma-next-2").addEventListener("click", () => {
    renderValidationStep();
    showStep(3);
    showStatus("info", t("onboarding.info.resourceUnavailable"));
    void checkValidation();
  });

  requireElement("ma-back-3").addEventListener("click", () => {
    renderResourceStep();
    showStep(2);
  });

  requireElement("ma-validate").addEventListener("click", () => {
    void checkValidation();
  });

  requireElement("ma-change-backend").addEventListener("click", () => {
    setRadio(currentSettings?.backend ?? null);
    backendSelectionDirty = false;
    showStep(1);
    const checked = document.querySelector<HTMLInputElement>(
      'input[name="ma-backend"]:checked'
    );
    const first = document.querySelector<HTMLInputElement>(
      'input[name="ma-backend"]'
    );
    (checked ?? first)?.focus();
  });

  requireElement("ma-next-3").addEventListener("click", () => {
    renderCompletionStep();
    showStep(4);
  });

  requireElement("ma-back-4").addEventListener("click", () => {
    renderValidationStep();
    showStep(3);
  });

  requireElement("ma-open-options").addEventListener("click", () => {
    void openOptions().catch((error: unknown) => {
      showStatus(
        "error",
        t("onboarding.error.openOptions", { error: String(error) })
      );
    });
  });
}

async function initialise(): Promise<void> {
  currentSettings = await getSettings();
  setLocale(currentSettings.locale);
  applyThemePreference(currentSettings.theme);
  setRadio(currentSettings.backend);
  renderBackendGuidance(currentSettings.backend);
  renderHeader();
  renderResourceStep();
  renderValidationStep();
  renderCompletionStep();
  wireEvents();

  if (currentSettings.onboardingComplete) {
    showStatus("info", t("onboarding.info.completeStored"));
  }

  subscribeSettings((settings) => {
    currentSettings = settings;
    setLocale(settings.locale);
    applyThemePreference(settings.theme);
    renderHeader();
    renderCurrentStep();
    if (currentStep === 1 && !backendSelectionDirty) {
      setRadio(settings.backend);
    }
  });
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
