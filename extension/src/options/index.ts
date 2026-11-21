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
  markOnboardingComplete,
  subscribeSettings,
  updateSettings,
  type BackendChoice,
  type LocalePreference,
  type Settings,
  type ThemePreference
} from "../background/state.js";
import {
  validateFixtureBackend,
  type FixtureValidationOutcome,
  type ValidationStage
} from "../onboarding/probe.js";
import { setLocale, t, type MessageKey } from "../ui/i18n.js";
import { applyEditorThemeAccent } from "../ui/editor-accent.js";
import {
  DEFAULT_EDITOR_THEME_ID,
  EDITOR_THEMES,
  isEditorThemeId
} from "../editor/editor-themes.js";
import { loadingIndicator, setStatus } from "../ui/primitives.js";
import { Snackbar } from "../ui/snackbar.js";
import "@kyralabs/m3e-elements/ripple.js";
import "@kyralabs/m3e-elements/list.js";
import "@kyralabs/m3e-elements/list-detail-layout.js";
import "@kyralabs/m3e-elements/button-group.js";
import type { M3eList } from "@kyralabs/m3e-elements/list.js";
import type { M3eListDetailLayout } from "@kyralabs/m3e-elements/list-detail-layout.js";
import type { M3eButtonGroup } from "@kyralabs/m3e-elements/button-group.js";

// Localize static markup immediately; getSettings() refines this below.
setLocale("auto");

const snackbar = new Snackbar(document.body);
window.addEventListener("pagehide", () => snackbar.clear(), { once: true });

let currentSettings: Settings | null = null;
let activePanel: PanelId = "services";

const PANEL_IDS = [
  "services",
  "editor",
  "appearance",
  "advanced",
  "state"
] as const;
type PanelId = (typeof PANEL_IDS)[number];

function isPanelId(value: string | null | undefined): value is PanelId {
  return (
    typeof value === "string" &&
    (PANEL_IDS as readonly string[]).includes(value)
  );
}

function panelFromHash(): PanelId | null {
  const hash = location.hash.replace(/^#/, "");
  return hash.length > 0 && isPanelId(hash) ? hash : null;
}

function navItem(panel: PanelId): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.ma-options-nav .m3e-list-item[data-value="${panel}"]`
  );
}

function renderPanelTitle(panel: PanelId): void {
  const headline = navItem(panel)?.querySelector(".m3e-list-item__headline");
  requireElement("ma-panel-title").textContent = headline?.textContent?.trim() ?? "";
}

function isCompactScaffold(layout: M3eListDetailLayout): boolean {
  // The scaffold shows one pane below 840px and both from 840px. Count the
  // visible panes instead of measuring: the host itself has no box, and either
  // pane may be the visible one after a navigation.
  const panes = Array.from(
    layout.querySelectorAll(".m3e-pane-scaffold__pane")
  );
  const visible = panes.filter(
    (pane) => getComputedStyle(pane).display !== "none"
  ).length;
  return visible <= 1;
}

/**
 * Show one settings pane. The M3E list-detail scaffold keeps the category list
 * and this pane side by side from 840px and swaps them below that width.
 */
function showPanel(panel: PanelId, options: { navigate?: boolean } = {}): void {
  activePanel = panel;
  for (const section of document.querySelectorAll<HTMLElement>(
    ".ma-panel[data-panel]"
  )) {
    section.hidden = section.dataset.panel !== panel;
  }
  const list = document.getElementById("ma-options-nav-list") as M3eList | null;
  if (list && list.selectedValues.join() !== panel) {
    list.selectedValues = [panel];
  }
  renderPanelTitle(panel);
  const layout = document.getElementById(
    "ma-options-layout"
  ) as M3eListDetailLayout | null;
  if (
    options.navigate !== false &&
    layout &&
    layout.currentDestination?.pane !== "primary" &&
    isCompactScaffold(layout)
  ) {
    layout.navigateTo("detail");
  }
  if (location.hash !== `#${panel}`) {
    history.replaceState(null, "", `#${panel}`);
  }
}

