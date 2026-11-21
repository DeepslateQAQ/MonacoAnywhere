/*
 * Bootstrap onboarding.
 *
 * This page can save a backend preference, but it cannot complete OOBE: the
 * engine, data pack, and real fixture validation do not exist in this slice.
 * It never presents a simulated check as success and never writes
 * onboardingComplete.
 */

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

function clearStatus(): void {
  const status = requireElement("ma-onboarding-status");
  status.textContent = "";
  status.hidden = true;
  const error = requireElement("ma-onboarding-error");
  error.textContent = "";
  error.hidden = true;
}

function setStatus(message: string): void {
  const status = requireElement("ma-onboarding-status");
  status.textContent = message;
  status.hidden = message.length === 0;
}

function setError(message: string): void {
  const error = requireElement("ma-onboarding-error");
  error.textContent = message;
  error.hidden = message.length === 0;
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
  setError("");
}

function renderBackendGuidance(backend: MaBackendChoice): void {
  const guidance = requireElement("ma-backend-guidance");
  guidance.replaceChildren();

  const heading = document.createElement("h3");
  heading.textContent = backend === "wasm" ? "WASM backend" : "Native backend";

  const first = document.createElement("p");
  if (backend === "wasm") {
    first.textContent =
      "The WASM clangd engine and toolchain data packs are not part of this skeleton build, so no download or fixture validation is attempted.";
  } else {
    first.textContent =
      "Install the native host from host/dist with this extension ID, then select the native backend in options. The host, clangd detection, and language services are not implemented in this slice.";
  }

  const second = document.createElement("p");
  if (backend === "wasm") {
    second.textContent =
      "When the engine exists, the setup flow will download the data pack with a visible progress indicator and verify its SHA-256 before use.";
  } else {
    second.textContent =
      "Detection is intentionally unavailable here. A future step will run the real host check and report the detected clangd version.";
  }

  guidance.append(heading, first);

  if (backend === "native") {
    const idLine = document.createElement("p");
    idLine.className = "code-line";
    idLine.append("Extension ID: ");
    const code = document.createElement("code");
    code.textContent = chrome.runtime.id;
    idLine.append(code);
    guidance.append(idLine);
  }

  guidance.append(second);
}

function renderValidationStep(backend: MaBackendChoice | null): void {
  const status = requireElement("ma-validation-status");
  status.textContent =
    backend === null
      ? "Choose a backend first. Validation remains unavailable in this skeleton build."
      : "Validation is intentionally unavailable: no clangd engine or data pack is present, and no fixture request has been sent. Setup cannot be completed in this build.";
}

async function openOptions(): Promise<void> {
  await chrome.runtime.openOptionsPage();
}

async function initialise(): Promise<void> {
  const settings = await readSettings();
  const storedBackend = settings.backend;
  setRadio(storedBackend);
  if (storedBackend !== null) {
    renderBackendGuidance(storedBackend);
  }
  renderValidationStep(storedBackend);

  requireElement("ma-build-mode").textContent =
    `${__MA_BUILD_MODE__} · ${__MA_BUILD_VERSION__}`;

  requireElement("ma-next-1").addEventListener("click", () => {
    const backend = selectedBackend();
    if (backend === null) {
      setError("Select a backend before continuing. No backend is preselected.");
      return;
    }
    void writeSettings({ backend })
      .then(() => {
        renderBackendGuidance(backend);
        renderValidationStep(backend);
        showStep(2);
        setStatus(
          "Backend choice saved. This does not complete setup: validation is unavailable in this build."
        );
      })
      .catch((error: unknown) => {
        setError(`Could not save the backend choice: ${String(error)}`);
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
      setError(`Could not open options: ${String(error)}`);
    });
  });

  if (settings.onboardingComplete) {
    setStatus(
      "Storage reports onboardingComplete=true, but this skeleton build cannot validate it. No new completion is written."
    );
  }
}

void initialise().catch((error: unknown) => {
  const errorNode = document.getElementById("ma-onboarding-error");
  if (errorNode) {
    errorNode.textContent = `Onboarding failed to initialise: ${String(error)}`;
    errorNode.hidden = false;
  }
});
