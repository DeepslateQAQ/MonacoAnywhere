/*
 * Bootstrap popup: read-only status plus navigation. It does not start an
 * engine, request permissions, or validate a backend.
 */

const SETTINGS_KEY = "settings:v1";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing popup element #${id}`);
  }
  return element as T;
}

async function render(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw: unknown = stored[SETTINGS_KEY];
  const settings: Partial<MaSettings> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Partial<MaSettings>)
      : {};

  const backend = settings.backend;
  const backendLabel =
    backend === "wasm"
      ? "WASM clangd"
      : backend === "native"
        ? "Local clangd"
        : "No backend selected";

  requireElement("ma-popup-backend").textContent = backendLabel;
  requireElement("ma-popup-oobe").textContent =
    settings.onboardingComplete === true
      ? "Storage says onboardingComplete=true, but this skeleton build cannot validate it."
      : "Setup is incomplete. Language services are unavailable in this build.";
  requireElement("ma-popup-build").textContent =
    `${__MA_BUILD_MODE__} · ${__MA_BUILD_VERSION__}`;
  requireElement("ma-popup-id").textContent = chrome.runtime.id;

  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const count = scripts.filter(
      (script) =>
        script.id.startsWith("ma-main:") || script.id.startsWith("ma-iso:")
    ).length;
    requireElement("ma-popup-registrations").textContent = String(count);
  } catch {
    requireElement("ma-popup-registrations").textContent = "unavailable";
  }

  requireElement("ma-open-setup").addEventListener("click", () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL("onboarding.html") })
      .then(() => window.close())
      .catch((error: unknown) => {
        requireElement("ma-popup-error").textContent = `Could not open setup: ${String(
          error
        )}`;
        requireElement("ma-popup-error").hidden = false;
      });
  });

  requireElement("ma-open-options").addEventListener("click", () => {
    void chrome.runtime
      .openOptionsPage()
      .then(() => window.close())
      .catch((error: unknown) => {
        requireElement("ma-popup-error").textContent = `Could not open options: ${String(
          error
        )}`;
        requireElement("ma-popup-error").hidden = false;
      });
  });

  requireElement("ma-open-fixture").addEventListener("click", () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL("editor.html?fixture=1") })
      .then(() => window.close())
      .catch((error: unknown) => {
        requireElement("ma-popup-error").textContent = `Could not open fixture: ${String(
          error
        )}`;
        requireElement("ma-popup-error").hidden = false;
      });
  });
}

void render().catch((error: unknown) => {
  const node = document.getElementById("ma-popup-error");
  if (node) {
    node.textContent = `Popup failed to initialise: ${String(error)}`;
    node.hidden = false;
  }
});
