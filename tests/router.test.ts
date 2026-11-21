import { describe, expect, it } from "vitest";

import { detectEditorPage } from "../extension/src/content/router";

function documentWith(
  app: string,
  bodyClasses: readonly string[] = []
): Document {
  return {
    documentElement: { dataset: { app } },
    body: {
      classList: {
        contains: (name: string) => bodyClasses.includes(name)
      }
    }
  } as unknown as Document;
}

describe("editor surface detection", () => {
  it("recognizes Codeforces submit pages with a problem suffix", () => {
    const page = detectEditorPage(
      new URL("https://codeforces.com/problemset/submit/1/A"),
      documentWith("")
    );
    expect(page?.site).toBe("codeforces");
  });

  it("does not take over a Hydro problem statement", () => {
    const page = detectEditorPage(
      new URL("https://yundouxueyuan.com/d/SZXQ/p/2314"),
      documentWith("Hydro")
    );
    expect(page).toBeNull();
  });

  it("recognizes the Hydro online IDE that keeps the problem URL", () => {
    const page = detectEditorPage(
      new URL("https://yundouxueyuan.com/d/SZXQ/p/2314"),
      documentWith("Hydro", ["mode--scratchpad"])
    );
    expect(page).toEqual({
      site: "hydro",
      originKey: "https://yundouxueyuan.com/d/SZXQ",
      routeKey:
        "https://yundouxueyuan.com/d/SZXQ/p/2314#scratchpad"
    });
  });

  it("keys the Hydro IDE apart from its submit page", () => {
    const submit = detectEditorPage(
      new URL("https://yundouxueyuan.com/d/SZXQ/p/2314/submit"),
      documentWith("Hydro")
    );
    const ide = detectEditorPage(
      new URL("https://yundouxueyuan.com/d/SZXQ/p/2314"),
      documentWith("Hydro", ["mode--scratchpad"])
    );
    expect(submit?.routeKey).not.toBe(ide?.routeKey);
  });
});
