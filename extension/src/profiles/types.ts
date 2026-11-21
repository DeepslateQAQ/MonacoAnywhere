/*
 * Language standards and compiler profiles shared by every OJ adapter.
 *
 * A profile describes the semantics promised to the language service, not the
 * exact judge image: the selected toolchain supplies the standard library and
 * headers, while the profile supplies the standard, dialect and site macros.
 */

export const STANDARDS = [
  "c++98",
  "c++03",
  "c++11",
  "c++14",
  "c++17",
  "c++20",
  "c++23"
] as const;

export type Standard = (typeof STANDARDS)[number];

/**
 * Standards that may appear in site language lists but are deliberately not
 * available as a language-service target. C++26 is shown read-only in the UI.
 */
export const UNSUPPORTED_STANDARDS = ["c++26"] as const;
export type UnsupportedStandard = (typeof UNSUPPORTED_STANDARDS)[number];
export type AnyStandard = Standard | UnsupportedStandard;

export type CppDialect = "c++" | "gnu++";

export type ProfileVerification = "official" | "partial" | "unverified";

export interface ProfileProvenance {
  /** Human-readable source: URL plus revision date when available. */
  readonly source: string;
  /**
   * official: published command line for this exact option.
   * partial: published mapping that changes over time or whose toolchain differs.
   * unverified: runtime/community data; never claims judge parity.
   */
  readonly verified: ProfileVerification;
  readonly note?: string;
}

export interface CompilerProfile {
  /** Stable id persisted in drafts and settings. */
  readonly id: string;
  readonly standard: Standard;
  readonly dialect: CppDialect;
  /** Site language name, displayed verbatim. */
  readonly label: string;
  /** Site language control value. */
  readonly optionId: string;
  /** Semantic compile arguments, without -x/-std (added by the generator). */
  readonly args: readonly string[];
  readonly defines: Readonly<Record<string, string>>;
  /** Bare macro names, equivalent to -D<macro>. */
  readonly macros: readonly string[];
  readonly provenance: ProfileProvenance;
}

const STANDARD_SET: ReadonlySet<string> = new Set(STANDARDS);
const UNSUPPORTED_SET: ReadonlySet<string> = new Set(UNSUPPORTED_STANDARDS);

export function isStandard(value: unknown): value is Standard {
  return typeof value === "string" && STANDARD_SET.has(value);
}

export function isUnsupportedStandard(
  value: unknown
): value is UnsupportedStandard {
  return typeof value === "string" && UNSUPPORTED_SET.has(value);
}

export function standardNumber(standard: AnyStandard): string {
  return standard.slice("c++".length);
}

export function standardLabel(standard: AnyStandard): string {
  return `C++${standardNumber(standard)}`;
}

export type StandardMatch =
  | { readonly standard: Standard; readonly supported: true }
  | { readonly standard: UnsupportedStandard; readonly supported: false };

/**
 * Extract a C++ standard from arbitrary site text. Only explicit C++/GNU++
 * markers count; a compiler version by itself (for example "GCC 15.2.0") is
 * never treated as a standard or as evidence for the GNU dialect.
 */
export function parseStandard(text: string): StandardMatch | null {
  const match = /(?:GNU\+\+|C\+\+)\s*(98|03|11|14|17|20|23|26)\b/i.exec(text);
  if (!match) return null;
  const suffix = match[1];
  if (!suffix) return null;
  const standard = `c++${suffix}`;
  if (isStandard(standard)) return { standard, supported: true };
  if (isUnsupportedStandard(standard)) {
    return { standard, supported: false };
  }
  return null;
}

export function parseSupportedStandard(text: string): Standard | null {
  const match = parseStandard(text);
  return match?.supported ? match.standard : null;
}
