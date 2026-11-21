/*
 * Build-time constants shared by separately bundled extension entries.
 *
 * Settings and draft types live in their real modules (background/state.ts and
 * data/drafts.ts); this file intentionally declares no duplicate shapes.
 */

declare const __MA_BUILD_MODE__: "bootstrap" | "production";
declare const __MA_BOOTSTRAP__: boolean;
declare const __MA_BUILD_VERSION__: string;
