/*
 * Editor boot entry.
 *
 * Monaco resolves its NLS strings while its modules are evaluated, so the
 * persisted extension locale must be known before that import. This tiny
 * bootstrap selects the language, then loads the real editor module.
 */

import { getSettings } from "../background/state.js";
import { getLocale, setLocale } from "../ui/i18n.js";
import { setMonacoLocale } from "./monaco-nls.js";

async function start(): Promise<void> {
  try {
    const settings = await getSettings();
    setLocale(settings.locale);
  } catch {
    setLocale("auto");
  }
  setMonacoLocale(getLocale());
  // @ts-expect-error editor.js is an esbuild output, not a TypeScript source.
  await import("./editor.js");
}

void start().catch((error: unknown) => {
  console.error("[MonacoAnywhere] Editor failed to start", error);
});
