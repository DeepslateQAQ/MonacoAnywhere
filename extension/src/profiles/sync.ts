/*
 * Pure standard <-> site-option selection helpers. These never touch the DOM;
 * the content script performs the actual control writes and echo suppression.
 */

import type { CompilerProfile, Standard } from "./types.js";

export interface SelectableLanguageOption {
  readonly optionId: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export type StandardProfileMatch =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly profile: CompilerProfile }
  | { readonly kind: "many"; readonly profiles: readonly CompilerProfile[] };

/**
 * Select profiles for a standard. Multiple site options commonly map to the
 * same standard (different compilers); the UI must ask the user to choose one
 * rather than silently taking the first.
 */
export function chooseProfileForStandard(
  profiles: readonly CompilerProfile[],
  standard: Standard
): StandardProfileMatch {
  const matches = profiles.filter((profile) => profile.standard === standard);
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) {
    const only = matches[0];
    return only ? { kind: "one", profile: only } : { kind: "none" };
  }
  return { kind: "many", profiles: matches };
}

export function findProfileByOptionId(
  profiles: readonly CompilerProfile[],
  optionId: string
): CompilerProfile | null {
  return profiles.find((profile) => profile.optionId === optionId) ?? null;
}

/**
 * Return the enabled site option matching a profile. Selection is exact by
 * optionId; labels are display-only and may contain compiler versions.
 */
export function selectOption<T extends SelectableLanguageOption>(
  options: readonly T[],
  profile: CompilerProfile
): T | null {
  for (const option of options) {
    if (option.disabled) continue;
    if (option.optionId === profile.optionId) return option;
  }
  return null;
}

export interface ProfileSelection {
  readonly profile: CompilerProfile;
  readonly optionId: string;
}

/**
 * Convenience for a single-select site control. It deliberately refuses an
 * ambiguous standard and reports whether the site needs a user choice.
 */
export function selectOptionForStandard<T extends SelectableLanguageOption>(
  options: readonly T[],
  profiles: readonly CompilerProfile[],
  standard: Standard
): StandardProfileMatch | ProfileSelection {
  const match = chooseProfileForStandard(profiles, standard);
  if (match.kind !== "one") return match;
  const option = selectOption(options, match.profile);
  if (!option) return match;
  return { profile: match.profile, optionId: option.optionId };
}
