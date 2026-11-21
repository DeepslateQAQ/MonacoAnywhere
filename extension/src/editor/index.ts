/*
 * Monaco bootstrap page.
 *
 * This page is the future replacement-editor iframe, but in this slice it is a
 * real, usable Monaco fixture: typing, undo, find, and C++ syntax highlighting
 * work. There is deliberately no language-service session and no site adapter.
 * The status bar says so; it never claims engine or OOBE readiness.
 */

import * as monaco from "monaco-editor";

import { setLocale, t } from "../ui/i18n.js";
import { setStatus } from "../ui/primitives.js";

const SETTINGS_KEY = "settings:v1";

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

// Localize static markup immediately; stored preferences refine this below.
setLocale("auto");

const container = document.querySelector<HTMLElement>("[data-monaco-anywhere-editor]");
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
  fontFamily: '"IBM Plex Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
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
if (statusNode) {
  setStatus(statusNode, {
    kind: "info",
    text: t("editor.status.initial")
  });
}

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
}

renderHeading();

function renderStatus(): void {
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

async function readUiPreferences(): Promise<{ locale: MaLocale; theme: MaTheme }> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const raw: unknown = stored[SETTINGS_KEY];
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const value = raw as Partial<MaSettings>;
      return {
        locale:
          value.locale === "zh-CN" ||
          value.locale === "en" ||
          value.locale === "auto"
            ? value.locale
            : "auto",
        theme:
          value.theme === "light" ||
          value.theme === "dark" ||
          value.theme === "system"
            ? value.theme
            : "system"
      };
    }
  } catch {
    // Storage is optional for rendering; browser defaults remain in effect.
  }
  return { locale: "auto", theme: "system" };
}

async function localizePage(): Promise<void> {
  const preferences = await readUiPreferences();
  setLocale(preferences.locale);
  applyThemePreference(preferences.theme);
  renderHeading();
  editor.updateOptions({ ariaLabel: t("editor.ariaLabel") });
  renderStatus();
}

void localizePage();
editor.focus();
