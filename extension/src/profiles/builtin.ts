import {
  parseStandard,
  type CompilerProfile,
  type CppDialect,
  type ProfileProvenance,
  type Standard,
  type UnsupportedStandard
} from "./types.js";

export type ProfileSite = "codeforces" | "atcoder" | "luogu" | "hydro";

export interface SiteLanguageOption {
  readonly optionId: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface ProfileParseSuccess {
  readonly kind: "profile";
  readonly profile: CompilerProfile;
}

export interface ProfileParseUnsupported {
  readonly kind: "unsupported";
  readonly optionId: string;
  readonly label: string;
  readonly standard: UnsupportedStandard;
}

export interface ProfileParseUnrecognized {
  readonly kind: "unrecognized";
  readonly optionId: string;
  readonly label: string;
  readonly reason: string;
}

export type ProfileResolution =
  | ProfileParseSuccess
  | ProfileParseUnsupported
  | ProfileParseUnrecognized;

export interface SiteProfileResolution {
  readonly profiles: readonly CompilerProfile[];
  readonly unsupported: readonly ProfileParseUnsupported[];
  readonly unrecognized: readonly ProfileParseUnrecognized[];
}

const CODEFORCES_PROVENANCE: ProfileProvenance = {
  source:
    "https://codeforces.com/topic/121739/en17 (revision 2025-08-09; option names observed on the submission form)",
  verified: "official",
  note:
    "Compile lines published by Codeforces; option text and ids may change, so live option labels are parsed whenever present."
};

const ATCODER_PROVENANCE: ProfileProvenance = {
  source: "https://atcoder.jp/contests/<contest>/rules (language table)",
  verified: "partial",
  note:
    "The rules table changes over time; only the standard, explicit dialect and documented macros are copied."
};

const LUOGU_PROVENANCE: ProfileProvenance = {
  source:
    "https://www.luogu.com.cn/_lfe/config (CodeLanguage; read 2026-11-21) and https://help.luogu.com.cn/manual/luogu/problem/judging",
  verified: "partial",
  note:
    "Luogu documents -std=<version> without GNU extensions. The standard library and headers come from the selected toolchain, not Luogu's judge image."
};

const HYDRO_PROVENANCE: ProfileProvenance = {
  source: "window.LANGS supplied by the Hydro deployment",
  verified: "unverified",
  note:
    "Deployment language tables differ. The dialect is never inferred from a GCC/Clang version string."
};

export const PROVENANCE_BY_SITE: Readonly<Record<ProfileSite, ProfileProvenance>> = {
  codeforces: CODEFORCES_PROVENANCE,
  atcoder: ATCODER_PROVENANCE,
  luogu: LUOGU_PROVENANCE,
  hydro: HYDRO_PROVENANCE
};

function trimLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

function profileId(
  site: ProfileSite,
  optionId: string,
  standard: Standard,
  dialect: CppDialect
): string {
  return `${site}:${optionId}:${standard}-${dialect === "gnu++" ? "gnu" : "cxx"}`;
}

function makeProfile(input: {
  readonly site: ProfileSite;
  readonly optionId: string;
  readonly label: string;
  readonly standard: Standard;
  readonly dialect: CppDialect;
  readonly args?: readonly string[];
  readonly macros?: readonly string[];
  readonly defines?: Readonly<Record<string, string>>;
  readonly provenance?: ProfileProvenance;
}): CompilerProfile {
  return {
    id: profileId(input.site, input.optionId, input.standard, input.dialect),
    standard: input.standard,
    dialect: input.dialect,
    label: input.label,
    optionId: input.optionId,
    args: input.args ?? [],
    defines: input.defines ?? {},
    macros: input.macros ?? [],
    provenance: input.provenance ?? PROVENANCE_BY_SITE[input.site]
  };
}

/**
 * Codeforces option parser.
 *
 * Codeforces labels use "GNU G++17 ..." rather than "C++17"; the G++ number is
 * the standard used by the published `-std=c++NN` command line. "ZIP",
 * diagnostics-only and non-GNU options are not mapped because their actual
 * compilation semantics are not published as a standard command.
 */
export function parseCodeforcesOption(
  optionId: string,
  rawLabel: string
): ProfileResolution {
  const label = trimLabel(rawLabel);
  if (!label) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "The Codeforces option has no label to parse."
    };
  }
  if (/\bZIP\b/i.test(label)) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "The packaged ZIP compiler option has no published standard command line."
    };
  }
  if (/\bdiagnostics?\b/i.test(label)) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "Diagnostics-only compiler options are not language standards."
    };
  }
  if (/\b(?:Microsoft|Visual|MSVC|Clang)\b/i.test(label)) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "Only Codeforces' GNU G++ options have published -std=c++NN semantics."
    };
  }
  const gnuMatch = /\bGNU\s+G\+\+\s*(\d{2})\b/i.exec(label);
  const standardMatch = /(?:GNU\+\+|C\+\+)\s*(\d{2})\b/i.exec(label);
  const suffix = gnuMatch?.[1] ?? standardMatch?.[1];
  if (!suffix) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "No explicit C++ standard was found in the option label."
    };
  }
  const standard = `c++${suffix}`;
  const match = parseStandard(standard);
  if (!match) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: `Unknown C++ version ${standard}.`
    };
  }
  if (!match.supported) {
    return {
      kind: "unsupported",
      optionId,
      label,
      standard: match.standard
    };
  }
  return {
    kind: "profile",
    profile: makeProfile({
      site: "codeforces",
      optionId,
      label,
      standard: match.standard,
      dialect: "c++",
      macros: ["ONLINE_JUDGE"]
    })
  };
}

