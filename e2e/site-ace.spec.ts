import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, expect, test, type BrowserContext, type FrameLocator, type Page } from "@playwright/test";

const EXTENSION_ID = "jfhnkcfnnbdagonjcigiilmcebadiccf";
const DIST = path.resolve("dist");
const executablePath =
  process.env.CHROMIUM_EXECUTABLE ?? path.resolve("node_modules/.cache/chromium");
const INITIAL_TEXT = "int main() { return 0; }";
const OVERLAY = "iframe#monacoanywhere-editor-overlay";

interface AceElement extends HTMLElement {
  env: {
    editor: {
      getValue(): string;
      setValue(text: string, cursorPosition?: number): void;
    };
  };
}

interface SiteFixture {
  readonly name: string;
  readonly url: string;
  readonly file: string;
  readonly submissionTextarea?: string;
}

const SITES: readonly SiteFixture[] = [
  {
    name: "Codeforces submit",
    url: "https://codeforces.com/problemset/submit/1/A",
    file: "codeforces.html",
    submissionTextarea: "#sourceCodeTextarea"
  },
  {
    name: "AtCoder embedded task",
    url: "https://atcoder.jp/contests/abc483/tasks/abc483_a",
    file: "atcoder-task.html"
  }
];

async function installAceFixture(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (location.hostname !== "codeforces.com" && location.hostname !== "atcoder.jp") return;
    const install = (): void => {
      const element = document.querySelector<HTMLElement>("#editor");
      const source = document.querySelector<HTMLTextAreaElement>(
        'textarea[name="source"], textarea[name="sourceCode"]'
      );
      if (!element || !source) throw new Error("Ace fixture requires its native source controls");

      const style = document.createElement("style");
      style.textContent = "#editor { display: block; inline-size: 903px; block-size: 425px; }";
      document.head.append(style);

      type Delta = {
        action: "remove" | "insert";
        start: { row: number; column: number };
        end: { row: number; column: number };
        lines: string[];
      };
      const listeners = new Set<(delta: Delta) => void>();
      let value = source.value;
      element.textContent = value;
      const session = {
        on(event: string, listener: (delta: Delta) => void): void {
          if (event === "change") listeners.add(listener);
        },
        off(event: string, listener: (delta: Delta) => void): void {
          if (event === "change") listeners.delete(listener);
        }
      };
      const emit = (action: Delta["action"], text: string): void => {
        const lines = text.split("\n");
        const delta: Delta = {
          action,
          start: { row: 0, column: 0 },
          end: { row: lines.length - 1, column: lines[lines.length - 1]!.length },
          lines
        };
        for (const listener of [...listeners]) listener(delta);
      };
      const editor = {
        getValue: (): string => value,
        getSession: () => session,
        setValue(text: string, _cursorPosition?: number): void {
          // Ace replaces the document with two synchronous session changes.
          // Listeners must see the empty removal state before the insertion.
          if (value !== "") {
            const previous = value;
            value = "";
            element.textContent = value;
            emit("remove", previous);
          }
          if (text !== "") {
            value = text;
            element.textContent = value;
            emit("insert", text);
          }
        }
      };
      (element as HTMLElement & { env: { editor: typeof editor } }).env = { editor };

      document.documentElement.dataset.submitCount = "0";
      document.addEventListener("submit", (event) => {
        event.preventDefault();
        document.documentElement.dataset.submitCount = String(
          Number(document.documentElement.dataset.submitCount) + 1
        );
      }, true);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  });
}

