/*
 * Monaco editor iframe.
 *
 * `editor.html?fixture=1` is the built-in fixture page: real editing, undo,
 * find, C++ syntax highlighting, local drafts, and a real language session.
 * Without that parameter (or as soon as the embedding content script sends
 * `ma/site-context`) the iframe runs in site mode: the page supplies the slot,
 * language list and initial text, every edit is posted to the parent, and the
 * site is never written except through messages from this document.
 *
 * Local draft autosave uses the shared IndexedDB draft layer only. Restoring is
 * an explicit prompt; a cross-tab conflict opens a comparison dialog and never
 * overwrites without a user choice. In site mode the draft key is derived from
 * the origin/account/problem/slot reported by the content script.
 */

import * as monaco from "monaco-editor";

import {
  DEFAULT_SETTINGS,
  getSettings,
  subscribeSettings,
  type BackendChoice,
  type Settings,
  type SiteBackend
} from "../background/state.js";
import {
  openDraftSession,
  type DraftConflict,
  type DraftConflictChoice,
  type DraftKeyParts,
  type DraftRecord,
  type DraftSaveInput,
  type DraftSaveResult,
  type DraftSession,
  type DraftSessionEvent
} from "../data/drafts.js";
import { loadBundledCatalogue } from "../data/catalogue.js";
import {
  createSession,
  registerHeaderNavigation,
  registerProviders,
  type Session
} from "../lsp/index.js";
import { openPortBackend } from "../lsp/port-backend.js";
import { watchVisibilityPause } from "../lsp/visibility.js";
import type { Backend } from "../lsp/backend.js";
import { BUILTIN_PROFILES } from "../profiles/builtin.js";
import type { CompileEngine } from "../profiles/commands.js";
import {
  isStandard,
  standardLabel,
  type CompilerProfile,
  type Standard
} from "../profiles/types.js";
import {
  SITE_PROTOCOL_MARKER,
  type LanguageOptionInfo,
  type SiteContext
} from "../shared/site-protocol.js";
import { getLocale, setLocale, t } from "../ui/i18n.js";
import { applyEditorThemeAccent } from "../ui/editor-accent.js";
import { el, openDialog, setStatus } from "../ui/primitives.js";
import { Snackbar, type SnackbarAction } from "../ui/snackbar.js";
import {
  fitsSiteMessageText,
  listenToContent,
  postEditorMessage
} from "./site-messages.js";
import {
  fallbackMessageKey,
  resolveContextProfile,
  standardCandidates,
  type SiteProfileLookup
} from "./site-profile.js";
import { defineMonacoThemes, editorThemeTone } from "./editor-themes.js";
import {
  buildStandardOptions,
  chooseLanguageOption,
  renderSiteToolbar,
  type SiteToolbarNodes
} from "./site-toolbar.js";

const FIXTURE = `#include <iostream>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    std::vector<int> values{1, 2, 3, 4, 5};
    long long sum = 0;
    for (int value : values) {
        sum += value;
    }
    std::cout << sum << '\\n';
    return 0;
}
`;

// The fixture has no OJ page, so its draft key uses the extension origin, the
// literal anonymous account scope, a fixture problem key, and one slot. Site
// mode replaces this with the context reported by the content script.
const FIXTURE_DRAFT_PARTS: DraftKeyParts = {
  originKey: location.origin,
  accountScope: "anon",
  problemKey: "fixture",
  editorSlot: "main"
};
const STANDALONE_DRAFT_PARTS: DraftKeyParts = {
  originKey: location.origin,
  accountScope: "anon",
  problemKey: "standalone",
  editorSlot: "main"
};

const urlParameters = new URL(location.href).searchParams;
const hasFixtureParameter = urlParameters.has("fixture");
let fixtureMode = hasFixtureParameter;
let standaloneMode = urlParameters.has("standalone") && !fixtureMode;
const localMode = (): boolean => fixtureMode || standaloneMode;
let draftParts: DraftKeyParts = fixtureMode
  ? FIXTURE_DRAFT_PARTS
  : standaloneMode
    ? STANDALONE_DRAFT_PARTS
    : FIXTURE_DRAFT_PARTS;

// Localize static markup immediately; getSettings() refines this below.
setLocale("auto");

const container = document.querySelector<HTMLElement>(
  "[data-monaco-anywhere-editor]"
);
if (!container) {
  throw new Error("MonacoAnywhere editor container is missing");
}

globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    const workerPath =
      label === "typescript" || label === "javascript"
        ? "workers/ts.worker.js"
        : "workers/editor.worker.js";
    return new Worker(chrome.runtime.getURL(workerPath), {
      type: "module",
      name: `monaco-anywhere-${label}-worker`
    });
  }
};

const cppRegistered = monaco.languages
  .getLanguages()
  .some((language) => language.id === "cpp");

defineMonacoThemes(monaco);

const model = monaco.editor.createModel(
  fixtureMode ? FIXTURE : "",
  cppRegistered ? "cpp" : "plaintext",
  monaco.Uri.parse(
    fixtureMode
      ? "file:///workspace/fixture/main.cpp"
      : standaloneMode
        ? "file:///workspace/standalone/main.cpp"
        : "file:///workspace/site/main.cpp"
  )
);

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

const editor = monaco.editor.create(container, {
  model,
  theme: prefersDark ? "vs-dark" : "vs",
  automaticLayout: true,
  fontFamily: DEFAULT_SETTINGS.editorFontFamily,
  fontLigatures: true,
  fontSize: 14,
  lineHeight: 22,
  tabSize: 4,
  insertSpaces: true,
  minimap: { enabled: true, renderCharacters: false },
  scrollBeyondLastLine: false,
  fixedOverflowWidgets: false,
  padding: { top: 12, bottom: 12 },
  renderWhitespace: "selection",
  ariaLabel: t("editor.ariaLabel")
});

const PRIMARY = monaco.KeyMod.CtrlCmd;
const SHIFT = monaco.KeyMod.Shift;

function triggerEditorAction(actionId: string): void {
  editor.focus();
  editor.trigger("ma-shortcut", actionId, null);
}

