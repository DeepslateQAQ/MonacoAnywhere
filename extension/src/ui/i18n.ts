/*
 * Shared UI localization.
 *
 * Supported locales are Simplified Chinese and English. The default follows
 * the browser's ordered language preferences; stored explicit settings are
 * applied by the extension pages through setLocale().
 */
import { messages as en } from "./messages.en.js";
import type { MessageKey } from "./messages.en.js";
import { messages as zhCN } from "./messages.zh-CN.js";

export type { MessageKey };
export type SupportedLocale = "zh-CN" | "en";
export type LocalePreference = SupportedLocale | "auto";

const TABLES: Record<SupportedLocale, Readonly<Record<MessageKey, string>>> = {
  en,
  "zh-CN": zhCN
};

let currentLocale: SupportedLocale = detectBrowserLocale();

/**
 * Pick the first supported browser language, falling back to English.
 * Chinese variants all map to the maintained zh-CN translation.
 */
export function resolveLocale(
  languages: readonly string[] | undefined
): SupportedLocale {
  for (const language of languages ?? []) {
    const normalized = language.trim().toLowerCase();
    if (normalized === "zh" || normalized.startsWith("zh-")) {
      return "zh-CN";
    }
    if (normalized === "en" || normalized.startsWith("en-")) {
      return "en";
    }
  }
  return "en";
}

export function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  const languages =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  return resolveLocale(languages);
}

/**
 * Replace `{name}` placeholders with literal values. Unknown placeholders are
 * left intact so a missing variable is visible during development.
 */
export function formatMessage(
  template: string,
  vars?: Readonly<Record<string, string | number>>
): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder: string, name: string) => {
    const value = vars[name];
    return value === undefined ? placeholder : String(value);
  });
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

/**
 * Apply an explicit locale or re-follow the browser for "auto". When a
 * document exists, static `data-i18n*` nodes are updated in place.
 */
export function setLocale(locale: LocalePreference): SupportedLocale {
  currentLocale =
    locale === "zh-CN" || locale === "en" ? locale : detectBrowserLocale();

  if (typeof document !== "undefined") {
    document.documentElement.lang = currentLocale;
    localizeDocument(document);
  }

  return currentLocale;
}

export function t(
  key: MessageKey,
  vars?: Readonly<Record<string, string | number>>
): string {
  const template = TABLES[currentLocale][key] ?? en[key];
  return template === undefined ? key : formatMessage(template, vars);
}

const LOCALIZED_ATTRIBUTES: ReadonlyArray<
  readonly [selector: string, attribute: string]
> = [
  ["[data-i18n-placeholder]", "placeholder"],
  ["[data-i18n-aria-label]", "aria-label"],
  ["[data-i18n-title]", "title"]
];

/**
 * Localize static markup without parsing HTML. Elements opt in with
 * data-i18n for textContent, or one of the attribute-specific variants.
 */
export function localizeDocument(root?: ParentNode): void {
  if (typeof document === "undefined") {
    return;
  }
  const scope = root ?? document;

  for (const element of scope.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) {
      element.textContent = t(key as MessageKey);
    }
  }

  for (const [selector, attribute] of LOCALIZED_ATTRIBUTES) {
    for (const element of scope.querySelectorAll<HTMLElement>(selector)) {
      const key = element.getAttribute(selector.slice(1, -1));
      if (key) {
        element.setAttribute(attribute, t(key as MessageKey));
      }
    }
  }
}
