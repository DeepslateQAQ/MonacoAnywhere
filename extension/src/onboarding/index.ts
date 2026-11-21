/*
 * Setup wizard (OOBE).
 *
 * Four real steps: backend → resources → validation → completion. The WASM
 * resource step downloads, verifies, and installs the catalogue toolchain pack
 * (reusing an exact installed version); validation starts the real offscreen
 * language backend, performs a minimal LSP handshake, and requests completion
 * against a built-in fixture. Only a positive completion count writes
 * onboardingComplete and enables Finish. Failures preserve the chosen backend.
 */

import {
  getSettings,
  markOnboardingComplete,
  subscribeSettings,
  updateSettings,
  type BackendChoice,
  type Settings
} from "../background/state.js";
import { getLocale, setLocale, t, type MessageKey } from "../ui/i18n.js";
import { el, setStatus } from "../ui/primitives.js";
import {
  describePackError,
  detectNativeHost,
  inspectWasmPack,
  installWasmPack,
  validateFixtureBackend,
  type FixtureValidationFailure,
  type NativeDetection,
  type PackErrorDescription,
  type ValidationStage,
  type WasmPackProgress,
  type WasmPackStatus
} from "./probe.js";

type Step = 1 | 2 | 3 | 4;
type ResourceOperation = "check" | "install" | null;
type ValidationResult = { backend: BackendChoice; count: number };

interface NativeStatus {
  kind: "info" | "error";
  key: MessageKey;
  vars?: Record<string, string>;
}

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

let wasmStatus: WasmPackStatus | null = null;
let wasmReady = false;
let wasmError: PackErrorDescription | null = null;
let packProgress: WasmPackProgress | null = null;
let resourceOperation: ResourceOperation = null;
let resourceChecked = false;
let nativeStatus: NativeStatus | null = null;
let lastProgressAt = 0;

let validationBusy = false;
let validationStage: ValidationStage | null = null;
let validationError: string | null = null;
let validationResult: ValidationResult | null = null;

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

function setRadio(backend: BackendChoice | null): void {
  document
    .querySelectorAll<HTMLInputElement>('input[name="ma-backend"]')
    .forEach((radio) => {
      radio.checked = backend !== null && radio.value === backend;
    });
}

function backendTitleKey(backend: BackendChoice): MessageKey {
  return backend === "wasm"
    ? "onboarding.backend.wasm.title"
    : "onboarding.backend.native.title";
}

function backendGuidanceTitleKey(backend: BackendChoice): MessageKey {
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
  const content: Array<Node | string> = [
    el("h3", {}, [t(backendGuidanceTitleKey(backend))]),
    el("p", {}, [
      t(
        backend === "wasm"
          ? "onboarding.guidance.wasm.first"
          : "onboarding.guidance.native.first"
      )
    ]),
    el("p", {}, [
      t(
        backend === "wasm"
          ? "onboarding.guidance.wasm.second"
          : "onboarding.guidance.native.second"
      )
    ])
  ];
  if (backend === "native") {
    content.splice(1, 0, el("p", { class: "ma-meta" }, [
      `${t("common.extensionId")}: `,
      el("code", {}, [chrome.runtime.id])
    ]));
  }
  guidance.replaceChildren(...content);
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const formatted = new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: index === 0 ? 0 : 1
  }).format(value);
  return `${formatted} ${units[index] ?? "B"}`;
}

function packVars(status: WasmPackStatus): Record<string, string> {
  return {
    pack: status.packId,
    version: status.version,
    bytes: formatBytes(status.assetBytes),
    sha: status.sha256.slice(0, 12),
    files:
      status.fileCount === null
        ? t("common.unavailable")
        : String(status.fileCount)
  };
}

function resourceErrorText(error: PackErrorDescription): string {
  switch (error.kind) {
    case "catalogue":
      return t("onboarding.resources.catalogueFailed", {
        error: error.message
      });
    case "all-mirrors-failed":
      return t("onboarding.resources.allMirrorsFailed");
    case "checksum-mismatch":
      return t("onboarding.resources.checksumMismatch");
    case "verification":
      return t("onboarding.resources.verificationFailed", {
        error: error.message
      });
    case "storage":
      return t("onboarding.resources.storageFailed", {
        error: error.message
      });
    case "other":
      return t("onboarding.resources.installFailed", {
        error: error.message
      });
  }
}