async function configureExtension(context: BrowserContext, siteUrl: string): Promise<void> {
  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${EXTENSION_ID}/options.html`);
    await options.evaluate(async () => {
      await chrome.storage.local.set({
        "settings:v1": {
          backend: "wasm",
          siteBackends: {},
          theme: "system",
          locale: "auto",
          hiddenPauseMs: 30000,
          queryDriverAllowlist: [],
          extraIncludeDirs: [],
          editorFontFamily: "monospace",
          editorTheme: "vs-dark",
          onboardingComplete: true
        }
      });
    });
    // Do not navigate until both real extension worlds are registered.
    const match = `${new URL(siteUrl).origin}/*`;
    await expect.poll(() => options.evaluate(async (pattern) => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      const matching = scripts.filter((script) => script.matches?.includes(pattern));
      return {
        main: matching.some((script) => script.js?.includes("content-main.js")),
        isolated: matching.some((script) => script.js?.includes("content-isolated.js"))
      };
    }, match)).toEqual({ main: true, isolated: true });
  } finally {
    await options.close();
  }
}

async function visibleMonacoText(frame: FrameLocator): Promise<string> {
  return frame.locator(".monaco-editor .view-lines .view-line").evaluateAll((lines) =>
    lines.map((line) => (line.textContent ?? "").replace(/\u00a0/g, " ")).join("\n")
  );
}

async function nativeAceText(page: Page): Promise<string> {
  return page.locator("#editor").evaluate((element) => (element as AceElement).env.editor.getValue());
}

async function expectMirrored(
  page: Page,
  frame: FrameLocator,
  site: SiteFixture,
  text: string
): Promise<void> {
  await expect.poll(() => nativeAceText(page)).toBe(text);
  await expect.poll(() => visibleMonacoText(frame)).toBe(text);
  if (site.submissionTextarea) {
    await expect(page.locator(site.submissionTextarea)).toHaveValue(text);
  }
}

async function focusMonacoEnd(page: Page, frame: FrameLocator): Promise<void> {
  await frame.locator(".monaco-editor .view-lines").click({ position: { x: 16, y: 10 } });
  await page.keyboard.press("Control+End");
}

for (const site of SITES) {
  test(`keeps ${site.name} Ace takeover atomic during continuous keyboard input`, async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "ma-site-ace-"));
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
      const html = await readFile(path.join("tests", "fixtures", site.file), "utf8");
      await context.route(site.url, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: html })
      );
      await installAceFixture(context);
      await configureExtension(context, site.url);
      const page = await context.newPage();
      await page.goto(site.url);
      await page.bringToFront();
      const overlay = page.locator(OVERLAY);
      await expect(overlay).toHaveCount(1, { timeout: 20_000 });
      await expect(page.locator("[data-monaco-anywhere-overlay]")).toHaveCount(1);
      await expect(page.locator("#editor")).toHaveCSS("visibility", "hidden");
      const frame = page.frameLocator(OVERLAY);
      await expect(frame.locator(".monaco-editor .view-lines")).toBeVisible({ timeout: 20_000 });
      await expectMirrored(page, frame, site, INITIAL_TEXT);
      const mountedFrame = await overlay.elementHandle();
      if (!mountedFrame) throw new Error("The takeover iframe disappeared before typing");

      let expected = INITIAL_TEXT;
      await focusMonacoEnd(page, frame);
      for (const burst of [
        " // first burst abcdefghijklmnopqrstuvwxyz",
        " 0123456789 second continuous burst",
        " final burst ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      ]) {
        // Real keyboard events at full speed; no per-character synchronization.
        await page.keyboard.type(burst);
        expected += burst;
        await expectMirrored(page, frame, site, expected);
      }

      const externalText = "// replacement made through native Ace";
      await page.locator("#editor").evaluate((element, text) => {
        (element as AceElement).env.editor.setValue(text, -1);
      }, externalText);
      await expect.poll(() => visibleMonacoText(frame)).toBe(externalText);
      await expect.poll(() => nativeAceText(page)).toBe(externalText);
      await focusMonacoEnd(page, frame);
      const continuation = " and continued Monaco typing 0123456789";
      await page.keyboard.type(continuation);
      await expectMirrored(page, frame, site, externalText + continuation);

      await page.locator("#editor").evaluate((element) => {
        (element as AceElement).env.editor.setValue("", -1);
      });
      await expect.poll(() => visibleMonacoText(frame)).toBe("");
      await expect.poll(() => nativeAceText(page)).toBe("");
      await focusMonacoEnd(page, frame);
      expected = "// typed after native deletion abcdefghijklmnopqrstuvwxyz 0123456789";
      await page.keyboard.type(expected);
      await expectMirrored(page, frame, site, expected);

      // Keep the same iframe through several real 500 ms route polls and
      // 1.5 s context polls, including while AtCoder's source editor is hidden.
      for (let sample = 0; sample < 3; sample += 1) {
        await page.waitForTimeout(1_600);
        expect(await mountedFrame.evaluate((element) => element.isConnected)).toBe(true);
        await expect(overlay).toHaveCount(1);
        await expect(page.locator("[data-monaco-anywhere-overlay]")).toHaveCount(1);
        await expect(page.locator("#editor")).toHaveCSS("visibility", "hidden");
        await expectMirrored(page, frame, site, expected);
      }
      await expect(page.locator("html")).toHaveAttribute("data-submit-count", "0");
      expect(page.url()).toBe(site.url);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
