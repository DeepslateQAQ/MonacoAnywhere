import { describe, expect, it } from "vitest";

import {
  buildCompileCommand,
  remapCompileCommand
} from "../extension/src/profiles/commands";
import {
  BUILTIN_PROFILES,
  parseAtCoderOption,
  parseCodeforcesOption,
  parseHydroLanguage,
  parseHydroLanguages,
  parseLuoguOption,
  resolveSiteOptions
} from "../extension/src/profiles/builtin";
import {
  chooseProfileForStandard,
  selectOption
} from "../extension/src/profiles/sync";
import type { CompilerProfile } from "../extension/src/profiles/types";

const provenance = {
  source: "test fixture",
  verified: "official" as const
};

function testProfile(overrides: Partial<CompilerProfile> = {}): CompilerProfile {
  return {
    id: "test:c++17",
    standard: "c++17",
    dialect: "gnu++",
    label: "test",
    optionId: "17",
    args: ["-DRUNTIME"],
    defines: { B: "2", A: "1" },
    macros: ["ONLINE_JUDGE"],
    provenance,
    ...overrides
  };
}

describe("buildCompileCommand", () => {
  it("assembles argv in fixed order with toolchain fields", () => {
    const command = buildCompileCommand(testProfile(), {
      compilerName: "clang++",
      targetTriple: "wasm32-unknown-emscripten",
      sysroot: "/sysroot",
      includeDirectories: ["/sysroot/include", "/sysroot/include/c++/v1"],
      noStdIncCxx: true
    });

    expect(command.file).toBe("/workspace/main.cpp");
    expect(command.directory).toBe("/workspace");
    expect(command.command).toEqual([
      "clang++",
      "-x",
      "c++",
      "-std=gnu++17",
      "-fsyntax-only",
      "--target=wasm32-unknown-emscripten",
      "--sysroot=/sysroot",
      "-nostdinc++",
      "-isystem",
      "/sysroot/include",
      "-isystem",
      "/sysroot/include/c++/v1",
      "-DRUNTIME",
      "-DONLINE_JUDGE",
      "-DA=1",
      "-DB=2",
      "/workspace/main.cpp"
    ]);
    expect(command.command.some((arg) => arg.includes(" && "))).toBe(false);
    expect(command.command.some((arg) => arg.includes(";"))).toBe(false);
  });

  it("generates the strict dialect from the standard and defaults the compiler", () => {
    const command = buildCompileCommand(
      testProfile({ standard: "c++98", dialect: "c++", args: [], defines: {} })
    );
    expect(command.command.slice(0, 5)).toEqual([
      "clang++",
      "-x",
      "c++",
      "-std=c++98",
      "-fsyntax-only"
    ]);
    expect(command.command.at(-1)).toBe("/workspace/main.cpp");
  });

  it("remaps only the generated file inside a unique session workspace", () => {
    const command = buildCompileCommand(testProfile());
    const remapped = remapCompileCommand(
      command,
      "/workspace/ma-7/main.cpp",
      "/workspace/ma-7"
    );
    expect(remapped.command.at(-1)).toBe("/workspace/ma-7/main.cpp");
    expect(remapped.command.filter((arg) => arg === "/workspace/main.cpp")).toEqual(
      []
    );
    expect(remapped.file).toBe("/workspace/ma-7/main.cpp");
    expect(remapped.directory).toBe("/workspace/ma-7");
  });
});

describe("Codeforces option parsing", () => {
  it("maps a published GNU G++23 option to c++ semantics", () => {
    const result = parseCodeforcesOption(
      "91",
      "GNU G++23 14.2.0 (64 bit, msys 2)"
    );
    expect(result.kind).toBe("profile");
    if (result.kind !== "profile") return;
    expect(result.profile.standard).toBe("c++23");
    expect(result.profile.dialect).toBe("c++");
    expect(result.profile.macros).toContain("ONLINE_JUDGE");
    expect(result.profile.args).toEqual([]);
    expect(result.profile.provenance.verified).toBe("official");
  });

  it("maps G++14 and G++17 labels through their explicit numbers", () => {
    const c14 = parseCodeforcesOption("50", "GNU G++14 6.4.0");
    const c17 = parseCodeforcesOption(
      "61",
      "GNU G++17 9.2.0 (64 bit, msys 2)"
    );
    expect(c14.kind === "profile" && c14.profile.standard).toBe("c++14");
    expect(c17.kind === "profile" && c17.profile.standard).toBe("c++17");
  });

  it("does not invent a profile for ZIP, diagnostics or non-GNU rows", () => {
    expect(
      parseCodeforcesOption("45", "GNU C++11 5 ZIP").kind
    ).toBe("unrecognized");
    expect(
      parseCodeforcesOption("52", "GNU C++17 Diagnostics").kind
    ).toBe("unrecognized");
    expect(
      parseCodeforcesOption("9", "Microsoft Visual C++ 2017").kind
    ).toBe("unrecognized");
  });

  it("represents C++26 as unsupported instead of a profile", () => {
    const result = parseCodeforcesOption("99", "GNU G++26 16.1.0");
    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.standard).toBe("c++26");
  });
});