function wirePanelNavigation(): void {
  const list = requireElement<M3eList>("ma-options-nav-list");
  list.addEventListener("selection-change", (event) => {
    const value = event.detail?.value;
    if (isPanelId(value)) {
      showPanel(value);
    }
  });
  // Tapping the already-selected category changes no selection, but on a
  // single-pane scaffold it still has to open that section.
  list.addEventListener("click", (event) => {
    const target = event.target;
    const item =
      target instanceof Element ? target.closest(".m3e-list-item") : null;
    const value = item?.getAttribute("data-value");
    if (isPanelId(value)) {
      showPanel(value);
    }
  });
  window.addEventListener("hashchange", () => {
    const panel = panelFromHash();
    if (panel) showPanel(panel);
  });
}

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
  snackbar.clear();
  const node = requireElement("ma-options-status");
  const persistentText = kind === "error" ? text : "";
  setStatus(node, { kind, text: persistentText });
  node.hidden = persistentText.length === 0;
  if (kind === "info" && text.length > 0) {
    snackbar.show(text);
  }
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

function refreshAriaLabels(): void {
  const layout = document.getElementById("ma-options-layout");
  layout?.setAttribute("list-label", t("options.nav.label"));
  layout?.setAttribute("detail-label", t("options.panel.label"));
  document
    .getElementById("ma-options-nav-list")
    ?.setAttribute("label", t("options.nav.label"));
  document
    .getElementById("ma-backend-group")
    ?.setAttribute("label", t("options.backend.label"));
  document
    .getElementById("ma-theme-group")
    ?.setAttribute("label", t("options.theme.label"));
  document
    .getElementById("ma-locale-group")
    ?.setAttribute("label", t("options.locale.label"));
}

let backendValidationBusy = false;
let backendValidationStage: ValidationStage | null = null;
let backendValidationError: string | null = null;
let backendValidationResult: {
  backend: BackendChoice;
  count: number;
} | null = null;

function validationStageText(stage: ValidationStage): string {
  switch (stage) {
    case "starting":
      return t("onboarding.validation.stage.starting");
    case "initializing":
      return t("onboarding.validation.stage.initializing");
    case "opening":
      return t("onboarding.validation.stage.opening");
    case "completing":
      return t("onboarding.validation.stage.completing");
  }
}

function validationFailureText(outcome: FixtureValidationOutcome): string {
  if (outcome.ok) {
    return "";
  }
  if (outcome.reason === "pack-missing") {
    return t("options.validation.packMissing", {
      pack: outcome.packId,
      version: outcome.packVersion
    });
  }
  if (outcome.reason === "zero-items") {
    return t("options.validation.noCompletions");
  }
  return t("options.validation.failed", { error: outcome.message });
}

function renderBackendValidation(selectedOverride?: string): void {
  const node = requireElement("ma-backend-validation");
  const button = requireElement<HTMLButtonElement>("ma-validate-backend");
  const saved = currentSettings?.backend ?? null;
  const selected = selectedOverride ?? segmentedValue("ma-backend-group") ?? "";
  const pending = selected !== (saved ?? "");

  let text: string;
  let error = false;
  if (saved === null) {
    text = t("options.validation.chooseBackend");
  } else if (pending) {
    text = t("options.validation.unsaved");
  } else if (backendValidationBusy) {
    const stage = backendValidationStage
      ? validationStageText(backendValidationStage)
      : t("onboarding.validation.stage.starting");
    text = t("options.validation.running", { stage });
  } else if (backendValidationError !== null) {
    text = backendValidationError;
    error = true;
  } else if (
    backendValidationResult !== null &&
    backendValidationResult.backend === saved &&
    currentSettings?.onboardingComplete === true
  ) {
    text = t("options.validation.success", {
      count: backendValidationResult.count
    });
  } else if (currentSettings?.onboardingComplete === true) {
    text = t("options.validation.verified");
  } else {
    text = t("options.validation.idle");
  }

  node.textContent = text;
  node.classList.toggle("ma-error", error);
  button.disabled = saved === null || pending || backendValidationBusy;
}