function setResourceStatus(kind: "info" | "error", text: string): void {
  setStatus(requireElement("ma-resource-status"), { kind, text });
}

function renderResourceProgress(): void {
  const progress = requireElement<HTMLProgressElement>(
    "ma-resource-progress"
  );
  if (
    resourceOperation === "install" &&
    packProgress !== null
  ) {
    progress.hidden = false;
    progress.max = packProgress.totalBytes;
    progress.value = packProgress.receivedBytes;
  } else {
    progress.hidden = true;
    progress.removeAttribute("value");
  }
}

function renderWasmResourceState(): void {
  const statusNode = requireElement("ma-resource-status");
  const detail = requireElement("ma-resource-detail");

  if (resourceOperation === "check") {
    setResourceStatus("info", t("onboarding.resources.checkingInstalled"));
  } else if (resourceOperation === "install") {
    if (packProgress === null) {
      setResourceStatus("info", t("onboarding.resources.installingPreparing"));
    } else if (packProgress.receivedBytes >= packProgress.totalBytes) {
      setResourceStatus(
        "info",
        t("onboarding.resources.verifying", { pack: packProgress.packId })
      );
    } else {
      setResourceStatus(
        "info",
        t("onboarding.resources.installing", {
          pack: packProgress.packId,
          received: formatBytes(packProgress.receivedBytes),
          total: formatBytes(packProgress.totalBytes),
          percent: Math.floor(
            (packProgress.receivedBytes / packProgress.totalBytes) * 100
          ),
          mirror: packProgress.mirrorIndex + 1,
          mirrors: packProgress.mirrorCount
        })
      );
    }
  } else if (wasmError !== null) {
    setResourceStatus("error", resourceErrorText(wasmError));
  } else if (wasmReady && wasmStatus !== null) {
    setResourceStatus(
      "info",
      t(
        wasmStatus.downloaded
          ? "onboarding.resources.installSuccess"
          : "onboarding.resources.installed",
        packVars(wasmStatus)
      )
    );
  } else {
    setResourceStatus("info", t("onboarding.resources.wasmNotChecked"));
  }

  const details = wasmError?.details;
  detail.hidden = details === undefined;
  detail.textContent = details ?? "";
  statusNode.hidden = false;
  renderResourceProgress();
}

function renderNativeResourceState(): void {
  const detail = requireElement("ma-resource-detail");
  detail.hidden = true;
  detail.textContent = "";
  requireElement("ma-resource-progress").hidden = true;
  if (nativeStatus === null) {
    setResourceStatus("info", t("onboarding.resources.nativeNotChecked"));
    return;
  }
  setResourceStatus(nativeStatus.kind, t(nativeStatus.key, nativeStatus.vars));
}

function renderResourceStep(): void {
  const backend = currentSettings?.backend ?? null;
  const description = requireElement("ma-resource-description");
  const extra = requireElement("ma-resource-extra");
  const checkButton = requireElement<HTMLButtonElement>("ma-resource-check");
  const nextButton = requireElement<HTMLButtonElement>("ma-next-2");

  extra.replaceChildren();
  if (backend === null) {
    description.textContent = t("onboarding.validation.chooseBackend");
    setResourceStatus("info", t("onboarding.resources.chooseBackend"));
    checkButton.textContent = t("onboarding.resources.install");
    checkButton.disabled = true;
    nextButton.disabled = true;
    requireElement("ma-resource-progress").hidden = true;
    requireElement("ma-resource-detail").hidden = true;
    return;
  }

  if (backend === "wasm") {
    description.textContent = t("onboarding.resources.wasmBody");
    checkButton.textContent = t(
      wasmReady
        ? "onboarding.resources.recheck"
        : "onboarding.resources.install"
    );
    checkButton.disabled = resourceOperation !== null;
    nextButton.disabled = !wasmReady || resourceOperation !== null;
    renderWasmResourceState();
    return;
  }

  description.textContent = t("onboarding.resources.nativeBody");
  checkButton.textContent = t("onboarding.resources.detect");
  checkButton.disabled = resourceOperation !== null;
  nextButton.disabled = false;
  extra.append(
    el("p", { class: "ma-meta" }, [t("onboarding.resources.nativeCommand")]),
    el("pre", { class: "ma-command" }, [
      el("code", {}, [
        `monacoanywhere-host install --extension-id ${chrome.runtime.id}`
      ])
    ])
  );
  renderNativeResourceState();
}