describe("AtCoder option parsing", () => {
  it("uses the explicit AtCoder GNU dialect rule and documented macros", () => {
    const result = parseAtCoderOption("gcc-23", "C++23 (GCC 15.2.0)");
    expect(result.kind).toBe("profile");
    if (result.kind !== "profile") return;
    expect(result.profile.standard).toBe("c++23");
    expect(result.profile.dialect).toBe("gnu++");
    expect(result.profile.macros).toEqual([
      "ATCODER",
      "NOMINMAX",
      "ONLINE_JUDGE"
    ]);
  });

  it("keeps gnu++ for the Clang row because the published rule says so", () => {
    const result = parseAtCoderOption("clang-23", "C++23 (Clang 21.1.0)");
    expect(result.kind === "profile" && result.profile.dialect).toBe("gnu++");
  });

  it("maps the IOI-style row to EVAL without online-judge macros", () => {
    const result = parseAtCoderOption(
      "ioi-20",
      "C++ IOI-Style(GNU++20) (GCC 14.2.0)"
    );
    expect(result.kind).toBe("profile");
    if (result.kind !== "profile") return;
    expect(result.profile.standard).toBe("c++20");
    expect(result.profile.dialect).toBe("gnu++");
    expect(result.profile.macros).toEqual(["EVAL"]);
  });

  it("does not infer anything from a compiler version alone", () => {
    expect(parseAtCoderOption("x", "GCC 15.2.0").kind).toBe("unrecognized");
  });

  it("marks C++26 unsupported", () => {
    expect(parseAtCoderOption("x", "C++26 (GCC 16.1.0)").kind).toBe(
      "unsupported"
    );
  });
});

describe("Luogu and Hydro partial mappings", () => {
  it("maps Luogu C++14 GCC 9 to strict c++ semantics", () => {
    const result = parseLuoguOption("28", "C++14 (GCC 9)");
    expect(result.kind).toBe("profile");
    if (result.kind !== "profile") return;
    expect(result.profile.standard).toBe("c++14");
    expect(result.profile.dialect).toBe("c++");
    expect(result.profile.macros).toEqual(["ONLINE_JUDGE"]);
    expect(result.profile.provenance.verified).toBe("partial");
  });

  it("uses the built-in id mapping only when no live label exists", () => {
    const result = resolveSiteOptions("luogu", [
      { optionId: "34", label: "" }
    ]);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.standard).toBe("c++23");
  });

  it("keeps c++ dialect for Hydro even when the label mentions GCC", () => {
    const result = parseHydroLanguage("52", {
      display: "C++17 (GCC 9.3.0)",
      monaco: "cpp"
    });
    expect(result.kind).toBe("profile");
    if (result.kind !== "profile") return;
    expect(result.profile.standard).toBe("c++17");
    expect(result.profile.dialect).toBe("c++");
    expect(result.profile.provenance.verified).toBe("unverified");
  });

  it("honours an explicit GNU++ marker in Hydro", () => {
    const result = parseHydroLanguage("53", {
      display: "GNU++20 (GCC 12.2.0)"
    });
    expect(result.kind === "profile" && result.profile.dialect).toBe("gnu++");
  });

  it("requires manual mapping when Hydro gives no standard", () => {
    const result = parseHydroLanguage("bad", {
      display: "C++ (GCC 12.2.0)"
    });
    expect(result.kind).toBe("unrecognized");
  });

  it("parses a whole Hydro LANGS map without treating unknown rows as C++", () => {
    const result = parseHydroLanguages({
      "52": { display: "C++17 (GCC 9.3.0)", monaco: "cpp" },
      "70": { display: "Python 3.11" },
      "80": { display: "C++26 (GCC 16)" }
    });
    expect(result.profiles.map((profile) => profile.standard)).toEqual([
      "c++17"
    ]);
    expect(result.unrecognized).toHaveLength(1);
    expect(result.unsupported).toHaveLength(1);
  });

  it("does not create profiles for C++26", () => {
    expect(
      parseHydroLanguage("future", { display: "C++26 (GCC 16)" }).kind
    ).toBe("unsupported");
    expect(parseLuoguOption("future", "C++26").kind).toBe("unsupported");
  });
});

describe("standard to site option selection", () => {
  it("requires an explicit choice when several profiles share a standard", () => {
    const c20 = chooseProfileForStandard(BUILTIN_PROFILES.codeforces, "c++20");
    expect(c20.kind).toBe("many");
    if (c20.kind !== "many") return;
    expect(c20.profiles.length).toBeGreaterThan(1);
    expect(new Set(c20.profiles.map((profile) => profile.standard))).toEqual(
      new Set(["c++20"])
    );
  });

  it("returns one profile when the standard is unambiguous", () => {
    const c23 = chooseProfileForStandard(BUILTIN_PROFILES.codeforces, "c++23");
    expect(c23.kind).toBe("one");
    if (c23.kind !== "one") return;
    expect(c23.profile.optionId).toBe("91");
  });

  it("never picks a disabled site option", () => {
    const profile = testProfile({ optionId: "17" });
    expect(
      selectOption(
        [
          { optionId: "17", label: "C++17", disabled: true },
          { optionId: "20", label: "C++20" }
        ],
        profile
      )
    ).toBeNull();
    expect(
      selectOption([{ optionId: "17", label: "C++17" }], profile)?.optionId
    ).toBe("17");
  });
});