editor.addCommand(PRIMARY | SHIFT | monaco.KeyCode.KeyP, () => {
  triggerEditorAction("editor.action.quickCommand");
});
editor.addCommand(PRIMARY | monaco.KeyCode.KeyS, () => {
  editor.focus();
  void retrySave();
});

window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (container.contains(document.activeElement)) return;
  const key = event.key.toLowerCase();
  if (event.shiftKey && key === "p") {
    event.preventDefault();
    triggerEditorAction("editor.action.quickCommand");
    return;
  }
  if (event.shiftKey && key === "o") {
    event.preventDefault();
    triggerEditorAction("editor.action.quickOutline");
    return;
  }
  if (!event.shiftKey && key === "f") {
    event.preventDefault();
    triggerEditorAction("actions.find");
    return;
  }
  if (!event.shiftKey && key === "g") {
    event.preventDefault();
    triggerEditorAction("editor.action.gotoLine");
    return;
  }
  if (!event.shiftKey && key === "s") {
    event.preventDefault();
    editor.focus();
    void retrySave();
  }
});

document.documentElement.dataset.maBuildMode = __MA_BUILD_MODE__;
document.documentElement.dataset.maFixture = fixtureMode ? "1" : "0";
document.documentElement.dataset.maStandalone = standaloneMode ? "1" : "0";

const statusNode = document.getElementById("ma-editor-status");
const siteStatusNode = document.getElementById("ma-editor-site-status");
const siteToolbarNode = document.getElementById("ma-editor-site-toolbar");
const standardSelectNode = document.getElementById("ma-editor-standard");
const uiRoot = document.querySelector<HTMLElement>(".ma-ui");

if (
  !uiRoot ||
  !siteToolbarNode ||
  !(standardSelectNode instanceof HTMLSelectElement)
) {
  throw new Error("MonacoAnywhere editor toolbar markup is incomplete");
}

const siteToolbarNodes: SiteToolbarNodes = {
  standardSelect: standardSelectNode
};
const siteToolbar: HTMLElement = siteToolbarNode;
const draftSnackbar = new Snackbar(uiRoot);
buildStandardOptions(siteToolbarNodes.standardSelect);

document.body.classList.toggle("ma-site-mode", !fixtureMode);
if (statusNode && siteStatusNode) {
  const mirrorStatus = (): void => {
    siteStatusNode.textContent = statusNode.textContent;
    if (statusNode.dataset.kind) {
      siteStatusNode.dataset.kind = statusNode.dataset.kind;
    } else {
      delete siteStatusNode.dataset.kind;
    }
  };
  new MutationObserver(mirrorStatus).observe(statusNode, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });
  mirrorStatus();
}

if (statusNode) {
  setStatus(statusNode, {
    kind: "info",
    text: fixtureMode
      ? t("editor.status.initial")
      : standaloneMode
        ? t("editor.standalone.ready")
        : t("editor.site.waiting")
  });
}

let draftSession: DraftSession | null = null;
let draftReady = false;
let draftEpoch = 0;
let editedBeforeReady = false;
let suppressAutosave = false;
let pendingConflict: DraftConflict | null = null;
let pendingLocalEditAt = 0;
let conflictDialogOpen = false;
let unsubscribeDraft: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;
let unlistenContent: (() => void) | null = null;

let currentBackend: BackendChoice | null = null;
let currentSettings: Settings | null = null;
let siteContext: SiteContext | null = null;
let siteIdentity: string | null = null;
let siteOptionId: string | null = null;
let siteNativeText: string | null = null;
let siteBaseText: string | null = null;
let siteRemoteState: SiteContext["siteRemote"] = "none";
let suppressSiteBroadcast = false;
let lastSentSiteText: string | null = null;
let siteTextTooLarge = false;
let siteLanguageChoiceOpen = false;
let languageEpoch = 0;
let languageGeneration = 0;
let activeSiteProfileKey: string | null = null;
let siteProfileWarning: string | null = null;

function buildModeLabel(): string {
  return t(
    __MA_BOOTSTRAP__ ? "build.mode.bootstrap" : "build.mode.production"
  );
}

function renderHeading(): void {
  const title = document.getElementById("ma-editor-title");
  if (title) {
    title.textContent = "MonacoAnywhere";
    const version = document.createElement("span");
    version.id = "ma-editor-version";
    version.className = "ma-version";
    version.textContent = `${__MA_BUILD_VERSION__} · ${buildModeLabel()}${
      fixtureMode ? ` · ${t("editor.headingSuffix")}` : ""
    }`;
    title.append(version);
  }
}

function currentSiteProfile(): SiteProfileLookup {
  return siteContext
    ? resolveContextProfile(siteContext)
    : { kind: "missing", label: null };
}

function resolveEffectiveBackend(
  settings: Settings | null
): SiteBackend | null {
  if (!fixtureMode && siteContext !== null && settings !== null) {
    const choice = settings.siteBackends[siteContext.originKey];
    if (choice === "wasm" || choice === "native" || choice === "site") {
      return choice;
    }
  }
  return settings?.backend ?? currentBackend;
}

/** States in which the site's own service may be running or is undecidable. */
function remoteBlocksLocal(remote: SiteContext["siteRemote"]): boolean {
  return (
    remote === "active" ||
    remote === "reload-required" ||
    remote === "unsupported"
  );
}

function stopLocalLanguageServices(): void {
  activeSiteProfileKey = null;
  languageEpoch += 1;
  disposeLanguageServices();
  visibilityPause?.dispose();
  visibilityPause = null;
  lastLanguageRequest = null;
}

function reportRemoteBlocked(remote: SiteContext["siteRemote"]): void {
  switch (remote) {
    case "active":
      setLanguageStatus("info", t("editor.site.remoteActiveStatus"));
      return;
    case "reload-required":
      setLanguageStatus("info", t("editor.site.remoteReloadStatus"));
      return;
    case "unsupported":
      setLanguageStatus("info", t("editor.site.remoteUnsupportedStatus"));
      return;
    default:
      return;
  }
}

