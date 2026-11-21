/*
 * Extension popup.
 *
 * A compact control surface: page-local status, backend choice, editor theme,
 * and entry points. It reads and writes centralized settings only; it never
 * starts an engine, requests host permission automatically, or writes
 * onboardingComplete. A Hydro backend choice is also stored for the current
 * deployment origin so the page gate and the popup cannot disagree.
 */

import {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  type Settings,
  type SiteBackend
} from "../background/state.js";
import {
  DEFAULT_EDITOR_THEME_ID,
  EDITOR_THEMES,
  isEditorThemeId
} from "../editor/editor-themes.js";
import { setLocale, t } from "../ui/i18n.js";
import { applyEditorThemeAccent } from "../ui/editor-accent.js";
import { loadingIndicator, setStatus } from "../ui/primitives.js";

// Browser locale first, then getSettings() refines this below.
setLocale("auto");

interface SiteSnapshot {
  site: string;
  originKey: string | null;
  remote: string | null;
}

let currentSettings: Settings | null = null;
let activeTab: chrome.tabs.Tab | null = null;
let siteSnapshot: SiteSnapshot | null = null;
let saving = false;

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

function backendLabel(backend: SiteBackend | null | undefined): string {
  if (backend === "wasm") {
    return t("popup.backend.wasm");
  }
  if (backend === "native") {
    return t("popup.backend.native");
  }
  if (backend === "site") {
    return t("popup.backend.site");
  }
  return t("popup.backend.none");
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

function showError(
  key:
    | "popup.error.openSetup"
    | "popup.error.openOptions"
    | "popup.error.openFixture"
    | "popup.error.enableSite"
    | "popup.error.save"
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

function clearError(): void {
  const node = document.getElementById("ma-popup-error");
  if (node) {
    setStatus(node, { kind: "info", text: "" });
    node.hidden = true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSiteSnapshot(value: unknown): SiteSnapshot | null {
  if (!isRecord(value) || value.__ma !== 1) return null;
  if (typeof value.site !== "string" || value.site.length > 32) return null;
  const originKey =
    typeof value.originKey === "string" && value.originKey.length <= 2_048
      ? value.originKey
      : null;
  const remote =
    typeof value.remote === "string" && value.remote.length <= 32
      ? value.remote
      : null;
  return { site: value.site, originKey, remote };
}

async function querySite(tab: chrome.tabs.Tab | null): Promise<SiteSnapshot | null> {
  if (tab?.id === undefined || !tab.url || !/^https?:/u.test(tab.url)) {
    return null;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      __ma: 1,
      type: "ma/site-status-query"
    });
    return readSiteSnapshot(response);
  } catch {
    return null;
  }
}

function hostnameFromOrigin(originKey: string | null): string | null {
  if (!originKey) return null;
  try {
    return new URL(originKey).hostname;
  } catch {
    return null;
  }
}

function siteHost(): string | null {
  if (activeTab?.url && /^https?:/u.test(activeTab.url)) {
    try {
      return new URL(activeTab.url).hostname;
    } catch {
      return null;
    }
  }
  return hostnameFromOrigin(siteSnapshot?.originKey ?? null);
}

function remoteLabel(remote: string | null): string {
  switch (remote) {
    case "active":
      return t("popup.remote.active");
    case "suspended":
      return t("popup.remote.suspended");
    case "reload-required":
      return t("popup.remote.reload");
    case "unsupported":
      return t("popup.remote.unsupported");
    case "none":
      return t("popup.remote.none");
    default:
      return currentSettings?.backend
        ? t("popup.services.local", {
            backend: backendLabel(currentSettings.backend)
          })
        : t("popup.services.none");
  }
}

function siteChoice(settings: Settings): SiteBackend | null {
  if (
    siteSnapshot?.site === "hydro" &&
    siteSnapshot.originKey !== null
  ) {
    return settings.siteBackends[siteSnapshot.originKey] ?? null;
  }
  return null;
}

function renderBackendSegments(settings: Settings): void {
  const choice = siteChoice(settings) ?? settings.backend;
  const group = requireElement("ma-backend-segmented");
  const label = requireElement("ma-backend-label");
  label.textContent =
    siteSnapshot?.site === "hydro"
      ? t("popup.backend.chooseSite")
      : t("popup.backend.choose");
  const buttons = Array.from(
    group.querySelectorAll<HTMLButtonElement>("button[data-backend]")
  );
  let hasChecked = false;
  for (const button of buttons) {
    const isSite = button.dataset.backend === "site";
    if (isSite) button.hidden = siteSnapshot?.site !== "hydro";
    const checked = button.dataset.backend === choice;
    if (checked) hasChecked = true;
    button.disabled = saving;
    button.setAttribute("aria-checked", String(checked));
    button.tabIndex = checked ? 0 : -1;
  }
  if (!hasChecked) {
    const first = buttons.find((button) => !button.hidden);
    if (first) first.tabIndex = 0;
  }
}

function renderThemeSelect(settings: Settings): void {
  const select = requireElement<HTMLSelectElement>("ma-popup-theme");
  const selected = isEditorThemeId(settings.editorTheme)
    ? settings.editorTheme
    : DEFAULT_EDITOR_THEME_ID;
  if (select.options.length === 0) {
    for (const groupName of ["vscode", "catppuccin"] as const) {
      const group = document.createElement("optgroup");
      group.label = groupName === "vscode" ? "VS Code" : "Catppuccin";
      for (const theme of EDITOR_THEMES.filter(
        (candidate) => candidate.group === groupName
      )) {
        const option = document.createElement("option");
        option.value = theme.id;
        option.textContent = theme.label;
        group.append(option);
      }
      select.append(group);
    }
  }
  select.value = selected;
  select.disabled = saving;
}

function renderEnableSite(tab: chrome.tabs.Tab | null): void {
  const button = requireElement<HTMLButtonElement>("ma-enable-site");
  button.hidden = true;
  button.disabled = false;
  if (tab?.id === undefined || !tab.url || !/^https?:/u.test(tab.url)) {
    return;
  }
  if (siteSnapshot !== null) {
    // If the content adapter answered, this origin is already covered even if
    // it is a private Hydro deployment that hostname heuristics cannot know.
    return;
  }
  const url = new URL(tab.url);
  const dedicated =
    /(^|\.)luogu\.com\.cn$/u.test(url.hostname) ||
    /(^|\.)luogu\.org$/u.test(url.hostname) ||
    url.hostname === "atcoder.jp" ||
    url.hostname === "codeforces.com" ||
    /(^|\.)hydro\.ac$/u.test(url.hostname);
  if (dedicated) return;
  button.hidden = false;
  button.textContent = t("popup.enableSite", { host: url.hostname });
}

async function render(): Promise<void> {
  clearError();
  const settings = await getSettings();
  currentSettings = settings;
  setLocale(settings.locale);
  applyThemePreference(settings.theme);
  applyEditorThemeAccent(document.body, settings.editorTheme);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? null;
  siteSnapshot = await querySite(activeTab);

  const ready = settings.backend !== null && settings.onboardingComplete;
  const state = requireElement("ma-popup-state");
  state.textContent = ready ? t("popup.state.ready") : t("popup.state.setup");

  requireElement("ma-popup-site").textContent =
    siteHost() ?? t("popup.site.none");
  requireElement("ma-popup-services").textContent = remoteLabel(
    siteSnapshot?.remote ?? null
  );
  requireElement("ma-popup-backend").textContent = backendLabel(
    siteChoice(settings) ?? settings.backend
  );
  requireElement("ma-popup-oobe").textContent = settings.onboardingComplete
    ? t("popup.oobe.stored")
    : t("popup.oobe.incomplete");
  requireElement("ma-popup-build").textContent = t("popup.eyebrow", {
    mode: buildModeLabel(),
    version: __MA_BUILD_VERSION__
  });
  const idNode = requireElement("ma-popup-id");
  idNode.textContent = `${chrome.runtime.id.slice(0, 8)}…`;
  idNode.title = chrome.runtime.id;

  const setupButton = requireElement<HTMLButtonElement>("ma-open-setup");
  setupButton.hidden = ready;
  setupButton.textContent = t("popup.continueSetup");

  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const count = scripts.filter((script) =>
      script.id.startsWith("ma-main:")
    ).length;
    requireElement("ma-popup-registrations").textContent = t(
      "popup.registrations.count",
      { count }
    );
  } catch {
    requireElement("ma-popup-registrations").textContent =
      t("common.unavailable");
  }

  renderBackendSegments(settings);
  renderThemeSelect(settings);
  renderEnableSite(activeTab);
}

async function saveBackend(choice: SiteBackend): Promise<void> {
  if (saving) return;
  saving = true;
  renderBackendSegments(currentSettings ?? DEFAULT_SETTINGS);
  try {
    const patch: Partial<Settings> = {};
    if (
      siteSnapshot?.site === "hydro" &&
      siteSnapshot.originKey !== null
    ) {
      patch.siteBackends = { [siteSnapshot.originKey]: choice };
    }
    if (choice !== "site") {
      patch.backend = choice;
    }
    const next = await updateSettings(patch);
    currentSettings = next;
    saving = false;
    await render();
  } catch (error: unknown) {
    saving = false;
    showError("popup.error.save", error);
    if (currentSettings) renderBackendSegments(currentSettings);
  }
}

async function enableCurrentSite(): Promise<void> {
  const button = requireElement<HTMLButtonElement>("ma-enable-site");
  if (activeTab?.id === undefined || !activeTab.url) return;
  button.disabled = true;
  try {
    const url = new URL(activeTab.url);
    const pattern = `${url.origin}/*`;
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      throw new Error("permission denied");
    }
    const stored = await chrome.storage.local.get("siteRegistrations:v1");
    const current: unknown = stored["siteRegistrations:v1"];
    const list: string[] = Array.isArray(current)
      ? current.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (!list.includes(url.origin)) list.push(url.origin);
    await chrome.storage.local.set({ "siteRegistrations:v1": list });
    await chrome.runtime.sendMessage({ __ma: 1, type: "ma/sync-sites" });
    await chrome.tabs.reload(activeTab.id);
    window.close();
  } catch (error: unknown) {
    button.disabled = false;
    showError("popup.error.enableSite", error);
  }
}

