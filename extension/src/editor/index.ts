/*
 * Monaco bootstrap page.
 *
 * This page is the future replacement-editor iframe, but in this slice it is a
 * real, usable Monaco fixture: typing, undo, find, and C++ syntax highlighting
 * work. There is deliberately no language-service session and no site adapter.
 * The status bar says so; it never claims engine or OOBE readiness.
 */

import * as monaco from "monaco-editor";

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
  ariaLabel: "MonacoAnywhere C++ editor fixture"
});

document.documentElement.dataset.maBuildMode = __MA_BUILD_MODE__;
document.documentElement.dataset.maFixture = "1";

const status = document.getElementById("ma-editor-status");
if (status) {
  status.textContent = __MA_BOOTSTRAP__
    ? "Language services unavailable — bootstrap build. Editing and C++ syntax highlighting work; there is no clangd engine, data pack, or OOBE validation in this slice."
    : "Language services unavailable — this skeleton build has no LSP session. Editing and C++ syntax highlighting work; engine integration is not part of this slice.";
}
if (status && !cppRegistered) {
  status.textContent =
    "Syntax highlighting is unavailable because the cpp language definition did not register; editing still works. Language services are not implemented in this build.";
}

const title = document.getElementById("ma-editor-title");
if (title) {
  title.textContent = `MonacoAnywhere ${__MA_BUILD_VERSION__} · ${__MA_BUILD_MODE__} fixture`;
}

editor.focus();