/**
 * AtCoder option parser. AtCoder publishes `-std=gnu++NN` for its C++ rows and
 * a separate `-DEVAL` IOI-style row. The dialect therefore comes from that
 * explicit rule, never from seeing "GCC" in the label.
 */
export function parseAtCoderOption(
  optionId: string,
  rawLabel: string
): ProfileResolution {
  const label = trimLabel(rawLabel);
  const match = parseStandard(label);
  if (!match) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "No explicit C++ standard was found in the AtCoder option label."
    };
  }
  if (!match.supported) {
    return {
      kind: "unsupported",
      optionId,
      label,
      standard: match.standard
    };
  }
  const ioiStyle = /\bIOI[- ]Style\b/i.test(label);
  return {
    kind: "profile",
    profile: makeProfile({
      site: "atcoder",
      optionId,
      label,
      standard: match.standard,
      dialect: "gnu++",
      macros: ioiStyle
        ? ["EVAL"]
        : ["ATCODER", "NOMINMAX", "ONLINE_JUDGE"]
    })
  };
}

/**
 * Luogu partial mapping. The site's language list is read at runtime; names
 * contain the standard. Luogu's judge documentation uses `-std=<version>`
 * (not GNU), so the dialect is fixed to c++ here.
 */
export function parseLuoguOption(
  optionId: string,
  rawLabel: string
): ProfileResolution {
  const label = trimLabel(rawLabel);
  const match = parseStandard(label);
  if (!match) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "No explicit C++ standard was found in the Luogu language name."
    };
  }
  if (!match.supported) {
    return {
      kind: "unsupported",
      optionId,
      label,
      standard: match.standard
    };
  }
  return {
    kind: "profile",
    profile: makeProfile({
      site: "luogu",
      optionId,
      label,
      standard: match.standard,
      dialect: "c++",
      macros: ["ONLINE_JUDGE"]
    })
  };
}

export interface HydroLanguageRecord {
  readonly display?: string;
  readonly monaco?: string;
  readonly hidden?: boolean;
  readonly disabled?: boolean;
}

export type HydroLanguageValue =
  | string
  | HydroLanguageRecord
  | null
  | undefined;

export type HydroLanguages = Readonly<Record<string, HydroLanguageValue>>;

/**
 * Parse one Hydro LANGS entry. Standard-library semantics are unknown, so the
 * safe default is the strict c++ dialect. Only an explicit "GNU++NN" marker in
 * the label selects gnu++; a bare GCC version never does.
 */
export function parseHydroLanguage(
  optionId: string,
  value: HydroLanguageValue
): ProfileResolution {
  const rawLabel =
    typeof value === "string"
      ? value
      : typeof value?.display === "string"
        ? value.display
        : "";
  const label = trimLabel(rawLabel);
  const match = parseStandard(label);
  if (!match) {
    return {
      kind: "unrecognized",
      optionId,
      label,
      reason: "The Hydro language does not expose a C++ standard; manual mapping is required."
    };
  }
  if (!match.supported) {
    return {
      kind: "unsupported",
      optionId,
      label,
      standard: match.standard
    };
  }
  const dialect: CppDialect = /GNU\+\+\s*\d+/i.test(label) ? "gnu++" : "c++";
  return {
    kind: "profile",
    profile: makeProfile({
      site: "hydro",
      optionId,
      label,
      standard: match.standard,
      dialect
    })
  };
}

/** Parse a full window.LANGS map into profiles plus manual-mapping entries. */
export function parseHydroLanguages(
  languages: HydroLanguages
): SiteProfileResolution {
  return resolveSiteOptions(
    "hydro",
    Object.entries(languages).map(([optionId, value]) => {
      const label =
        typeof value === "string"
          ? value
          : typeof value?.display === "string"
            ? value.display
            : "";
      return {
        optionId,
        label,
        disabled:
          typeof value === "object" && value !== null
            ? (value.disabled ?? value.hidden)
            : undefined
      };
    })
  );
}

