/*
 * Central settings for MonacoAnywhere.
 *
 * `settings:v1` is the single source of truth shared by the service worker,
 * onboarding, options, popup, and editor pages. Reads normalize hostile or
 * partially written values; writes are serialized read-modify-write operations
 * that merge only validated fields, so concurrent partial patches cannot
 * clobber each other.
 *
 * `onboardingComplete` is deliberately not patchable through updateSettings.
 * Only markOnboardingComplete(), called after a real fixture validation, may
 * set it. Changing the backend invalidates a previous completion.
 */

export type BackendChoice = "wasm" | "native";
export type SiteBackend = BackendChoice | "site";
export type ThemePreference = "system" | "light" | "dark";
export type LocalePreference = "auto" | "zh-CN" | "en";

export interface Settings {
  backend: BackendChoice | null;
  siteBackends: Record<string, SiteBackend>;
  theme: ThemePreference;
  locale: LocalePreference;
  hiddenPauseMs: number;
  clangdPath?: string;
  queryDriverAllowlist: string[];
  extraIncludeDirs: string[];
  editorFontFamily: string;
  editorTheme: string;
  onboardingComplete: boolean;
}

export const SETTINGS_STORAGE_KEY = "settings:v1";
export const MIN_HIDDEN_PAUSE_MS = 1_000;
export const MAX_HIDDEN_PAUSE_MS = 86_400_000;

const SETTINGS_LOCK_NAME = "monacoanywhere:settings:v1";
const DEFAULT_EDITOR_FONT_FAMILY = '"IBM Plex Mono", Consolas, monospace';
const DEFAULT_EDITOR_THEME = "vs-dark";
const MAX_LIST_ITEMS = 128;
const MAX_LIST_ENTRY_LENGTH = 1_024;
const MAX_TEXT_SETTING_LENGTH = 1_024;
const MAX_SITE_BACKENDS = 512;
const MAX_SITE_ORIGIN_KEY_LENGTH = 2_048;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze<Settings>({
  backend: null,
  siteBackends: Object.freeze({}) as Record<string, SiteBackend>,
  theme: "system",
  locale: "auto",
  hiddenPauseMs: 30_000,
  queryDriverAllowlist: Object.freeze([]) as unknown as string[],
  extraIncludeDirs: Object.freeze([]) as unknown as string[],
  editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
  editorTheme: DEFAULT_EDITOR_THEME,
  onboardingComplete: false
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBackendChoice(value: unknown): value is BackendChoice {
  return value === "wasm" || value === "native";
}

function isSiteBackend(value: unknown): value is SiteBackend {
  return isBackendChoice(value) || value === "site";
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "auto" || value === "zh-CN" || value === "en";
}

function isSiteOriginKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SITE_ORIGIN_KEY_LENGTH &&
    /^https?:\/\/[^\s]+$/i.test(value)
  );
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  const limit = Math.min(value.length, MAX_LIST_ITEMS * 8);
  for (let index = 0; index < limit; index += 1) {
    const item = value[index];
    if (typeof item !== "string") {
      continue;
    }
    const entry = item.trim();
    if (
      entry.length === 0 ||
      entry.length > MAX_LIST_ENTRY_LENGTH ||
      seen.has(entry)
    ) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
    if (result.length >= MAX_LIST_ITEMS) {
      break;
    }
  }
  return result;
}

function normalizeSiteBackends(value: unknown): Record<string, SiteBackend> {
  if (!isPlainRecord(value)) {
    return {};
  }
  const entries: Array<[string, SiteBackend]> = [];
  for (const key of Object.keys(value).sort()) {
    const candidate = value[key];
    if (!isSiteOriginKey(key) || !isSiteBackend(candidate)) {
      continue;
    }
    entries.push([key, candidate]);
    if (entries.length >= MAX_SITE_BACKENDS) {
      break;
    }
  }
  return Object.fromEntries(entries) as Record<string, SiteBackend>;
}

function normalizeTextSetting(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT_SETTING_LENGTH
    ? trimmed
    : fallback;
}

function normalizeBackend(value: unknown): BackendChoice | null {
  return isBackendChoice(value) ? value : null;
}

function normalizeHiddenPause(value: unknown): number {
  return Number.isInteger(value) &&
    (value as number) >= MIN_HIDDEN_PAUSE_MS &&
    (value as number) <= MAX_HIDDEN_PAUSE_MS
    ? (value as number)
    : DEFAULT_SETTINGS.hiddenPauseMs;
}