function renderSiteUi(): void {
  siteToolbar.hidden = fixtureMode;
  if (fixtureMode) {
    return;
  }
  const standalone = standaloneMode && siteContext === null;
  renderSiteToolbar(siteToolbarNodes, {
    context: siteContext,
    profile: standalone ? standaloneProfileLookup() : currentSiteProfile(),
    available: standalone
      ? standaloneStandardCandidates()
      : standardCandidates(siteContext),
    standalone
  });
}

function renderServiceStatus(): void {
  if (!statusNode) {
    return;
  }
  if (!cppRegistered) {
    setStatus(statusNode, {
      kind: "error",
      text: t("editor.status.noCpp")
    });
    return;
  }
  setStatus(statusNode, {
    kind: "info",
    text: t(
      __MA_BOOTSTRAP__ ? "editor.status.bootstrap" : "editor.status.production"
    )
  });
}

function setDraftStatus(
  kind: "info" | "error",
  text: string,
  action?: SnackbarAction
): void {
  draftSnackbar.show(text, { kind, action });
}

function showDraftSaveError(error: unknown): void {
  setDraftStatus(
    "error",
    t("editor.draft.saveError", { error: String(error) }),
    { label: t("editor.draft.retrySave"), run: () => void retrySave() }
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

function applyEditorPreferences(settings: Settings): void {
  currentSettings = settings;
  currentBackend = settings.backend;
  setLocale(settings.locale);
  applyThemePreference(settings.theme);

  const theme =
    settings.editorTheme.trim() ||
    (settings.theme === "light"
      ? "vs"
      : settings.theme === "dark"
        ? "vs-dark"
        : prefersDark
          ? "vs-dark"
          : "vs");
  let themeApplied = true;
  try {
    monaco.editor.setTheme(theme);
  } catch (error: unknown) {
    themeApplied = false;
    monaco.editor.setTheme(prefersDark ? "vs-dark" : "vs");
    if (statusNode) {
      setStatus(statusNode, {
        kind: "error",
        text: t("editor.status.badTheme", {
          theme,
          error: String(error)
        })
      });
    }
  }
  const appliedTheme = themeApplied
    ? theme
    : prefersDark
      ? "vs-dark"
      : "vs";
  document.documentElement.dataset.maEditorTheme = appliedTheme;
  const uiRoot = document.querySelector<HTMLElement>(".ma-ui");
  if (uiRoot) uiRoot.dataset.theme = editorThemeTone(appliedTheme);
  applyEditorThemeAccent(uiRoot, appliedTheme);

  editor.updateOptions({
    fontFamily:
      settings.editorFontFamily.trim() || DEFAULT_SETTINGS.editorFontFamily,
    ariaLabel: t(
      localMode() ? "editor.ariaLabel" : "editor.site.ariaLabel"
    )
  });
  renderHeading();
  renderSiteUi();
  if (themeApplied && fixtureMode) {
    renderServiceStatus();
  }
}

function formatTime(updatedAt: number): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: "short",
      timeStyle: "medium"
    }).format(new Date(updatedAt));
  } catch {
    return new Date(updatedAt).toISOString();
  }
}

function currentDraftInput(): DraftSaveInput {
  if (!siteContext) {
    return {
      code: model.getValue(),
      languageOptionId: null,
      siteEditorValue: null,
      baseSiteValue: null
    };
  }
  return {
    code: model.getValue(),
    languageOptionId: siteOptionId,
    siteEditorValue: siteNativeText,
    baseSiteValue: siteBaseText
  };
}

interface ModelTextChange {
  preserveUndo: boolean;
  autosave: boolean;
  broadcast: boolean;
}

function replaceModelText(text: string, change: ModelTextChange): void {
  if (model.getValue() === text) {
    return;
  }
  const previousAutosave = suppressAutosave;
  const previousBroadcast = suppressSiteBroadcast;
  suppressAutosave = !change.autosave;
  suppressSiteBroadcast = !change.broadcast;
  try {
    if (change.preserveUndo) {
      editor.executeEdits(siteContext ? "ma-site" : "ma-draft", [
        { range: model.getFullModelRange(), text }
      ]);
      editor.pushUndoStop();
    } else {
      model.setValue(text);
    }
  } finally {
    suppressAutosave = previousAutosave;
    suppressSiteBroadcast = previousBroadcast;
  }
}

function applyDraftText(text: string): void {
  replaceModelText(text, {
    preserveUndo: true,
    autosave: false,
    broadcast: true
  });
}

function broadcastSiteText(text: string): void {
  if (!siteContext) {
    return;
  }
  if (!fitsSiteMessageText(text)) {
    if (!siteTextTooLarge && statusNode) {
      setStatus(statusNode, {
        kind: "error",
        text: t("editor.site.textTooLarge")
      });
      siteTextTooLarge = true;
    }
    return;
  }
  siteTextTooLarge = false;
  lastSentSiteText = text;
  postEditorMessage({
    __ma: SITE_PROTOCOL_MARKER,
    type: "ma/editor-change",
    text
  });
}

function handleNativeText(text: string): void {
  if (!siteContext) {
    return;
  }
  if (text === lastSentSiteText) {
    // Our own edit coming back from the site. Never re-apply it over newer
    // keystrokes, and consume the marker so a later genuine edit can apply.
    lastSentSiteText = null;
    if (text === model.getValue()) {
      siteNativeText = text;
    }
    return;
  }
  // A genuine site edit invalidates the previous write's echo marker too.
  lastSentSiteText = null;
  siteNativeText = text;
  replaceModelText(text, {
    preserveUndo: true,
    autosave: true,
    broadcast: false
  });
}

function siteContextIdentity(context: SiteContext): string {
  return [
    context.originKey,
    context.accountScope,
    context.problemKey,
    context.slot.slotId
  ].join("\u0000");
}

function profileKey(profile: CompilerProfile): string {
  return JSON.stringify([
    profile.id,
    profile.label,
    profile.standard,
    profile.dialect,
    profile.args,
    profile.defines,
    profile.macros
  ]);
}