function clearWasmState(): void {
  wasmStatus = null;
  wasmReady = false;
  wasmError = null;
  packProgress = null;
}

async function refreshWasmPack(): Promise<void> {
  if (resourceOperation !== null) {
    return;
  }
  resourceOperation = "check";
  resourceChecked = true;
  wasmError = null;
  packProgress = null;
  renderResourceStep();
  try {
    const status = await inspectWasmPack();
    wasmStatus = status;
    wasmReady = status.installed;
    if (status.installed) {
      validationError = null;
    }
  } catch (error: unknown) {
    wasmError = describePackError(error);
    wasmStatus = null;
    wasmReady = false;
    showStatus("error", resourceErrorText(wasmError));
  } finally {
    resourceOperation = null;
    renderResourceStep();
  }
}

async function runWasmInstall(): Promise<void> {
  if (resourceOperation !== null) {
    return;
  }
  resourceOperation = "install";
  resourceChecked = true;
  wasmError = null;
  packProgress = null;
  wasmReady = false;
  lastProgressAt = 0;
  renderResourceStep();
  showStatus("info", "");

  try {
    const status = await installWasmPack({
      onProgress(progress) {
        const now = performance.now();
        const complete = progress.receivedBytes >= progress.totalBytes;
        if (!complete && now - lastProgressAt < 200) {
          return;
        }
        lastProgressAt = now;
        packProgress = progress;
        renderResourceStep();
      }
    });
    wasmStatus = status;
    wasmReady = status.installed;
    packProgress = null;
    wasmError = null;
    validationError = null;
    const text = t(
      status.downloaded
        ? "onboarding.resources.installSuccess"
        : "onboarding.resources.installed",
      packVars(status)
    );
    showStatus("info", text);
  } catch (error: unknown) {
    wasmError = describePackError(error);
    wasmReady = false;
    packProgress = null;
    showStatus("error", resourceErrorText(wasmError));
  } finally {
    resourceOperation = null;
    renderResourceStep();
  }
}

function applyNativeDetection(detection: NativeDetection): string {
  switch (detection.status) {
    case "responded": {
      const text = t("onboarding.resources.nativeResponded", {
        detail: detection.summary
      });
      nativeStatus = {
        kind: "info",
        key: "onboarding.resources.nativeResponded",
        vars: { detail: detection.summary }
      };
      return text;
    }
    case "missing": {
      const text = t("onboarding.resources.nativeMissing", {
        error: detection.error
      });
      nativeStatus = {
        kind: "error",
        key: "onboarding.resources.nativeMissing",
        vars: { error: detection.error }
      };
      return text;
    }
    case "empty": {
      const text = t("onboarding.resources.nativeEmpty");
      nativeStatus = {
        kind: "error",
        key: "onboarding.resources.nativeEmpty"
      };
      return text;
    }
    case "failed": {
      const text = t("onboarding.resources.nativeFailed", {
        error: detection.error
      });
      nativeStatus = {
        kind: "error",
        key: "onboarding.resources.nativeFailed",
        vars: { error: detection.error }
      };
      return text;
    }
  }
}

async function detectNativeResource(): Promise<void> {
  if (resourceOperation !== null) {
    return;
  }
  resourceOperation = "check";
  nativeStatus = {
    kind: "info",
    key: "onboarding.resources.nativeChecking"
  };
  renderResourceStep();
  showStatus("info", "");
  try {
    const text = applyNativeDetection(await detectNativeHost());
    if (nativeStatus?.kind === "error") {
      showStatus("error", text);
    }
  } catch (error: unknown) {
    const text = t("onboarding.resources.nativeFailed", {
      error: String(error)
    });
    nativeStatus = {
      kind: "error",
      key: "onboarding.resources.nativeFailed",
      vars: { error: String(error) }
    };
    showStatus("error", text);
  } finally {
    resourceOperation = null;
    renderResourceStep();
  }
}