const CODEFORCES_BUILTIN: readonly CompilerProfile[] = [
  makeProfile({
    site: "codeforces",
    optionId: "42",
    label: "GNU G++11 5.1.0",
    standard: "c++11",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "codeforces",
    optionId: "50",
    label: "GNU G++14 6.4.0",
    standard: "c++14",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "codeforces",
    optionId: "54",
    label: "GNU G++17 7.3.0",
    standard: "c++17",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "codeforces",
    optionId: "61",
    label: "GNU G++17 9.2.0 (64 bit, msys 2)",
    standard: "c++17",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "codeforces",
    optionId: "73",
    label: "GNU G++20 11.2.0 (64 bit, winlibs)",
    standard: "c++20",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "codeforces",
    optionId: "89",
    label: "GNU G++20 13.2.0 (64 bit, winlibs)",
    standard: "c++20",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "codeforces",
    optionId: "91",
    label: "GNU G++23 14.2.0 (64 bit, msys 2)",
    standard: "c++23",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  })
];

const LUOGU_BUILTIN: readonly CompilerProfile[] = [
  makeProfile({
    site: "luogu",
    optionId: "3",
    label: "C++98",
    standard: "c++98",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "luogu",
    optionId: "4",
    label: "C++11",
    standard: "c++11",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "luogu",
    optionId: "11",
    label: "C++14",
    standard: "c++14",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "luogu",
    optionId: "12",
    label: "C++17",
    standard: "c++17",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "luogu",
    optionId: "27",
    label: "C++20",
    standard: "c++20",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "luogu",
    optionId: "28",
    label: "C++14 (GCC 9)",
    standard: "c++14",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  }),
  makeProfile({
    site: "luogu",
    optionId: "34",
    label: "C++23",
    standard: "c++23",
    dialect: "c++",
    macros: ["ONLINE_JUDGE"]
  })
];

/**
 * Built-in fallback profiles. Runtime option labels always take precedence;
 * these are used only when a site gives us an id without a label. AtCoder and
 * Hydro have deployment/contest-specific option ids and therefore no fallback
 * profiles, only parsers.
 */
export const BUILTIN_PROFILES: Readonly<
  Record<ProfileSite, readonly CompilerProfile[]>
> = {
  codeforces: CODEFORCES_BUILTIN,
  atcoder: [],
  luogu: LUOGU_BUILTIN,
  hydro: []
};

export function findBuiltinProfile(
  site: ProfileSite,
  optionId: string
): CompilerProfile | null {
  return (
    BUILTIN_PROFILES[site].find((profile) => profile.optionId === optionId) ??
    null
  );
}

export function parseSiteOption(
  site: ProfileSite,
  option: SiteLanguageOption
): ProfileResolution {
  switch (site) {
    case "codeforces":
      return parseCodeforcesOption(option.optionId, option.label);
    case "atcoder":
      return parseAtCoderOption(option.optionId, option.label);
    case "luogu":
      return parseLuoguOption(option.optionId, option.label);
    case "hydro":
      return parseHydroLanguage(option.optionId, {
        display: option.label,
        disabled: option.disabled
      });
  }
}

/**
 * Resolve a site language list. Live labels are authoritative. A built-in id
 * mapping is consulted only when the live option has no label at all.
 */
export function resolveSiteOptions(
  site: ProfileSite,
  options: readonly SiteLanguageOption[]
): SiteProfileResolution {
  const profiles: CompilerProfile[] = [];
  const unsupported: ProfileParseUnsupported[] = [];
  const unrecognized: ProfileParseUnrecognized[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    const label = trimLabel(option.label);
    if (!label) {
      const builtin = findBuiltinProfile(site, option.optionId);
      if (builtin) {
        if (!seen.has(builtin.id)) {
          seen.add(builtin.id);
          profiles.push(builtin);
        }
        continue;
      }
      unrecognized.push({
        kind: "unrecognized",
        optionId: option.optionId,
        label,
        reason: "The site did not provide a language label and no built-in mapping exists."
      });
      continue;
    }

    const result = parseSiteOption(site, { ...option, label });
    if (result.kind === "profile") {
      if (!seen.has(result.profile.id)) {
        seen.add(result.profile.id);
        profiles.push(result.profile);
      }
    } else if (result.kind === "unsupported") {
      unsupported.push(result);
    } else {
      unrecognized.push(result);
    }
  }

  return { profiles, unsupported, unrecognized };
}