function previewPane(title: string, record: DraftRecord): HTMLElement {
  const code =
    record.code.length === 0 ? t("editor.draft.empty") : record.code;
  return el(
    "section",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minInlineSize: "0"
      }
    },
    [
      el("h3", { style: { margin: "0", fontSize: "14px" } }, [title]),
      el("p", { class: "ma-meta" }, [
        t("editor.draft.saved", { time: formatTime(record.updatedAt) })
      ]),
      el(
        "pre",
        {
          style: {
            margin: "0",
            padding: "8px",
            maxBlockSize: "220px",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            fontSize: "12px",
            direction: "ltr",
            textAlign: "left",
            border: "1px solid var(--m3e-sys-color-outline-variant)",
            borderRadius: "8px",
            backgroundColor:
              "var(--m3e-sys-color-surface-container-lowest)"
          },
          "aria-label": title
        },
        [code]
      )
    ]
  );
}

function conflictChoiceLabel(choice: DraftConflictChoice): string {
  switch (choice) {
    case "this-page":
      return t("editor.draft.thisPage");
    case "other-page":
      return t("editor.draft.otherPage");
    case "newer":
      return t("editor.draft.keepNewer");
  }
}

function newerSide(local: DraftRecord, remote: DraftRecord): "local" | "remote" {
  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt ? "local" : "remote";
  }
  if (local.code === remote.code) {
    return "local";
  }
  return local.code > remote.code ? "local" : "remote";
}

function conflictBody(conflict: DraftConflict): HTMLElement {
  const fieldset = el("fieldset", { class: "m3e-radio-group" }, [
    el("legend", {}, [t("editor.draft.conflictLegend")])
  ]);
  const choices: DraftConflictChoice[] = ["this-page", "other-page", "newer"];
  for (const choice of choices) {
    const label = conflictChoiceLabel(choice);
    const extra =
      choice === "newer"
        ? ` — ${t(
            conflict.newer === "local"
              ? "editor.draft.newerThis"
              : "editor.draft.newerOther"
          )}`
        : "";
    fieldset.append(
      el(
        "label",
        { class: "m3e-radio-button" },
        [
          el("input", {
            class: "m3e-radio-button__input",
            type: "radio",
            name: "ma-draft-conflict-choice",
            value: choice,
            checked: choice === "newer"
          }),
          el("span", {
            class: "m3e-radio-button__icon",
            "aria-hidden": "true"
          }),
          el("span", {
            class: "m3e-radio-button__state",
            "aria-hidden": "true"
          }),
          el("span", { class: "m3e-radio-button__label" }, [
            `${label}${extra}`
          ])
        ]
      )
    );
  }

  return el("div", { style: { display: "grid", gap: "12px" } }, [
    el("p", {}, [
      t("editor.draft.conflictBody", {
        thisTime: formatTime(conflict.local.updatedAt),
        otherTime: formatTime(conflict.remote.updatedAt)
      })
    ]),
    el("p", { class: "ma-meta" }, [
      t(
        conflict.otherWriterActive
          ? "editor.draft.otherActive"
          : "editor.draft.otherInactive"
      )
    ]),
    fieldset,
    el(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px"
        }
      },
      [
        previewPane(t("editor.draft.previewThis"), conflict.local),
        previewPane(t("editor.draft.previewOther"), conflict.remote)
      ]
    )
  ]);
}

function showSaved(record: DraftRecord, wrote: boolean): void {
  setDraftStatus(
    "info",
    wrote
      ? t("editor.draft.saved", { time: formatTime(record.updatedAt) })
      : t("editor.draft.unchanged")
  );
}

function handleSaveResult(result: DraftSaveResult): void {
  if (result.status === "saved") {
    pendingConflict = null;
    pendingLocalEditAt = 0;
    showSaved(result.record, result.wrote);
    return;
  }
  void showConflict(result.conflict);
}

async function resolveConflict(
  conflict: DraftConflict,
  choice: DraftConflictChoice
): Promise<void> {
  const session = draftSession;
  if (!session) {
    return;
  }
  try {
    const result = await session.resolve(conflict, choice);
    if (result.status === "conflict") {
      pendingConflict = result.conflict;
      setDraftStatus("error", t("editor.draft.conflictStale"), {
        label: t("editor.draft.resolve"),
        run: () => {
          void showConflict(result.conflict);
        }
      });
      return;
    }

    pendingConflict = null;
    pendingLocalEditAt = 0;
    session.adopt(result.record);
    if (choice === "other-page" || result.record.writerId !== session.writerId) {
      // The explicit choice selects the stored copy (or the newer remote one).
      if (result.record.code !== model.getValue()) {
        applyDraftText(result.record.code);
      }
    } else {
      // This page owns the resolved copy. Persist edits made while the dialog
      // was open instead of silently discarding them.
      const latest = currentDraftInput();
      if (latest.code !== result.record.code) {
        const followUp = await session.saveNow(latest);
        handleSaveResult(followUp);
        if (followUp.status === "saved") {
          setDraftStatus(
            "info",
            t("editor.draft.conflictResolved", {
              choice: conflictChoiceLabel(choice)
            })
          );
        }
        return;
      }
    }

    setDraftStatus(
      "info",
      t("editor.draft.conflictResolved", {
        choice: conflictChoiceLabel(choice)
      })
    );
  } catch (error: unknown) {
    showDraftSaveError(error);
  }
}