function enterResourceStep(): void {
  const backend = currentSettings?.backend ?? null;
  renderBackendGuidance(backend);
  renderResourceStep();
  showStep(2);
  if (backend === "wasm" && resourceOperation === null) {
    void refreshWasmPack();
  }
}

function validationStageKey(stage: ValidationStage): MessageKey {
  switch (stage) {
    case "starting":
      return "onboarding.validation.stage.starting";
    case "initializing":
      return "onboarding.validation.stage.initializing";
    case "opening":
      return "onboarding.validation.stage.opening";
    case "completing":
      return "onboarding.validation.stage.completing";
  }
}

function renderValidationStep(): void {
  const backend = currentSettings?.backend ?? null;
  requireElement("ma-validation-description").textContent = t(
    "onboarding.validation.description",
    { method: "textDocument/completion" }
  );
  const status = requireElement("ma-validation-status");

  let text: string;
  let kind: "info" | "error" = "info";
  if (backend === null) {
    text = t("onboarding.validation.chooseBackend");
  } else if (validationBusy) {
    const stage =
      validationStage === null
        ? t("onboarding.validation.stage.starting")
        : t(validationStageKey(validationStage));
    text = t("onboarding.validation.progress", { stage });
  } else if (validationError !== null) {
    text = validationError;
    kind = "error";
  } else if (
    validationResult !== null &&
    validationResult.backend === backend &&
    currentSettings?.onboardingComplete === true
  ) {
    text = t("onboarding.validation.success", {
      count: validationResult.count
    });
  } else {
    text = t("onboarding.validation.readyToCheck");
  }

  setStatus(status, { kind, text });

  requireElement<HTMLButtonElement>("ma-validate").disabled =
    backend === null || validationBusy;
  requireElement<HTMLButtonElement>("ma-change-backend").disabled =
    validationBusy;
  requireElement<HTMLButtonElement>("ma-back-3").disabled = validationBusy;
  requireElement<HTMLButtonElement>("ma-next-3").disabled = validationBusy;
}

