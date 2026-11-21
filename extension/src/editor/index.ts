/*
 * Monaco fixture page.
 *
 * Editing, undo, find, and C++ syntax highlighting are real. There is no
 * language-service session and no site adapter: the status bar says so and
 * never claims engine or OOBE readiness.
 *
 * Local draft autosave uses the shared IndexedDB draft layer only. The fixture
 * has no site account, so it uses the literal "anon" scope and null site
 * comparison fields. Restoring is an explicit prompt; a cross-tab conflict
 * opens a comparison dialog and never overwrites without a user choice.
 */

import * as monaco from "monaco-editor";

import {
  DEFAULT_SETTINGS,
  getSettings,
  subscribeSettings,
  type Settings
} from "../background/state.js";
import {
  openDraftSession,
  type DraftConflict,
  type DraftConflictChoice,
  type DraftRecord,
  type DraftSaveInput,
  type DraftSaveResult,
  type DraftSession,
  type DraftSessionEvent
} from "../data/drafts.js";
import { getLocale, setLocale, t } from "../ui/i18n.js";
import { el, openDialog, setStatus } from "../ui/primitives.js";

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

// The fixture has no OJ page, so the draft key uses the extension origin, the
// literal anonymous account scope, a fixture problem key, and one slot.
const DRAFT_PARTS = {
  originKey: location.origin,
  accountScope: "anon",
  problemKey: "fixture",
  editorSlot: "main"
} as const;

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

const model = monaco.editor.createModel(
  FIXTURE,
  cppRegistered ? "cpp" : "plaintext",
  monaco.Uri.parse("file:///workspace/fixture/main.cpp")
);

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

const editor = monaco.editor.create(container, {
  model,
  theme: prefersDark ? "vs-dark" : "vs",
  automaticLayout: true,
  fontFamily: DEFAULT_SETTINGS.editorFontFamily,
  fontSize: 14,
  lineHeight: 22,
  tabSize: 4,
  insertSpaces: true,
  minimap: { enabled: true, renderCharacters: false },
  scrollBeyondLastLine: false,
  fixedOverflowWidgets: true,
  padding: { top: 12, bottom: 12 },
  renderWhitespace: "selection",
  ariaLabel: t("editor.ariaLabel")
});

document.documentElement.dataset.maBuildMode = __MA_BUILD_MODE__;
document.documentElement.dataset.maFixture = "1";

const statusNode = document.getElementById("ma-editor-status");
const draftStatusNode = document.getElementById("ma-editor-draft-status");
const draftScopeNode = document.getElementById("ma-editor-draft-scope");
const draftCheckButton = document.getElementById(
  "ma-draft-check"
) as HTMLButtonElement | null;

if (statusNode) {
  setStatus(statusNode, {
    kind: "info",
    text: t("editor.status.initial")
  });
}

let draftSession: DraftSession | null = null;
let draftReady = false;
let editedBeforeReady = false;
let suppressAutosave = false;
let pendingConflict: DraftConflict | null = null;
let pendingLocalEditAt = 0;
let conflictDialogOpen = false;
let draftAction: (() => void) | null = null;
let unsubscribeDraft: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;

function buildModeLabel(): string {
  return t(
    __MA_BOOTSTRAP__ ? "build.mode.bootstrap" : "build.mode.production"
  );
}

