/*
 * Monaco UI localization.
 *
 * Monaco reads its built-in UI strings (context menu, find widget, quick input)
 * from `_VSCODE_NLS_MESSAGES` / `_VSCODE_NLS_LANGUAGE` while its modules are
 * evaluated. The boot entry therefore applies the language before dynamically
 * importing the editor. The extension ships Monaco's Simplified Chinese NLS
 * table and falls back to Monaco's inline English strings for other locales.
 */

import "monaco-editor/nls/lang/zh-cn.js";

type NlsGlobal = typeof globalThis & {
  _VSCODE_NLS_MESSAGES?: string[];
  _VSCODE_NLS_LANGUAGE?: string;
};

const nlsGlobal = globalThis as NlsGlobal;
const chineseMessages = [...(nlsGlobal._VSCODE_NLS_MESSAGES ?? [])];

/** Apply a Monaco NLS language. Must run before Monaco modules evaluate. */
export function setMonacoLocale(locale: string): void {
  if (locale.toLowerCase().startsWith("zh")) {
    nlsGlobal._VSCODE_NLS_MESSAGES = chineseMessages;
    nlsGlobal._VSCODE_NLS_LANGUAGE = "zh-cn";
    return;
  }
  delete nlsGlobal._VSCODE_NLS_MESSAGES;
  delete nlsGlobal._VSCODE_NLS_LANGUAGE;
}
