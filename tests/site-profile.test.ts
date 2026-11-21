import { describe, expect, it } from "vitest";

import {
  fallbackMessageKey,
  resolveContextProfile
} from "../extension/src/editor/site-profile";
import { messages as en } from "../extension/src/ui/messages.en";
import { messages as zh } from "../extension/src/ui/messages.zh-CN";
import type { SiteContext } from "../extension/src/shared/site-protocol";
import type { SiteId } from "../extension/src/shared/site-protocol";

function context(
  site: SiteId,
  options: ReadonlyArray<{ optionId: string; label: string }>,
  optionId: string | null
): SiteContext {
  return {
    site,
    optionId,
    options: options.map((option) => ({ ...option, disabled: false })),
    originKey: "https://example.test",
    accountScope: "alice",
    problemKey: "p1",
    slot: { slotId: "slot-1" } as never,
    initialText: "",
    siteRemote: "none"
  };
}

describe("site profile fallback", () => {
  it("uses C++23 for Codeforces C++26 with a warning", () => {
    const lookup = resolveContextProfile(
      context(
        "codeforces",
        [
          { optionId: "54", label: "GNU G++17 7.3" },
          { optionId: "99", label: "GNU G++26 16.1.0" }
        ],
        "99"
      )
    );
    expect(lookup.kind).toBe("profile");
    if (lookup.kind !== "profile") return;
    expect(lookup.profile.standard).toBe("c++23");
    expect(lookup.profile.optionId).toBe("99");
    expect(lookup.profile.dialect).toBe("gnu++");
    expect(lookup.warning).toEqual({
      reason: "unsupported",
      label: "GNU G++26 16.1.0"
    });
  });

  it("uses C++23 for AtCoder and Hydro C++26 options", () => {
    for (const [site, option] of [
      ["atcoder", { optionId: "x", label: "C++26 (GCC 16.1.0)" }],
      ["hydro", { optionId: "cc.cc26o2", label: "C++26(O2)" }]
    ] as const) {
      const lookup = resolveContextProfile(context(site, [option], option.optionId));
      expect(lookup.kind).toBe("profile");
      if (lookup.kind !== "profile") continue;
      expect(lookup.profile.standard).toBe("c++23");
      expect(lookup.warning?.reason).toBe("unsupported");
    }
  });

  it("reuses the site's C++23 rules for an AtCoder C++26 option", () => {
    const lookup = resolveContextProfile(
      context(
        "atcoder",
        [
          { optionId: "6017", label: "C++23 (GCC 15.2.0)" },
          { optionId: "ma-cxx26", label: "C++26 (GCC 16.1.0)" }
        ],
        "ma-cxx26"
      )
    );
    expect(lookup.kind).toBe("profile");
    if (lookup.kind !== "profile") return;
    expect(lookup.profile.standard).toBe("c++23");
    expect(lookup.profile.optionId).toBe("ma-cxx26");
    expect(lookup.profile.dialect).toBe("gnu++");
    expect(lookup.profile.macros).toContain("ATCODER");
    expect(lookup.warning?.reason).toBe("unsupported");
  });

  it("defaults unversioned C++ labels to C++23", () => {
    const lookup = resolveContextProfile(
      context("codeforces", [{ optionId: "9", label: "GNU C++ (GCC 15)" }], "9")
    );
    expect(lookup.kind).toBe("profile");
    if (lookup.kind !== "profile") return;
    expect(lookup.profile.standard).toBe("c++23");
    expect(lookup.warning?.reason).toBe("unrecognized");
  });

  it("keeps non-C++ languages without language services", () => {
    const lookup = resolveContextProfile(
      context("hydro", [{ optionId: "py.py3", label: "Python 3.11" }], "py.py3")
    );
    expect(lookup.kind).toBe("unrecognized");
    expect(lookup).not.toHaveProperty("profile");
  });

  it("leaves a supported standard untouched and un-warned", () => {
    const lookup = resolveContextProfile(
      context("codeforces", [{ optionId: "54", label: "GNU G++17 7.3" }], "54")
    );
    expect(lookup.kind).toBe("profile");
    if (lookup.kind !== "profile") return;
    expect(lookup.profile.standard).toBe("c++17");
    expect(lookup.warning).toBeUndefined();
  });

  it("falls back for generic sites only when the label names C++", () => {
    const cpp = resolveContextProfile(
      context("generic", [{ optionId: "a", label: "C++ (custom)" }], "a")
    );
    expect(cpp.kind).toBe("profile");
    if (cpp.kind === "profile") {
      expect(cpp.profile.standard).toBe("c++23");
      expect(cpp.warning?.reason).toBe("unrecognized");
    }
    const other = resolveContextProfile(
      context("generic", [{ optionId: "b", label: "Rust 1.82" }], "b")
    );
    expect(other.kind).toBe("unrecognized");
  });
});

describe("site fallback warning copy", () => {
  it("points each fallback reason at a C++23 warning with the label placeholder", () => {
    const unsupported = fallbackMessageKey({
      reason: "unsupported",
      label: "C++26 (GCC 16)"
    });
    const unrecognized = fallbackMessageKey({
      reason: "unrecognized",
      label: "C++ (custom)"
    });
    expect(unsupported).toBe("editor.site.languageFallbackUnsupported");
    expect(unrecognized).toBe("editor.site.languageFallbackVersion");
    for (const key of [unsupported, unrecognized]) {
      expect(en[key]).toContain("{label}");
      expect(zh[key]).toContain("{label}");
      expect(en[key]).toContain("C++23");
      expect(zh[key]).toContain("C++23");
    }
  });
});