function wireControls(): void {
  const backendGroup = requireElement("ma-backend-segmented");
  backendGroup.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-backend]");
    const choice = button?.dataset.backend;
    if (choice === "wasm" || choice === "native" || choice === "site") {
      void saveBackend(choice);
    }
  });
  backendGroup.addEventListener("keydown", (event) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const buttons = Array.from(
      backendGroup.querySelectorAll<HTMLButtonElement>(
        "button[data-backend]:not([hidden]):not(:disabled)"
      )
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : current < 0
            ? 0
            : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[index]?.focus();
    buttons[index]?.click();
  });

  requireElement<HTMLSelectElement>("ma-popup-theme").addEventListener(
    "change",
    (event) => {
      const select = event.currentTarget as HTMLSelectElement;
      if (!isEditorThemeId(select.value)) return;
      const theme = select.value;
      void updateSettings({ editorTheme: theme })
        .then((next) => {
          currentSettings = next;
          applyEditorThemeAccent(document.body, theme);
          clearError();
        })
        .catch((error: unknown) => {
          showError("popup.error.save", error);
        });
    }
  );

  requireElement("ma-enable-site").addEventListener("click", () => {
    void enableCurrentSite();
  });

  requireElement("ma-open-setup").addEventListener("click", () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL("onboarding.html") })
      .then(() => window.close())
      .catch((error: unknown) => showError("popup.error.openSetup", error));
  });

  requireElement("ma-open-options").addEventListener("click", () => {
    void chrome.runtime
      .openOptionsPage()
      .then(() => window.close())
      .catch((error: unknown) => showError("popup.error.openOptions", error));
  });

  requireElement("ma-open-fixture").addEventListener("click", () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL("editor.html?standalone=1") })
      .then(() => window.close())
      .catch((error: unknown) => showError("popup.error.openFixture", error));
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
    wireControls();
    await render();
  } catch (error: unknown) {
    showError("popup.error.init", error);
  } finally {
    loadingSlot?.replaceChildren();
  }
})();