function renderHeading(): void {
  const title = document.getElementById("ma-editor-title");
  if (title) {
    title.textContent = t("editor.heading", {
      version: __MA_BUILD_VERSION__,
      mode: buildModeLabel()
    });
  }
  if (draftScopeNode) {
    draftScopeNode.textContent = t("editor.draft.scopeAnon");
  }
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

function setDraftStatus(kind: "info" | "error", text: string): void {
  if (!draftStatusNode) {
    return;
  }
  setStatus(draftStatusNode, { kind, text });
  draftStatusNode.hidden = text.length === 0;
}

function setDraftAction(
  label: string | null,
  action: (() => void) | null
): void {
  draftAction = action;
  if (!draftCheckButton) {
    return;
  }
  draftCheckButton.hidden = label === null;
  draftCheckButton.textContent = label ?? "";
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

  editor.updateOptions({
    fontFamily:
      settings.editorFontFamily.trim() || DEFAULT_SETTINGS.editorFontFamily,
    ariaLabel: t("editor.ariaLabel")
  });
  renderHeading();
  if (themeApplied) {
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
  return {
    code: model.getValue(),
    languageOptionId: null,
    siteEditorValue: null,
    baseSiteValue: null
  };
}

function applyDraftText(text: string): void {
  if (model.getValue() === text) {
    return;
  }
  suppressAutosave = true;
  try {
    editor.executeEdits("ma-draft", [
      { range: model.getFullModelRange(), text }
    ]);
    editor.pushUndoStop();
  } finally {
    suppressAutosave = false;
  }
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
        {
          class: "ma-choice m3e-radio-button",
          style: {
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            padding: "8px 0"
          }
        },
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
    setDraftAction(null, null);
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
      setDraftStatus("error", t("editor.draft.conflictStale"));
      setDraftAction(t("editor.draft.resolve"), () => {
        void showConflict(result.conflict);
      });
      return;
    }

    pendingConflict = null;
    pendingLocalEditAt = 0;
    setDraftAction(null, null);
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
    setDraftStatus(
      "error",
      t("editor.draft.saveError", { error: String(error) })
    );
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
  setDraftAction(t("editor.draft.resolve"), () => {
    if (pendingConflict) {
      void showConflict(pendingConflict);
    }
  });
  setDraftStatus("error", t("editor.draft.deferred"));

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
      setDraftStatus("error", t("editor.draft.deferred"));
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
    setDraftStatus(
      "error",
      t("editor.draft.saveError", { error: String(error) })
    );
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
      setDraftAction(null, null);
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
      setDraftStatus("error", t("editor.draft.leaseLost"));
      setDraftAction(t("editor.draft.retrySave"), () => {
        void retrySave();
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
    setDraftStatus(
      "error",
      t("editor.draft.saveError", { error: String(error) })
    );
  }
}

async function initialiseDrafts(): Promise<void> {
  draftReady = false;
  setDraftAction(null, null);
  let session: DraftSession | null = null;
  try {
    session = await openDraftSession(DRAFT_PARTS, {
      onError: (error: unknown) => {
        setDraftStatus(
          "error",
          t("editor.draft.saveError", { error: String(error) })
        );
        setDraftAction(t("editor.draft.retrySave"), () => {
          void retrySave();
        });
      }
    });
    const stored = await session.load();
    if (stored) {
      session.adopt(stored);
      if (stored.code !== model.getValue()) {
        const accepted = await openDialog(
          t("editor.draft.restoreTitle"),
          el("div", { style: { display: "grid", gap: "12px" } }, [
            el("p", {}, [
              t("editor.draft.restoreBody", {
                time: formatTime(stored.updatedAt)
              })
            ]),
            previewPane(t("editor.draft.previewOther"), stored)
          ]),
          {
            confirm: t("editor.draft.restore"),
            cancel: t("editor.draft.useFixture")
          }
        );
        if (accepted) {
          applyDraftText(stored.code);
          setDraftStatus("info", t("editor.draft.restored"));
        } else {
          setDraftStatus("info", t("editor.draft.discarded"));
        }
      } else {
        setDraftStatus("info", t("editor.draft.unchanged"));
      }
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
    draftSession = null;
    draftReady = false;
    setDraftStatus(
      "error",
      t("editor.draft.loadError", { error: String(error) })
    );
    setDraftAction(t("editor.draft.retrySave"), () => {
      void initialiseDrafts();
    });
  }
}

model.onDidChangeContent(() => {
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
    setDraftStatus(
      "error",
      t("editor.draft.saveError", { error: String(error) })
    );
  }
});

draftCheckButton?.addEventListener("click", () => {
  draftAction?.();
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

window.addEventListener(
  "pagehide",
  () => {
    unsubscribeSettings?.();
    unsubscribeDraft?.();
  },
  { once: true }
);

renderHeading();
void initialisePreferences();
void initialiseDrafts();
editor.focus();