/**
 * Turn any stored or patch value into a complete, honest Settings object.
 * Unknown fields are dropped; invalid fields fall back to defaults (stored
 * data) or are ignored by updateSettings (patches).
 */
export function normalizeSettings(value: unknown): Settings {
  const source = isPlainRecord(value) ? value : {};
  const backend = normalizeBackend(source.backend);
  const clangdPath =
    typeof source.clangdPath === "string" ? source.clangdPath.trim() : "";
  const result: Settings = {
    backend,
    siteBackends: normalizeSiteBackends(source.siteBackends),
    theme: isThemePreference(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    locale: isLocalePreference(source.locale)
      ? source.locale
      : DEFAULT_SETTINGS.locale,
    hiddenPauseMs: normalizeHiddenPause(source.hiddenPauseMs),
    queryDriverAllowlist: normalizeStringList(source.queryDriverAllowlist),
    extraIncludeDirs: normalizeStringList(source.extraIncludeDirs),
    editorFontFamily: normalizeTextSetting(
      source.editorFontFamily,
      DEFAULT_SETTINGS.editorFontFamily
    ),
    editorTheme: normalizeTextSetting(
      source.editorTheme,
      DEFAULT_SETTINGS.editorTheme
    ),
    // A completion with no selected backend cannot correspond to a real
    // validation, so it is discarded rather than advertised.
    onboardingComplete: source.onboardingComplete === true && backend !== null
  };
  if (clangdPath.length > 0 && clangdPath.length <= MAX_TEXT_SETTING_LENGTH) {
    result.clangdPath = clangdPath;
  }
  return result;
}

function applyPatch(current: Settings, patch: Partial<Settings>): Settings {
  if (!isPlainRecord(patch)) {
    return current;
  }

  const next: Settings = {
    ...current,
    siteBackends: { ...current.siteBackends },
    queryDriverAllowlist: [...current.queryDriverAllowlist],
    extraIncludeDirs: [...current.extraIncludeDirs]
  };
  const source = patch as Record<string, unknown>;

  const backendCandidate = source.backend;
  if (backendCandidate === null || isBackendChoice(backendCandidate)) {
    next.backend = backendCandidate;
  }
  const siteCandidates = source.siteBackends;
  if (isPlainRecord(siteCandidates)) {
    for (const key of Object.keys(siteCandidates)) {
      if (!isSiteOriginKey(key)) {
        continue;
      }
      const candidate = siteCandidates[key];
      if (candidate === undefined) {
        delete next.siteBackends[key];
      } else if (isSiteBackend(candidate)) {
        next.siteBackends[key] = candidate;
      }
    }
    next.siteBackends = normalizeSiteBackends(next.siteBackends);
  }
  const themeCandidate = source.theme;
  if (isThemePreference(themeCandidate)) {
    next.theme = themeCandidate;
  }
  const localeCandidate = source.locale;
  if (isLocalePreference(localeCandidate)) {
    next.locale = localeCandidate;
  }
  if (
    Number.isInteger(source.hiddenPauseMs) &&
    (source.hiddenPauseMs as number) >= MIN_HIDDEN_PAUSE_MS &&
    (source.hiddenPauseMs as number) <= MAX_HIDDEN_PAUSE_MS
  ) {
    next.hiddenPauseMs = source.hiddenPauseMs as number;
  }
  if (Object.prototype.hasOwnProperty.call(source, "clangdPath")) {
    const raw = source.clangdPath;
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length > 0 && trimmed.length <= MAX_TEXT_SETTING_LENGTH) {
      next.clangdPath = trimmed;
    } else {
      delete next.clangdPath;
    }
  }
  const queryCandidate = source.queryDriverAllowlist;
  if (Array.isArray(queryCandidate)) {
    next.queryDriverAllowlist = normalizeStringList(queryCandidate);
  }
  const includeCandidate = source.extraIncludeDirs;
  if (Array.isArray(includeCandidate)) {
    next.extraIncludeDirs = normalizeStringList(includeCandidate);
  }
  const fontCandidate = source.editorFontFamily;
  if (typeof fontCandidate === "string") {
    next.editorFontFamily = normalizeTextSetting(
      fontCandidate,
      current.editorFontFamily
    );
  }
  const editorThemeCandidate = source.editorTheme;
  if (typeof editorThemeCandidate === "string") {
    next.editorTheme = normalizeTextSetting(
      editorThemeCandidate,
      current.editorTheme
    );
  }

  // onboardingComplete is intentionally not copied from the patch.
  if (
    next.backend !== current.backend &&
    current.onboardingComplete
  ) {
    next.onboardingComplete = false;
  }
  return next;
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function settingsEqual(a: Settings, b: Settings): boolean {
  if (
    a.backend !== b.backend ||
    a.theme !== b.theme ||
    a.locale !== b.locale ||
    a.hiddenPauseMs !== b.hiddenPauseMs ||
    (a.clangdPath ?? "") !== (b.clangdPath ?? "") ||
    a.editorFontFamily !== b.editorFontFamily ||
    a.editorTheme !== b.editorTheme ||
    a.onboardingComplete !== b.onboardingComplete ||
    !sameStringArray(a.queryDriverAllowlist, b.queryDriverAllowlist) ||
    !sameStringArray(a.extraIncludeDirs, b.extraIncludeDirs)
  ) {
    return false;
  }
  const aKeys = Object.keys(a.siteBackends).sort();
  const bKeys = Object.keys(b.siteBackends).sort();
  if (!sameStringArray(aKeys, bKeys)) {
    return false;
  }
  return aKeys.every((key) => a.siteBackends[key] === b.siteBackends[key]);
}

async function readStoredSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
}