async function openConflictDialog(conflict: DraftConflict): Promise<void> {
  if (conflictDialogOpen) {
    pendingConflict = conflict;
    return;
  }
  // If the user kept editing after deferring a conflict, show and apply the
  // current page text rather than the stale attempted-save snapshot.
  const currentCode = model.getValue();
  const localUpdatedAt = Math.max(
    conflict.local.updatedAt,
    pendingLocalEditAt
  );
  const workingConflict: DraftConflict = {
    ...conflict,
    local: {
      ...conflict.local,
      code: currentCode,
      updatedAt: localUpdatedAt
    },
    newer: newerSide(
      {
        ...conflict.local,
        code: currentCode,
        updatedAt: localUpdatedAt
      },
      conflict.remote
    )
  };
  conflictDialogOpen = true;
  pendingConflict = workingConflict;
  draftSnackbar.clear();

  try {
    const body = conflictBody(workingConflict);
    const accepted = await openDialog(
      t("editor.draft.conflictTitle"),
      body,
      {
        confirm: t("editor.draft.applyChoice"),
        cancel: t("editor.draft.decideLater")
      }
    );
    conflictDialogOpen = false;
    if (!accepted) {
      setDraftStatus("error", t("editor.draft.deferred"), {
        label: t("editor.draft.resolve"),
        run: () => {
          if (pendingConflict) void showConflict(pendingConflict);
        }
      });
      return;
    }
    const selected = body.querySelector<HTMLInputElement>(
      'input[name="ma-draft-conflict-choice"]:checked'
    );
    const selectedValue = selected?.value;
    const choice: DraftConflictChoice =
      selectedValue === "this-page" ||
      selectedValue === "other-page" ||
      selectedValue === "newer"
        ? selectedValue
        : "newer";
    await resolveConflict(workingConflict, choice);
  } catch (error: unknown) {
    conflictDialogOpen = false;
    showDraftSaveError(error);
  }
}

function showConflict(conflict: DraftConflict): Promise<void> {
  // Drop any debounced save scheduled between the failed write and this event;
  // the conflict choice must be explicit before another write is attempted.
  draftSession?.cancel();
  return openConflictDialog(conflict);
}

function handleDraftEvent(event: DraftSessionEvent): void {
  switch (event.type) {
    case "saved":
      pendingConflict = null;
      pendingLocalEditAt = 0;
      showSaved(event.record, event.wrote);
      break;
    case "conflict":
      void showConflict(event.conflict);
      break;
    case "remote-change":
      if (!pendingConflict) {
        setDraftStatus("info", t("editor.draft.remoteChanged"));
      }
      break;
    case "lease-lost":
      setDraftStatus("error", t("editor.draft.leaseLost"), {
        label: t("editor.draft.retrySave"),
        run: () => {
          void retrySave();
        }
      });
      break;
  }
}

async function retrySave(): Promise<void> {
  const session = draftSession;
  if (!session) {
    await initialiseDrafts();
    return;
  }
  if (pendingConflict) {
    await showConflict(pendingConflict);
    return;
  }
  try {
    const result = await session.saveNow(currentDraftInput());
    handleSaveResult(result);
  } catch (error: unknown) {
    showDraftSaveError(error);
  }
}

function closeDraftSession(): void {
  draftEpoch += 1;
  unsubscribeDraft?.();
  unsubscribeDraft = null;
  draftSession?.release();
  draftSession = null;
  draftReady = false;
  editedBeforeReady = false;
  pendingConflict = null;
  pendingLocalEditAt = 0;
  draftSnackbar.clear();
}

function draftRestoreLabels(stored: DraftRecord): {
  body: string;
  confirm: string;
  cancel: string;
} {
  const time = formatTime(stored.updatedAt);
  if (siteContext) {
    return {
      body: t("editor.site.restoreBody", { time }),
      confirm: t("editor.draft.restore"),
      cancel: t("editor.site.useSiteText")
    };
  }
  return {
    body: t("editor.draft.restoreBody", { time }),
    confirm: t("editor.draft.restore"),
    cancel: t("editor.draft.useFixture")
  };
}

async function initialiseDrafts(): Promise<void> {
  const epoch = ++draftEpoch;
  const parts = draftParts;
  draftReady = false;
  draftSnackbar.clear();
  let session: DraftSession | null = null;
  try {
    session = await openDraftSession(parts, {
      onError: (error: unknown) => {
        if (epoch !== draftEpoch) {
          return;
        }
        showDraftSaveError(error);
      }
    });
    const stored = await session.load();
    if (epoch !== draftEpoch) {
      session.release();
      return;
    }
    if (stored) {
      session.adopt(stored);
      if (stored.code !== model.getValue()) {
        const labels = draftRestoreLabels(stored);
        const accepted = await openDialog(
          t("editor.draft.restoreTitle"),
          el("div", { style: { display: "grid", gap: "12px" } }, [
            el("p", {}, [labels.body]),
            previewPane(t("editor.draft.previewOther"), stored)
          ]),
          {
            confirm: labels.confirm,
            cancel: labels.cancel
          }
        );
        if (epoch !== draftEpoch) {
          session.release();
          return;
        }
        if (accepted) {
          applyDraftText(stored.code);
          setDraftStatus("info", t("editor.draft.restored"));
        } else {
          setDraftStatus(
            "info",
            t(
              siteContext
                ? "editor.site.discarded"
                : "editor.draft.discarded"
            )
          );
        }
      } else {
        setDraftStatus("info", t("editor.draft.unchanged"));
      }
    }

    if (epoch !== draftEpoch) {
      session.release();
      return;
    }
    unsubscribeDraft?.();
    unsubscribeDraft = session.subscribe(handleDraftEvent);
    draftSession = session;
    draftReady = true;
    if (editedBeforeReady && !stored) {
      // Typing can begin before IndexedDB finishes opening. Persist that text
      // once the session is ready instead of losing the first keystrokes.
      session.scheduleSave(currentDraftInput());
    }
    editedBeforeReady = false;
  } catch (error: unknown) {
    session?.release();
    if (epoch !== draftEpoch) {
      return;
    }
    draftSession = null;
    draftReady = false;
    setDraftStatus(
      "error",
      t("editor.draft.loadError", { error: String(error) }),
      { label: t("editor.draft.retrySave"), run: () => void initialiseDrafts() }
    );
  }
}

