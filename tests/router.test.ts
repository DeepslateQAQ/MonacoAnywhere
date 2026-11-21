import { describe, expect, it } from "vitest";

import { detectEditorPage } from "../extension/src/content/router";

interface TestElement {
  readonly tag: "div" | "textarea" | "select" | "form";
  readonly id?: string;
  readonly name?: string;
  readonly method?: string;
  readonly action?: string;
  readonly hidden?: boolean;
  readonly disabled?: boolean;
  readonly children?: readonly TestElement[];
}

function queryElements(elements: readonly Element[], selector: string): Element | null {
  for (const element of elements) {
    if (element.matches(selector)) return element;
    const descendant = element.querySelector(selector);
    if (descendant) return descendant;
  }
  return null;
}

function elementWith(source: TestElement, parent: Element | null = null): Element {
  const children: Element[] = [];
  const element = {
    ...source,
    matches(selector: string): boolean {
      if (selector.startsWith("#")) return source.id === selector.slice(1);
      const match = /^(\w+)(?:\[name="([^"]+)"\])?$/.exec(selector);
      if (!match) throw new Error(`Unsupported test selector: ${selector}`);
      return source.tag === match[1] && (!match[2] || source.name === match[2]);
    },
    closest(selector: string): Element | null {
      return element.matches(selector) ? element : parent?.closest(selector) ?? null;
    },
    getAttribute(name: string): string | null {
      const value = source[name as keyof TestElement];
      return typeof value === "string" ? value : null;
    },
    querySelector(selector: string): Element | null {
      return queryElements(children, selector);
    },
    get env(): never {
      throw new Error("Route detection must not inspect the page-world Ace instance");
    },
    getBoundingClientRect(): never {
      throw new Error("Route detection must not depend on native editor visibility");
    }
  } as unknown as Element;
  children.push(...(source.children ?? []).map((child) => elementWith(child, element)));
  return element;
}

function documentWith(
  app: string,
  bodyClasses: readonly string[] = [],
  elements: readonly TestElement[] = []
): Document {
  const roots = elements.map((element) => elementWith(element));
  return {
    documentElement: { dataset: { app } },
    body: {
      classList: {
        contains: (name: string) => bodyClasses.includes(name)
      }
    },
    querySelector: (selector: string) => queryElements(roots, selector),
    get defaultView(): never {
      throw new Error("Route detection must not inspect page globals");
    }
  } as unknown as Document;
}

function atCoderForm(
  source: TestElement,
  attributes: Partial<TestElement> = {}
): TestElement {
  return {
    tag: "form",
    method: "post",
    action: "/contests/abc483/submit",
    ...attributes,
    children: [
      { tag: "select", name: "data.LanguageId" },
      source
    ]
  };
}

describe("editor surface detection", () => {
  describe("AtCoder embedded task editors", () => {
    const taskUrl = "https://atcoder.jp/contests/abc483/tasks/abc483_a";

    it("recognizes the reported task page and preserves its identity", () => {
      const page = detectEditorPage(
        new URL(taskUrl),
        documentWith("", [], [
          atCoderForm({
            tag: "div",
            id: "editor",
            children: [
              { tag: "textarea", id: "plain-textarea", name: "sourceCode", hidden: true }
            ]
          })
        ])
      );
      expect(page).toEqual({
        site: "atcoder",
        originKey: "https://atcoder.jp",
        routeKey: taskUrl
      });
    });

    it("accepts a task's Ace source form without requiring its page-world instance", () => {
      const url = new URL(`${taskUrl}/?lang=en#submit`);
      const page = detectEditorPage(
        url,
        documentWith("", [], [
          atCoderForm({ tag: "div", id: "editor", hidden: true }, { method: "POST" })
        ])
      );
      expect(page).toEqual({
        site: "atcoder",
        originKey: url.origin,
        routeKey: url.href
      });
    });

    it.each([
      { tag: "textarea", id: "plain-textarea", name: "sourceCode" },
      { tag: "textarea", name: "sourceCode", hidden: true, disabled: true }
    ] satisfies readonly TestElement[])(
      "recognizes a structurally present plain source textarea: %j",
      (source) => {
        expect(
          detectEditorPage(new URL(taskUrl), documentWith("", [], [source]))?.site
        ).toBe("atcoder");
      }
    );

    it.each([
      { elements: [] },
      { elements: [{ tag: "div", id: "editor" }] },
      { elements: [{ tag: "textarea", id: "plain-textarea", name: "comment" }] },
      { elements: [{ tag: "select", name: "data.LanguageId" }] }
    ] satisfies readonly { elements: readonly TestElement[] }[])(
      "excludes statement-only or incidental editor DOM: %j",
      ({ elements }) => {
        expect(
          detectEditorPage(new URL(taskUrl), documentWith("", [], elements))
        ).toBeNull();
      }
    );

    it.each([
      atCoderForm({ tag: "div", id: "editor" }, { method: "get" }),
      atCoderForm({ tag: "div", id: "editor" }, { action: "/contests/abc482/submit" }),
      atCoderForm({ tag: "div", id: "editor" }, { action: "https://example.com/contests/abc483/submit" }),
      {
        tag: "form",
        method: "post",
        action: "/contests/abc483/submit",
        children: [{ tag: "div", id: "editor" }]
      }
    ] satisfies readonly TestElement[])(
      "does not mistake an unrelated form for the task source form: %j",
      (form) => {
        expect(
          detectEditorPage(new URL(taskUrl), documentWith("", [], [form]))
        ).toBeNull();
      }
    );

    it.each([
      "/contests/abc483/tasks",
      "/contests/abc483/tasks/",
      "/contests/abc483/editorial",
      "/contests/abc483/tasks/abc483_a/editorial",
      "/contests/abc483/tasks/abc483_a/extra",
      "/contests/abc483/tasks/abc483_a//",
      "/contests/abc483/submissions/12345",
      "/login"
    ])("excludes non-editor route %s even when source-like DOM exists", (pathname) => {
      expect(
        detectEditorPage(
          new URL(pathname, taskUrl),
          documentWith("", [], [
            atCoderForm({ tag: "div", id: "editor" }),
            { tag: "textarea", name: "sourceCode" }
          ])
        )
      ).toBeNull();
    });

    it.each(["submit", "submit/", "custom_test", "custom_test/"])(
      "preserves the existing %s surface before its source DOM is ready",
      (surface) => {
        const url = new URL(`https://atcoder.jp/contests/abc483/${surface}`);
        expect(detectEditorPage(url, documentWith(""))).toEqual({
          site: "atcoder",
          originKey: url.origin,
          routeKey: url.href
        });
      }
    );
  });

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