function renderCompletionStep(): void {
  const backend = currentSettings?.backend ?? null;
  const success =
    backend !== null &&
    validationResult !== null &&
    validationResult.backend === backend &&
    currentSettings?.onboardingComplete === true;
  const complete = currentSettings?.onboardingComplete === true;

  requireElement("ma-complete-description").textContent = success
    ? t("onboarding.complete.success", {
        count: validationResult?.count ?? 0
      })
    : complete
      ? t("onboarding.complete.stored")
      : t("onboarding.complete.blocked");
  requireElement("ma-complete-status").textContent = success
    ? t("onboarding.complete.ready")
    : t("onboarding.complete.requirementStatus");
  requireElement<HTMLButtonElement>("ma-finish").disabled = !success;
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

function validationFailureText(outcome: FixtureValidationFailure): string {
  if (outcome.reason === "pack-missing") {
    return t("onboarding.validation.packMissing", {
      pack: outcome.packId,
      version: outcome.packVersion
    });
  }
  if (outcome.reason === "zero-items") {
    return t("onboarding.validation.zeroItems");
  }
  const backend = currentSettings?.backend ?? null;
  if (outcome.reason === "backend" && backend !== null) {
    return t("onboarding.validation.backendFailed", {
      backend: t(backendTitleKey(backend)),
      error: outcome.message
    });
  }
  if (
    outcome.reason === "catalogue" ||
    outcome.reason === "pack-store" ||
    outcome.reason === "settings"
  ) {
    return t("onboarding.validation.preparationFailed", {
      error: outcome.message
    });
  }
  return t("onboarding.validation.failed", { error: outcome.message });
}

async function checkValidation(): Promise<void> {
  const backend = currentSettings?.backend ?? null;
  if (backend === null) {
    showStep(1);
    showStatus("error", t("onboarding.error.selectBackend"));
    return;
  }
  if (validationBusy) {
    return;
  }

  validationBusy = true;
  validationStage = "starting";
  validationError = null;
  validationResult = null;
  renderValidationStep();
  renderCompletionStep();

  try {
    const outcome = await validateFixtureBackend(backend, {
      onStage(stage) {
        validationStage = stage;
        renderValidationStep();
      }
    });

    if (!outcome.ok) {
      validationError = validationFailureText(outcome);
      showStatus("error", validationError);
      return;
    }

    if (outcome.count <= 0) {
      validationError = t("onboarding.validation.zeroItems");
      showStatus("error", validationError);
      return;
    }

    try {
      const next = await markOnboardingComplete(backend);
      currentSettings = next;
      validationResult = { backend, count: outcome.count };
      validationError = null;
      const text = t("onboarding.validation.success", {
        count: outcome.count
      });
      renderCompletionStep();
      showStep(4);
      showStatus("info", text);
    } catch (error: unknown) {
      validationResult = null;
      validationError = t("onboarding.validation.markFailed", {
        count: outcome.count,
        error: String(error)
      });
      showStatus("error", validationError);
    }
  } catch (error: unknown) {
    validationError = t("onboarding.validation.failed", {
      error: String(error)
    });
    showStatus("error", validationError);
  } finally {
    validationBusy = false;
    validationStage = null;
    renderValidationStep();
    renderCompletionStep();
  }
}

async function commitBackend(backend: BackendChoice): Promise<void> {
  const button = requireElement<HTMLButtonElement>("ma-next-1");
  const previousBackend = currentSettings?.backend ?? null;
  button.disabled = true;
  try {
    const settings = await updateSettings({ backend });
    currentSettings = settings;
    backendSelectionDirty = false;
    if (settings.backend !== previousBackend) {
      validationResult = null;
      validationError = null;
      nativeStatus = null;
      resourceChecked = false;
      clearWasmState();
    }
    setRadio(settings.backend);
    renderBackendGuidance(settings.backend);
    enterResourceStep();
    showStatus("info", t("onboarding.info.saved"));
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
    const backend = currentSettings?.backend ?? null;
    if (backend === "wasm") {
      if (wasmReady) {
        void refreshWasmPack();
      } else {
        void runWasmInstall();
      }
    } else if (backend === "native") {
      void detectNativeResource();
    }
  });

  requireElement("ma-next-2").addEventListener("click", () => {
    const backend = currentSettings?.backend ?? null;
    if (backend === null) {
      showStep(1);
      showStatus("error", t("onboarding.error.selectBackend"));
      return;
    }
    if (backend === "wasm" && (!wasmReady || resourceOperation !== null)) {
      showStatus("error", t("onboarding.resources.installRequired"));
      return;
    }
    renderValidationStep();
    showStep(3);
    showStatus("info", t("onboarding.validation.readyToCheck"));
  });

  requireElement("ma-back-3").addEventListener("click", () => {
    if (validationBusy) {
      return;
    }
    enterResourceStep();
  });

  requireElement("ma-validate").addEventListener("click", () => {
    void checkValidation();
  });

  requireElement("ma-change-backend").addEventListener("click", () => {
    if (validationBusy) {
      return;
    }
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
    if (validationBusy) {
      return;
    }
    renderCompletionStep();
    showStep(4);
  });

  requireElement("ma-back-4").addEventListener("click", () => {
    renderValidationStep();
    showStep(3);
  });

  requireElement("ma-finish").addEventListener("click", () => {
    if (requireElement<HTMLButtonElement>("ma-finish").disabled) {
      return;
    }
    void openOptions().catch((error: unknown) => {
      showStatus(
        "error",
        t("onboarding.error.openOptions", { error: String(error) })
      );
    });
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
    const previousBackend = currentSettings?.backend ?? null;
    currentSettings = settings;
    if (settings.backend !== previousBackend) {
      validationResult = null;
      validationError = null;
      validationStage = null;
      nativeStatus = null;
      resourceChecked = false;
      clearWasmState();
    }
    if (!settings.onboardingComplete) {
      validationResult = null;
    }
    setLocale(settings.locale);
    applyThemePreference(settings.theme);
    renderHeader();
    renderCurrentStep();
    renderCompletionStep();
    if (currentStep === 1 && !backendSelectionDirty) {
      setRadio(settings.backend);
    }
    if (
      currentStep === 2 &&
      settings.backend === "wasm" &&
      !resourceChecked &&
      resourceOperation === null
    ) {
      void refreshWasmPack();
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