async function runBackendValidation(): Promise<void> {
  const backend = currentSettings?.backend ?? null;
  if (backend === null || backendValidationBusy) {
    return;
  }
  backendValidationBusy = true;
  backendValidationStage = "starting";
  backendValidationError = null;
  backendValidationResult = null;
  renderBackendValidation();

  try {
    const outcome = await validateFixtureBackend(backend, {
      onStage(stage) {
        backendValidationStage = stage;
        renderBackendValidation();
      }
    });
    if (!outcome.ok) {
      backendValidationError = validationFailureText(outcome);
      return;
    }
    if (outcome.count <= 0) {
      backendValidationError = t("options.validation.noCompletions");
      return;
    }
    try {
      const next = await markOnboardingComplete(backend);
      currentSettings = next;
      backendValidationResult = { backend, count: outcome.count };
      applyUiPreferences(next);
    } catch (error: unknown) {
      backendValidationError = t("options.validation.failed", {
        error: String(error)
      });
    }
  } catch (error: unknown) {
    backendValidationError = t("options.validation.failed", {
      error: String(error)
    });
  } finally {
    backendValidationBusy = false;
    backendValidationStage = null;
    renderBackendValidation();
  }
}

function applyUiPreferences(settings: Settings): void {
  setLocale(settings.locale);
  refreshAriaLabels();
  applyThemePreference(settings.theme);
  applyEditorThemeAccent(
    document.querySelector<HTMLElement>(".ma-ui"),
    settings.editorTheme
  );
  renderHeader();
  renderPanelTitle(activePanel);
  renderState(settings);
  renderBackendValidation();
}

const THEME_VALUES: readonly ThemePreference[] = ["system", "light", "dark"];
const LOCALE_VALUES: readonly LocalePreference[] = ["auto", "zh-CN", "en"];
const BACKEND_VALUES: readonly string[] = ["", "wasm", "native"];

function segmentedValue(groupId: string): string | null {
  const group = document.getElementById(groupId);
  const selected = group?.querySelector(
    "m3e-button-group-item[selected]"
  );
  return selected?.getAttribute("value") ?? null;
}

function setSegmentedValue(
  groupId: string,
  values: readonly string[],
  value: string
): void {
  const group = document.getElementById(groupId);
  if (!group) return;
  for (const item of group.querySelectorAll("m3e-button-group-item")) {
    const itemValue = item.getAttribute("value");
    item.toggleAttribute(
      "selected",
      itemValue !== null && values.includes(itemValue) && itemValue === value
    );
  }
}

function fillForm(settings: Settings): void {
  setSegmentedValue(
    "ma-backend-group",
    BACKEND_VALUES,
    settings.backend ?? ""
  );
  setSegmentedValue("ma-theme-group", THEME_VALUES, settings.theme);
  setSegmentedValue("ma-locale-group", LOCALE_VALUES, settings.locale);
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
  const themeSelect = requireElement<HTMLSelectElement>("ma-editor-theme");
  themeSelect.value = isEditorThemeId(settings.editorTheme)
    ? settings.editorTheme
    : DEFAULT_EDITOR_THEME_ID;
  renderBackendValidation();
}

function buildEditorThemeOptions(): void {
  const select = requireElement<HTMLSelectElement>("ma-editor-theme");
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
  requireElement<M3eButtonGroup>("ma-backend-group").addEventListener(
    "selection-change",
    (event) => renderBackendValidation(event.detail?.value)
  );
  const themeGroup = requireElement<M3eButtonGroup>("ma-theme-group");
  themeGroup.addEventListener("selection-change", (event) => {
    const theme = readTheme(event.detail?.value ?? "");
    void persistPatch({ theme }, "options.info.themeSaved", () => {
      setSegmentedValue(
        "ma-theme-group",
        THEME_VALUES,
        currentSettings?.theme ?? "system"
      );
    });
  });

  const localeGroup = requireElement<M3eButtonGroup>("ma-locale-group");
  localeGroup.addEventListener("selection-change", (event) => {
    const locale = readLocale(event.detail?.value ?? "");
    void persistPatch({ locale }, "options.info.localeSaved", () => {
      setSegmentedValue(
        "ma-locale-group",
        LOCALE_VALUES,
        currentSettings?.locale ?? "auto"
      );
    });
  });
}

