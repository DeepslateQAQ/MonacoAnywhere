/*
 * Bootstrap options page.
 *
 * Preferences are stored locally under settings:v1. There is no fake clangd
 * detection or validation: the current build has no engine or native host.
 * The page preserves onboardingComplete and never invents a successful check.
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

function setStatus(message: string, isError: boolean): void {
  const status = requireElement("ma-options-status");
  const error = requireElement("ma-options-error");
  status.textContent = "";
  status.hidden = true;
  error.textContent = "";
  error.hidden = true;
  if (message.length === 0) {
    return;
  }
  if (isError) {
    error.textContent = message;
    error.hidden = false;
  } else {
    status.textContent = message;
    status.hidden = false;
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
      ? "No backend selected. Setup is incomplete and language services are unavailable in this build."
      : `Backend preference: ${settings.backend}. onboardingComplete=${String(
          settings.onboardingComplete
        )}. This skeleton build cannot validate either backend.`;
}

async function initialise(): Promise<void> {
  const settings = await readSettings();
  fillForm(settings);
  requireElement("ma-build-mode").textContent =
    `${__MA_BUILD_MODE__} · ${__MA_BUILD_VERSION__}`;
  requireElement("ma-extension-id").textContent = chrome.runtime.id;

  const form = requireElement<HTMLFormElement>("ma-options-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setStatus("", false);

    const backendValue = requireElement<HTMLSelectElement>("ma-backend").value;
    if (backendValue !== "" && backendValue !== "wasm" && backendValue !== "native") {
      setStatus("Unsupported backend selection.", true);
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
      hiddenPauseMs < 1000 ||
      hiddenPauseMs > 86_400_000
    ) {
      setStatus("Pause delay must be an integer between 1000 and 86400000 ms.", true);
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

    void readSettings()
      .then((current) => {
        const next: MaSettings = { ...current, ...patch };
        if (clangdPath.length === 0) {
          delete next.clangdPath;
        } else {
          next.clangdPath = clangdPath;
        }
        return chrome.storage.local
          .set({ [SETTINGS_KEY]: next })
          .then(() => next);
      })
      .then((next) => {
        fillForm(next);
        setStatus(
          "Preferences saved locally. No backend was validated; OOBE remains incomplete in this build.",
          false
        );
      })
      .catch((error: unknown) => {
        setStatus(`Could not save preferences: ${String(error)}`, true);
      });
  });

  requireElement("ma-open-setup").addEventListener("click", () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL("onboarding.html") })
      .catch((error: unknown) => {
        setStatus(`Could not open setup: ${String(error)}`, true);
      });
  });
}

void initialise().catch((error: unknown) => {
  const errorNode = document.getElementById("ma-options-error");
  if (errorNode) {
    errorNode.textContent = `Options failed to initialise: ${String(error)}`;
    errorNode.hidden = false;
  }
});
