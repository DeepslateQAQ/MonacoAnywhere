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

export interface SiteProfileWarning {
  readonly reason: "unsupported" | "unrecognized";
  readonly label: string;
}

export type SiteProfileLookup =
  | {
      readonly kind: "profile";
      readonly profile: CompilerProfile;
      /** Present when an unsupported or unversioned C++ option falls back to C++23. */
      readonly warning?: SiteProfileWarning;
    }
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

const CPP_LABEL =
  /(?:^|[^a-z0-9])(?:c\+\+|gnu\+\+|g\+\+|cpp|cxx)(?:$|[^a-z0-9])/i;

/** Labels like "C++" or "GNU C++ (GCC)" name C++ without a usable version. */
function looksLikeCpp(label: string): boolean {
  return CPP_LABEL.test(label);
}

/**
 * Language service rules for C++23, used when the site selects C++26 (not
 * supported yet) or a C++ label without a recognizable version.
 */
function fallbackProfile(
  option: LanguageOptionInfo,
  reason: SiteProfileWarning["reason"],
  label: string,
  template?: CompilerProfile
): SiteProfileLookup {
  const gnu = /gnu\+\+|\bg\+\+/i.test(label);
  const base = template
    ? {
        ...template,
        standard: "c++23" as const,
        label: option.label,
        optionId: option.optionId
      }
    : {
        ...genericProfile(option, "c++23"),
        dialect: gnu ? ("gnu++" as const) : ("c++" as const)
      };
  return {
    kind: "profile",
    profile: {
      ...base,
      id: `fallback:${option.optionId}:c++23-${base.dialect}`,
      provenance: {
        source: "MonacoAnywhere fallback for an unsupported site language",
        verified: "unverified",
        note:
          reason === "unsupported"
            ? "The site selected C++26, which has no language service yet. C++23 rules are used until support lands."
            : "The site selected C++ without a recognizable version. C++23 rules are used by default."
      }
    },
    warning: { reason, label }
  };
}

/** Message key shown when a site language falls back to the C++23 profile. */
export function fallbackMessageKey(
  warning: SiteProfileWarning
): "editor.site.languageFallbackUnsupported" | "editor.site.languageFallbackVersion" {
  return warning.reason === "unsupported"
    ? "editor.site.languageFallbackUnsupported"
    : "editor.site.languageFallbackVersion";
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
      return looksLikeCpp(option.label)
        ? fallbackProfile(option, "unrecognized", option.label)
        : { kind: "unrecognized", label: option.label };
    }
    if (!match.supported) {
      return fallbackProfile(option, "unsupported", option.label);
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
    const option = context.options.find(
      (candidate) => candidate.optionId === selectedId
    );
    return option
      ? fallbackProfile(
          option,
          "unsupported",
          unsupported.label,
          resolution.profiles.find((candidate) => candidate.standard === "c++23")
        )
      : { kind: "unsupported", label: unsupported.label };
  }
  const unrecognized = resolution.unrecognized.find(
    (candidate) => candidate.optionId === selectedId
  );
  if (unrecognized) {
    const option = context.options.find(
      (candidate) => candidate.optionId === selectedId
    );
    return option && looksLikeCpp(unrecognized.label)
      ? fallbackProfile(
          option,
          "unrecognized",
          unrecognized.label,
          resolution.profiles.find((candidate) => candidate.standard === "c++23")
        )
      : { kind: "unrecognized", label: unrecognized.label };
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