async function savePreferences(): Promise<void> {
  showStatus("info", "");

  const backendValue = segmentedValue("ma-backend-group") ?? "";
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

  const theme = readTheme(segmentedValue("ma-theme-group") ?? "");
  const locale = readLocale(segmentedValue("ma-locale-group") ?? "");

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
    editorTheme: (() => {
      const value = requireElement<HTMLSelectElement>("ma-editor-theme").value;
      return isEditorThemeId(value) ? value : DEFAULT_EDITOR_THEME_ID;
    })()
  };

  try {
    const wasComplete = currentSettings?.onboardingComplete === true;
    const previousBackend = currentSettings?.backend ?? null;
    const next = await updateSettings(patch);
    currentSettings = next;
    if (next.backend !== previousBackend) {
      backendValidationError = null;
      backendValidationResult = null;
    }
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
  if (currentSettings && currentSettings.backend !== next.backend) {
    backendValidationError = null;
    backendValidationResult = null;
  }
  currentSettings = next;
  setSegmentedValue(
    "ma-backend-group",
    BACKEND_VALUES,
    next.backend ?? ""
  );
  setSegmentedValue("ma-theme-group", THEME_VALUES, next.theme);
  setSegmentedValue("ma-locale-group", LOCALE_VALUES, next.locale);
  applyUiPreferences(next);
}

async function initialise(): Promise<void> {
  buildEditorThemeOptions();
  currentSettings = await getSettings();
  applyUiPreferences(currentSettings);
  fillForm(currentSettings);
  requireElement("ma-extension-id").textContent = chrome.runtime.id;

  wirePanelNavigation();
  const initialPanel = panelFromHash();
  showPanel(initialPanel ?? "services", { navigate: initialPanel !== null });

  const form = requireElement<HTMLFormElement>("ma-options-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePreferences().catch((error: unknown) => {
      showStatus("error", t("options.error.save", { error: String(error) }));
    });
  });

  wireImmediatePreferences();
  requireElement<HTMLSelectElement>("ma-editor-theme").addEventListener(
    "change",
    (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isEditorThemeId(value)) {
        applyEditorThemeAccent(
          document.querySelector<HTMLElement>(".ma-ui"),
          value
        );
      }
    }
  );

  requireElement("ma-open-setup").addEventListener("click", () => {
    void openSetup().catch((error: unknown) => {
      showStatus(
        "error",
        t("options.error.openSetup", { error: String(error) })
      );
    });
  });

  requireElement("ma-validate-backend").addEventListener("click", () => {
    void runBackendValidation();
  });

  const resetSites = requireElement<HTMLButtonElement>("ma-reset-sites");
  resetSites.addEventListener("click", () => {
    const keys = Object.keys(currentSettings?.siteBackends ?? {});
    if (keys.length === 0) {
      showStatus("info", t("options.info.sitesReset"));
      return;
    }
    resetSites.disabled = true;
    const clear = Object.fromEntries(
      keys.map((key) => [key, undefined])
    ) as unknown as Settings["siteBackends"];
    void updateSettings({ siteBackends: clear })
      .then((next) => {
        currentSettings = next;
        applyUiPreferences(next);
        showStatus("info", t("options.info.sitesReset"));
      })
      .catch((error: unknown) => {
        showStatus(
          "error",
          t("options.error.preferenceSave", { error: String(error) })
        );
      })
      .finally(() => {
        resetSites.disabled = false;
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
