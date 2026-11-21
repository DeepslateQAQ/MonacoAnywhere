import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, expect, test } from "@playwright/test";

const EXTENSION_ID = "jfhnkcfnnbdagonjcigiilmcebadiccf";
const DIST = path.resolve("dist");
const executablePath =
  process.env.CHROMIUM_EXECUTABLE ?? path.resolve("node_modules/.cache/chromium");

test("loads the stable extension ID and the Monaco fixture", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "ma-playwright-"));
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
    const page = await context.newPage();
    await page.goto(`chrome-extension://${EXTENSION_ID}/editor.html?fixture=1`);
    await expect(page.locator("[data-monaco-anywhere-editor] .monaco-editor")).toHaveCount(1);
    await expect(page.locator("#ma-editor-status")).toBeVisible();
    const runtimeId = await page.evaluate(() => chrome.runtime.id);
    expect(runtimeId).toBe(EXTENSION_ID);
    await expect(page.locator("#ma-editor-status")).toContainText(/C\+\+|语言服务|Language services/);

    const standalone = await context.newPage();
    await standalone.goto(
      `chrome-extension://${EXTENSION_ID}/editor.html?standalone=1`
    );
    await expect(
      standalone.locator("[data-monaco-anywhere-editor] .monaco-editor")
    ).toHaveCount(1);
    await expect(standalone.locator("#ma-editor-standard")).toBeVisible();
    await expect(standalone.locator("#ma-editor-standard")).toBeEnabled();
    expect(await standalone.locator(".view-lines").textContent()).toBe("");
    const lineStyle = await standalone
      .locator(".view-lines")
      .getAttribute("style");
    expect(lineStyle).toContain("font-family: monospace");
    expect(lineStyle).toContain('"liga", "calt"');
    await standalone.selectOption("#ma-editor-standard", "c++20");
    await expect(standalone.locator("#ma-editor-standard")).toHaveValue("c++20");
    await standalone.click(".monaco-editor");
    await standalone.keyboard.press("Control+Shift+P");
    await expect(standalone.locator(".quick-input-widget")).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