let localWriteChain: Promise<unknown> = Promise.resolve();

function withLocalQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = localWriteChain.then(task, task);
  localWriteChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Serialize read-modify-write across extension contexts. Chromium exposes the
 * Web Locks API to service workers and extension pages, which makes this a
 * genuine cross-page critical section; the module queue is a same-context
 * fallback for environments without Web Locks (tests).
 */
async function withSettingsLock<T>(task: () => Promise<T>): Promise<T> {
  const lockManager =
    typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (lockManager && typeof lockManager.request === "function") {
    return lockManager.request(SETTINGS_LOCK_NAME, { mode: "exclusive" }, () =>
      task()
    );
  }
  return withLocalQueue(task);
}

/**
 * Read the normalized settings. Malformed storage yields honest defaults;
 * an actual chrome.storage failure rejects so callers can surface it.
 */
export async function getSettings(): Promise<Settings> {
  return readStoredSettings();
}

/**
 * Merge a validated partial patch into the latest stored settings.
 *
 * Atomic and concurrency-safe: the read and write happen inside a cross-context
 * lock, so two callers patching different fields cannot overwrite each other.
 * Invalid patch fields are ignored; `clangdPath: undefined` or "" clears it.
 * A backend change drops a stale onboarding completion.
 */
export async function updateSettings(
  patch: Partial<Settings>
): Promise<Settings> {
  return withSettingsLock(async () => {
    const current = await readStoredSettings();
    const next = applyPatch(current, patch);
    if (!settingsEqual(current, next)) {
      await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
    }
    return next;
  });
}

/**
 * Subscribe to settings changes from every extension context. The callback is
 * not invoked immediately; call getSettings() for the initial value.
 */
export function subscribeSettings(
  callback: (settings: Settings) => void
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: chrome.storage.AreaName
  ): void => {
    if (
      areaName !== "local" ||
      !Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY)
    ) {
      return;
    }
    callback(normalizeSettings(changes[SETTINGS_STORAGE_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Record a real successful fixture validation. This is the only function that
 * sets onboardingComplete; callers must have observed an actual LSP completion
 * from the selected backend. Passing validatedBackend guards against a
 * concurrent backend change between validation and completion.
 */
export async function markOnboardingComplete(
  validatedBackend?: BackendChoice
): Promise<Settings> {
  return withSettingsLock(async () => {
    const current = await readStoredSettings();
    if (current.backend === null) {
      throw new Error("Cannot complete onboarding without a selected backend.");
    }
    if (validatedBackend !== undefined && current.backend !== validatedBackend) {
      throw new Error(
        "The backend changed after validation; validate it again before completing setup."
      );
    }
    const next: Settings = { ...current, onboardingComplete: true };
    if (!settingsEqual(current, next)) {
      await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
    }
    return next;
  });
}

/** Explicitly clear completion (for example, after a settings reset). */
export async function clearOnboardingCompletion(): Promise<Settings> {
  return withSettingsLock(async () => {
    const current = await readStoredSettings();
    const next: Settings = { ...current, onboardingComplete: false };
    if (!settingsEqual(current, next)) {
      await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
    }
    return next;
  });
}