model.onDidChangeContent(() => {
  if (siteContext && !suppressSiteBroadcast) {
    broadcastSiteText(model.getValue());
  }
  if (!draftReady) {
    if (!suppressAutosave) {
      editedBeforeReady = true;
    }
    return;
  }
  if (suppressAutosave || !draftSession) {
    return;
  }
  const input = currentDraftInput();
  if (pendingConflict) {
    // Keep the pending choice paused; the latest text and edit time stay
    // available when the user explicitly resolves the conflict.
    pendingLocalEditAt = Date.now();
    return;
  }
  try {
    draftSession.scheduleSave(input);
  } catch (error: unknown) {
    showDraftSaveError(error);
  }
});

async function initialisePreferences(): Promise<void> {
  try {
    applyEditorPreferences(await getSettings());
  } catch (error: unknown) {
    if (statusNode) {
      setStatus(statusNode, {
        kind: "error",
        text: t("editor.status.settingsError", { error: String(error) })
      });
    }
  }
  unsubscribeSettings = subscribeSettings(applyEditorPreferences);
}

let languageSession: Session | null = null;
let languageProviders: { dispose(): void } | null = null;
let headerNavigation: { dispose(): void } | null = null;
let visibilityPause: { dispose(): void } | null = null;
let lastLanguageRequest: {
  profile: CompilerProfile;
  origin: "fixture" | "site";
} | null = null;
let languageRestartTimer: number | null = null;
let languageRestartAttempts = 0;
const MAX_LANGUAGE_RESTARTS = 3;

const FIXTURE_PROFILE =
  BUILTIN_PROFILES.codeforces.find(
    (profile) => profile.standard === "c++23" && profile.dialect === "c++"
  ) ?? BUILTIN_PROFILES.codeforces[0];

let standaloneStandard: Standard = "c++17";

function standaloneProfileFor(standard: Standard): CompilerProfile | null {
  return (
    BUILTIN_PROFILES.codeforces.find(
      (profile) => profile.standard === standard && profile.dialect === "c++"
    ) ??
    BUILTIN_PROFILES.codeforces.find(
      (profile) => profile.standard === standard
    ) ??
    FIXTURE_PROFILE ??
    null
  );
}

function standaloneProfileLookup(): SiteProfileLookup {
  const profile = standaloneProfileFor(standaloneStandard);
  return profile
    ? { kind: "profile", profile }
    : { kind: "missing", label: null };
}

function standaloneStandardCandidates(): Map<Standard, LanguageOptionInfo[]> {
  const candidates = new Map<Standard, LanguageOptionInfo[]>();
  for (const profile of BUILTIN_PROFILES.codeforces) {
    candidates.set(profile.standard, []);
  }
  return candidates;
}

function setLanguageStatus(kind: "info" | "error", text: string): void {
  if (statusNode) {
    setStatus(statusNode, { kind, text });
  }
}

function clearLanguageRestartTimer(): void {
  if (languageRestartTimer === null) return;
  window.clearTimeout(languageRestartTimer);
  languageRestartTimer = null;
}

function disposeLanguageServices(): void {
  clearLanguageRestartTimer();
  languageProviders?.dispose();
  languageProviders = null;
  headerNavigation?.dispose();
  headerNavigation = null;
  const session = languageSession;
  languageSession = null;
  if (session) {
    void session.dispose().catch(() => undefined);
  }
}

async function buildEngine(
  settings: Settings,
  backend: BackendChoice
): Promise<CompileEngine> {
  if (backend === "wasm") {
    const catalogue = await loadBundledCatalogue();
    const pack = catalogue.packs[0];
    if (!pack) {
      throw new Error("the catalogue has no toolchain pack");
    }
    return {
      targetTriple: pack.toolchain.targetTriple,
      sysroot: "/sysroot",
      includeDirectories: pack.toolchain.includeDirectories,
      noStdIncCxx: true
    };
  }
  return { includeDirectories: settings.extraIncludeDirs };
}

function scheduleLanguageReconnect(
  profile: CompilerProfile,
  origin: "fixture" | "site",
  reason: string
): void {
  if (languageRestartTimer !== null) return;
  if (languageRestartAttempts >= MAX_LANGUAGE_RESTARTS) {
    setLanguageStatus(
      "error",
      t("editor.status.lspClosedFinal", { reason })
    );
    return;
  }
  languageRestartAttempts += 1;
  const delay = Math.min(8_000, 500 * 2 ** (languageRestartAttempts - 1));
  setLanguageStatus(
    "info",
    t("editor.status.lspReconnecting", {
      attempt: languageRestartAttempts,
      max: MAX_LANGUAGE_RESTARTS
    })
  );
  languageRestartTimer = window.setTimeout(() => {
    languageRestartTimer = null;
    void startLanguageServices(profile, origin, true);
  }, delay);
}

