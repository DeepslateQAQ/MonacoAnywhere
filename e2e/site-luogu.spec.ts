import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, expect, test } from "@playwright/test";

const EXTENSION_ID = "jfhnkcfnnbdagonjcigiilmcebadiccf";
const DIST = path.resolve("dist");
const executablePath =
  process.env.CHROMIUM_EXECUTABLE ?? path.resolve("node_modules/.cache/chromium");

async function fixture(name: string): Promise<string> {
  return readFile(path.join("tests", "fixtures", name), "utf8");
}

test("takes over a Luogu CM6 editor and mirrors text", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "ma-site-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--no-first-run"
    ]
  });
  try {
    const html = await fixture("luogu.html");
    await context.route("https://www.luogu.com.cn/problem/P1001", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: html })
    );
    await context.addInitScript(() => {
      const install = (): void => {
        const style = document.createElement("style");
        style.textContent =
          ".cm-editor { display: block; min-block-size: 260px; }" +
          ".cm-content { min-block-size: 240px; }";
        document.head.append(style);
        class FakeDoc {
          constructor(private readonly element: HTMLElement) {}
          get length(): number {
            return this.element.textContent?.length ?? 0;
          }
          toString(): string {
            return this.element.textContent ?? "";
          }
        }
        class FakeView {
          readonly state: { doc: FakeDoc };
          constructor(readonly contentDOM: HTMLElement) {
            this.state = { doc: new FakeDoc(contentDOM) };
            contentDOM.__maFakeView = this;
          }
          dispatch(spec: { changes: { insert: string } }): void {
            this.contentDOM.textContent = spec.changes.insert;
            this.contentDOM.dispatchEvent(
              new InputEvent("input", { bubbles: true, inputType: "insertText" })
            );
          }
          static findFromDOM(node: Node): FakeView | null {
            return (node as HTMLElement & { __maFakeView?: FakeView }).__maFakeView ?? null;
          }
        }
        for (const content of document.querySelectorAll<HTMLElement>(".cm-content")) {
          const view = new FakeView(content);
          (content as HTMLElement & { cmTile?: { view: FakeView } }).cmTile = { view };
        }
        const combo = document.querySelector<HTMLElement>(".combo-wrapper.lang-select");
        const dropdown = document.querySelector<HTMLElement>(".dropdown");
        combo?.addEventListener("click", () => {
          if (dropdown) dropdown.style.display = "block";
        });
        dropdown?.addEventListener("click", (event) => {
          const target = event.target as HTMLElement;
          if (target.tagName !== "LI") return;
          const label = combo?.querySelector<HTMLElement>(".text");
          if (label) label.textContent = target.textContent;
          if (dropdown) dropdown.style.display = "none";
        });
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, { once: true });
      } else {
        install();
      }
    });
    const page = await context.newPage();
    await page.waitForTimeout(2500);
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${EXTENSION_ID}/options.html`);
    await extensionPage.evaluate(async () => {
      await chrome.storage.local.set({
        "settings:v1": {
          backend: "wasm",
          siteBackends: {},
          theme: "system",
          locale: "auto",
          hiddenPauseMs: 30000,
          queryDriverAllowlist: [],
          extraIncludeDirs: [],
          editorFontFamily: '"IBM Plex Mono", Consolas, monospace',
          editorTheme: "vs-dark",
          onboardingComplete: true
        }
      });
    });
    await extensionPage.close();
    await page.goto("https://www.luogu.com.cn/problem/P1001#submit");
    await expect(page.locator("iframe[src*='editor.html']")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator(".cm-content").first()).toHaveCSS("visibility", "hidden");
    const frame = page.frameLocator("iframe[src*='editor.html']");
    await expect(frame.locator("#ma-editor-site-status")).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator("#ma-editor-standard")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "/tmp/ma-compact-toolbar.png" });
    const before = await page.locator(".cm-content").first().textContent();
    await frame.locator("[data-monaco-anywhere-editor]").click({ force: true, timeout: 5_000 });
    await page.keyboard.press("End");
    await page.keyboard.type("// mirrored");
    await expect(page.locator(".cm-content").first()).toContainText("// mirrored", { timeout: 10_000 });
    expect(before).not.toContain("// mirrored");
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
