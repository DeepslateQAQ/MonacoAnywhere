/*
 * Map the site language list reported by the content script onto the shared
 * compiler-profile registry.
 *
 * The live site option label is authoritative. A selected option that cannot
 * be mapped stays unmapped: language services are disabled and the UI says so
 * instead of guessing a standard, dialect, or compiler.
 */

import { resolveSiteOptions } from "../profiles/builtin.js";
import {
  parseStandard,
  type CompilerProfile,
  type Standard
} from "../profiles/types.js";
import type { LanguageOptionInfo, SiteContext } from "../shared/site-protocol.js";

export type SiteProfileLookup =
  | { readonly kind: "profile"; readonly profile: CompilerProfile }
  | { readonly kind: "unsupported"; readonly label: string }
  | { readonly kind: "unrecognized"; readonly label: string }
  | { readonly kind: "missing"; readonly label: string | null };

function genericProfile(
  option: LanguageOptionInfo,
  standard: Standard
): CompilerProfile {
  return {
    id: `generic:${option.optionId}:${standard}-cxx`,
    standard,
    dialect: "c++",
    label: option.label,
    optionId: option.optionId,
    args: [],
    defines: {},
    macros: [],
    provenance: {
      source: "Site language option label supplied at runtime",
      verified: "unverified",
      note:
        "A manually mapped site option provides no compiler rules. The strict C++ dialect and the selected toolchain are used."
    }
  };
}

/** Resolve the currently selected site option to a language-service profile. */
export function resolveContextProfile(context: SiteContext): SiteProfileLookup {
  const selectedId = context.optionId;
  if (selectedId === null) {
    return { kind: "missing", label: null };
  }

  const site = context.site;
  if (site === "generic") {
    const option = context.options.find(
      (candidate) => candidate.optionId === selectedId
    );
    if (!option) {
      return { kind: "missing", label: null };
    }
    const match = parseStandard(option.label);
    if (!match) {
      return { kind: "unrecognized", label: option.label };
    }
    if (!match.supported) {
      return { kind: "unsupported", label: option.label };
    }
    return { kind: "profile", profile: genericProfile(option, match.standard) };
  }

  const resolution = resolveSiteOptions(site, context.options);
  const profile = resolution.profiles.find(
    (candidate) => candidate.optionId === selectedId
  );
  if (profile) {
    return { kind: "profile", profile };
  }
  const unsupported = resolution.unsupported.find(
    (candidate) => candidate.optionId === selectedId
  );
  if (unsupported) {
    return { kind: "unsupported", label: unsupported.label };
  }
  const unrecognized = resolution.unrecognized.find(
    (candidate) => candidate.optionId === selectedId
  );
  if (unrecognized) {
    return { kind: "unrecognized", label: unrecognized.label };
  }
  return { kind: "missing", label: null };
}

/**
 * Standards that have at least one enabled site option. The toolbar disables
 * every standard without a candidate, matching what the site can actually
 * accept; the content script remains the authority on the final choice.
 */
export function standardCandidates(
  context: SiteContext | null
): Map<Standard, LanguageOptionInfo[]> {
  const candidates = new Map<Standard, LanguageOptionInfo[]>();
  if (!context) {
    return candidates;
  }

  const add = (option: LanguageOptionInfo, standard: Standard): void => {
    if (option.disabled) {
      return;
    }
    const existing = candidates.get(standard);
    if (existing) {
      existing.push(option);
    } else {
      candidates.set(standard, [option]);
    }
  };

  const site = context.site;
  if (site === "generic") {
    for (const option of context.options) {
      const match = parseStandard(option.label);
      if (match?.supported) {
        add(option, match.standard);
      }
    }
    return candidates;
  }

  const optionById = new Map(
    context.options.map((option) => [option.optionId, option] as const)
  );
  const resolution = resolveSiteOptions(site, context.options);
  for (const profile of resolution.profiles) {
    const option = optionById.get(profile.optionId);
    if (option) {
      add(option, profile.standard);
    }
  }
  return candidates;
}