async function startLanguageServices(
  profile: CompilerProfile,
  origin: "fixture" | "site",
  retry = false
): Promise<void> {
  if (!retry) languageRestartAttempts = 0;
  clearLanguageRestartTimer();
  const epoch = ++languageEpoch;
  lastLanguageRequest = { profile, origin };
  disposeLanguageServices();
  visibilityPause?.dispose();
  visibilityPause = null;
  if (!statusNode) {
    return;
  }
  if (!cppRegistered) {
    setLanguageStatus("error", t("editor.status.noCpp"));
    return;
  }

  let settings: Settings;
  try {
    settings = await getSettings();
  } catch (error: unknown) {
    if (epoch === languageEpoch) {
      setLanguageStatus(
        "error",
        t("editor.status.lspUnavailable", { error: String(error) })
      );
    }
    return;
  }
  if (epoch !== languageEpoch) {
    return;
  }
  const effectiveBackend = resolveEffectiveBackend(settings);
  if (effectiveBackend === null) {
    setLanguageStatus("info", t("editor.status.lspNotConfigured"));
    return;
  }
  if (effectiveBackend === "site") {
    // An explicit site-service choice never runs the local engine.
    setLanguageStatus("info", t("editor.site.remoteSiteStatus"));
    return;
  }
  if (
    origin === "site" &&
    siteContext !== null &&
    remoteBlocksLocal(siteRemoteState)
  ) {
    // Active, reload-pending, and undecidable page services all forbid a
    // competing local provider, even when a per-site WASM/native choice exists.
    reportRemoteBlocked(siteRemoteState);
    return;
  }
  if (effectiveBackend === "wasm") {
    visibilityPause = watchVisibilityPause({
      hiddenPauseMs: settings.hiddenPauseMs,
      onPause: async () => {
        languageEpoch += 1;
        disposeLanguageServices();
        setLanguageStatus("info", t("editor.status.lspPaused"));
      },
      onResume: async () => {
        if (lastLanguageRequest) {
          await startLanguageServices(
            lastLanguageRequest.profile,
            lastLanguageRequest.origin
          );
        }
      },
      onError: (error) => {
        setLanguageStatus("error", t("editor.status.lspError", {
          error: String(error)
        }));
      }
    });
  }
  setLanguageStatus("info", t("editor.status.lspConnecting"));

  let engine: CompileEngine;
  try {
    engine = await buildEngine(settings, effectiveBackend);
  } catch (error: unknown) {
    if (epoch === languageEpoch) {
      setLanguageStatus(
        "error",
        t("editor.status.dataMissing", { error: String(error) })
      );
    }
    return;
  }
  if (epoch !== languageEpoch) {
    return;
  }

  const sessionId = `${origin}:${crypto.randomUUID()}`;
  let backend: Backend | null = null;
  let created: Session | null = null;
  let providers: { dispose(): void } | null = null;
  let navigation: { dispose(): void } | null = null;
  try {
    backend = await openPortBackend(sessionId, effectiveBackend);
    if (epoch !== languageEpoch) {
      await backend.dispose().catch(() => undefined);
      return;
    }
    created = await createSession({
      backend,
      monaco,
      profile,
      engine,
      generation: ++languageGeneration,
      onStatus(status) {
        if (epoch !== languageEpoch || !statusNode) {
          return;
        }
        if (status.kind === "initialized") {
          languageRestartAttempts = 0;
          const readyText = t("editor.status.lspReady", {
            server: status.serverName ?? "clangd"
          });
          setStatus(statusNode, {
            kind: "info",
            text: siteProfileWarning
              ? `${siteProfileWarning} ${readyText}`
              : readyText
          });
        } else if (status.kind === "closed") {
          // The model and its text stay alive; reconnect a fresh session.
          disposeLanguageServices();
          scheduleLanguageReconnect(profile, origin, status.message);
        } else if (status.kind === "error") {
          setStatus(statusNode, {
            kind: "error",
            text: t("editor.status.lspError", { error: status.message })
          });
        }
      }
    });
    backend = null;
    if (epoch !== languageEpoch) {
      await created.dispose().catch(() => undefined);
      return;
    }
    created.bind(editor, model);
    providers = registerProviders(monaco, created, model);
    navigation = registerHeaderNavigation(monaco, created);
    languageSession = created;
    languageProviders = providers;
    headerNavigation = navigation;
  } catch (error: unknown) {
    providers?.dispose();
    navigation?.dispose();
    if (created) {
      void created.dispose().catch(() => undefined);
    } else if (backend) {
      void backend.dispose().catch(() => undefined);
    }
    if (epoch === languageEpoch) {
      setLanguageStatus(
        "error",
        t("editor.status.lspError", { error: String(error) })
      );
    }
  }
}

async function startFixtureLanguageServices(): Promise<void> {
  if (!FIXTURE_PROFILE) {
    return;
  }
  siteProfileWarning = null;
  await startLanguageServices(FIXTURE_PROFILE, "fixture");
}

async function startStandaloneLanguageServices(): Promise<void> {
  const profile = standaloneProfileFor(standaloneStandard);
  if (!profile) {
    setLanguageStatus(
      "error",
      t("editor.site.languageUnsupported", { label: standaloneStandard })
    );
    return;
  }
  siteProfileWarning = null;
  await startLanguageServices(profile, "fixture");
}

function siteFallbackText(warning: {
  readonly reason: "unsupported" | "unrecognized";
  readonly label: string;
}): string {
  return t(fallbackMessageKey(warning), { label: warning.label });
}

function reportSiteProfile(lookup: SiteProfileLookup): void {
  switch (lookup.kind) {
    case "profile":
      return;
    case "unsupported":
      setLanguageStatus(
        "error",
        t("editor.site.languageUnsupported", { label: lookup.label })
      );
      return;
    case "unrecognized":
      setLanguageStatus(
        "error",
        t("editor.site.languageUnknown", { label: lookup.label })
      );
      return;
    case "missing":
      setLanguageStatus("info", t("editor.site.languageMissing"));
      return;
  }
}

async function restartSiteLanguageServices(): Promise<void> {
  const context = siteContext;
  if (!context) {
    return;
  }
  if (currentSettings?.siteBackends[context.originKey] === "site") {
    stopLocalLanguageServices();
    siteProfileWarning = null;
    renderSiteUi();
    setLanguageStatus("info", t("editor.site.remoteSiteStatus"));
    return;
  }
  if (remoteBlocksLocal(siteRemoteState)) {
    stopLocalLanguageServices();
    siteProfileWarning = null;
    renderSiteUi();
    reportRemoteBlocked(siteRemoteState);
    return;
  }
  const lookup = resolveContextProfile(context);
  renderSiteUi();
  if (lookup.kind !== "profile") {
    siteProfileWarning = null;
    activeSiteProfileKey = null;
    languageEpoch += 1;
    disposeLanguageServices();
    reportSiteProfile(lookup);
    return;
  }
  siteProfileWarning = lookup.warning ? siteFallbackText(lookup.warning) : null;
  const key = profileKey(lookup.profile);
  if (key === activeSiteProfileKey) {
    if (siteProfileWarning) {
      setLanguageStatus("info", siteProfileWarning);
    }
    return;
  }
  activeSiteProfileKey = key;
  await startLanguageServices(lookup.profile, "site");
}

function enterSiteMode(context: SiteContext): void {
  const wasFixture = fixtureMode;
  const identity = siteContextIdentity(context);
  const identityChanged = siteIdentity !== identity;

  fixtureMode = false;
  standaloneMode = false;
  siteContext = context;
  siteIdentity = identity;
  siteOptionId = context.optionId;
  siteRemoteState = context.siteRemote;
  document.documentElement.dataset.maFixture = "0";
  editor.updateOptions({ ariaLabel: t("editor.site.ariaLabel") });
  renderHeading();

  if (wasFixture || identityChanged) {
    // Stop the previous draft and language session before replacing the model.
    closeDraftSession();
    activeSiteProfileKey = null;
    languageEpoch += 1;
    disposeLanguageServices();
  }

  if (wasFixture || identityChanged) {
    draftParts = {
      originKey: context.originKey,
      accountScope: context.accountScope,
      problemKey: context.problemKey,
      editorSlot: context.slot.slotId
    };
    siteBaseText = context.initialText;
    siteNativeText = context.initialText;
    lastSentSiteText = null;
    replaceModelText(context.initialText, {
      preserveUndo: false,
      autosave: false,
      broadcast: false
    });
    void initialiseDrafts();
  } else {
    const knownNative = siteNativeText;
    siteNativeText = context.initialText;
    if (context.initialText !== model.getValue()) {
      if (context.initialText !== knownNative) {
        if (model.getValue() === knownNative) {
          // The extension copy still matched the site, so the site may replace
          // it. An explicit native update keeps the normal undo history.
          replaceModelText(context.initialText, {
            preserveUndo: true,
            autosave: true,
            broadcast: false
          });
        } else {
          // The site changed while this editor held unsent text. Keep the
          // editor text and tell the user; never overwrite it silently.
          setLanguageStatus("info", t("editor.site.siteTextChanged"));
        }
      }
    }
  }

  if (remoteBlocksLocal(siteRemoteState)) {
    // The page may own the service now; stop the local engine before the
    // toolbar shows the blocked badge.
    stopLocalLanguageServices();
  }
  renderSiteUi();
  void restartSiteLanguageServices();
  postEditorMessage({
    __ma: SITE_PROTOCOL_MARKER,
    type: "ma/editor-ready-session"
  });
}

function handleLanguageOptions(
  optionId: string | null,
  options: LanguageOptionInfo[]
): void {
  const context = siteContext;
  if (!context) {
    return;
  }
  siteContext = { ...context, optionId, options };
  siteOptionId = optionId;
  renderSiteUi();
  void restartSiteLanguageServices();
}

function handleSiteRemote(state: SiteContext["siteRemote"]): void {
  const previous = siteRemoteState;
  siteRemoteState = state;
  if (siteContext) {
    siteContext = { ...siteContext, siteRemote: state };
  }
  if (remoteBlocksLocal(state)) {
    // Tear the local session down before the toolbar renders a blocked badge,
    // including a repeated blocked status after an interrupted startup.
    stopLocalLanguageServices();
  }
  renderSiteUi();
  if (previous === state) {
    return;
  }
  if (remoteBlocksLocal(state)) {
    reportRemoteBlocked(state);
    return;
  }
  void restartSiteLanguageServices();
}

async function handleLanguageChoice(
  standard: Standard,
  options: LanguageOptionInfo[]
): Promise<void> {
  if (!siteContext || siteLanguageChoiceOpen) {
    return;
  }
  siteLanguageChoiceOpen = true;
  try {
    const outcome = await chooseLanguageOption(standard, options);
    if (!siteContext) {
      return;
    }
    if (outcome.kind === "selected") {
      postEditorMessage({
        __ma: SITE_PROTOCOL_MARKER,
        type: "ma/editor-language-select",
        optionId: outcome.option.optionId
      });
      setLanguageStatus("info", t("editor.site.choiceSent"));
    } else if (outcome.kind === "unavailable") {
      setLanguageStatus("error", t("editor.site.choiceUnavailable"));
    }
    renderSiteUi();
  } catch (error: unknown) {
    setLanguageStatus(
      "error",
      t("editor.site.choiceError", { error: String(error) })
    );
  } finally {
    siteLanguageChoiceOpen = false;
  }
}

siteToolbarNodes.standardSelect.addEventListener("change", () => {
  const standard = siteToolbarNodes.standardSelect.value;
  if (!isStandard(standard)) {
    renderSiteUi();
    return;
  }
  if (standaloneMode && siteContext === null) {
    standaloneStandard = standard;
    renderSiteUi();
    void startStandaloneLanguageServices();
    return;
  }
  if (!siteContext) {
    renderSiteUi();
    return;
  }
  postEditorMessage({
    __ma: SITE_PROTOCOL_MARKER,
    type: "ma/editor-language-request",
    standard
  });
  setLanguageStatus(
    "info",
    t("editor.site.languageRequested", {
      standard: standardLabel(standard)
    })
  );
});

unlistenContent = listenToContent({
  onContext: enterSiteMode,
  onNativeText: handleNativeText,
  onLanguageOptions: handleLanguageOptions,
  onLanguageChoice: (standard, options) => {
    void handleLanguageChoice(standard, options);
  },
  onSiteRemote: handleSiteRemote
});

const LANGUAGE_KEEPALIVE_MS = 20_000;
const languageKeepalive = window.setInterval(() => {
  void chrome.runtime
    .sendMessage({ __ma: 1, type: "ma/keepalive" })
    .catch(() => undefined);
}, LANGUAGE_KEEPALIVE_MS);

window.addEventListener(
  "pagehide",
  () => {
    window.clearInterval(languageKeepalive);
    unlistenContent?.();
    unlistenContent = null;
    unsubscribeSettings?.();
    closeDraftSession();
    languageEpoch += 1;
    disposeLanguageServices();
  },
  { once: true }
);

renderHeading();
renderSiteUi();
if (!localMode()) {
  postEditorMessage({
    __ma: SITE_PROTOCOL_MARKER,
    type: "ma/editor-ready"
  });
}
void initialisePreferences();
if (localMode()) {
  void initialiseDrafts();
  if (fixtureMode) {
    void startFixtureLanguageServices();
  } else {
    void startStandaloneLanguageServices();
  }
}
editor.focus();
