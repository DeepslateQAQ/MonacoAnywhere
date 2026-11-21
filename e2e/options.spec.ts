import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, expect, test, type Page } from "@playwright/test";

const EXTENSION_ID = "jfhnkcfnnbdagonjcigiilmcebadiccf";
const DIST = path.resolve("dist");
const executablePath =
  process.env.CHROMIUM_EXECUTABLE ?? path.resolve("node_modules/.cache/chromium");

const LIST_PANE = "#ma-options-layout .m3e-pane-scaffold__pane--secondary";
const DETAIL_PANE = "#ma-options-layout .m3e-pane-scaffold__pane--primary";

async function paneDisplays(page: Page): Promise<{ list: string; detail: string }> {
  return {
    list: await page.locator(LIST_PANE).evaluate((element) => getComputedStyle(element).display),
    detail: await page.locator(DETAIL_PANE).evaluate((element) => getComputedStyle(element).display)
  };
}

async function visiblePanels(page: Page): Promise<string[]> {
  return page
    .locator(".ma-panel[data-panel]")
    .evaluateAll((sections) =>
      sections
        .filter((section) => !(section as HTMLElement).hidden)
        .map((section) => (section as HTMLElement).dataset.panel ?? "")
    );
}

test("settings page uses a category list and a settings pane", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "ma-options-"));
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
    await page.setViewportSize({ width: 1180, height: 800 });
    await page.goto(`chrome-extension://${EXTENSION_ID}/options.html`);
    await expect(page.locator("#ma-options-nav-list .m3e-list-item")).toHaveCount(5);
    await expect(page.locator("#ma-options-layout")).toBeVisible();
    await expect(
      page.locator("#ma-theme-group m3e-button-group-item[selected]")
    ).toHaveCount(1);
    await expect(
      page.locator("#ma-locale-group m3e-button-group-item[selected]")
    ).toHaveCount(1);
    await expect(page.locator("#ma-backend-validation")).toContainText(/\S/);
    await expect(page.locator("#ma-validate-backend")).toBeDisabled();

    // Two panes at this width: the categories and one settings section.
    await expect.poll(() => paneDisplays(page)).toEqual({ list: "flex", detail: "flex" });
    await expect.poll(() => visiblePanels(page)).toEqual(["services"]);
    const firstTitle = await page.locator("#ma-panel-title").textContent();
    expect(firstTitle?.trim().length).toBeGreaterThan(0);

    await page
      .locator('#ma-options-nav-list .m3e-list-item[data-value="editor"]')
      .click();
    await expect.poll(() => visiblePanels(page)).toEqual(["editor"]);
    expect(await page.locator("#ma-panel-title").textContent()).not.toBe(firstTitle);
    expect(new URL(page.url()).hash).toBe("#editor");

    // Below 840px the same scaffold shows one pane and navigates on a pick.
    await page.setViewportSize({ width: 720, height: 820 });
    await page.goto(`chrome-extension://${EXTENSION_ID}/options.html`);
    await expect
      .poll(() => paneDisplays(page))
      .toEqual({ list: "flex", detail: "none" });
    await expect(page.locator('[data-pane-navigate="back"]')).toBeHidden();

    await page
      .locator('#ma-options-nav-list .m3e-list-item[data-value="advanced"]')
      .click();
    await expect
      .poll(() => paneDisplays(page))
      .toEqual({ list: "none", detail: "flex" });
    await expect(page.locator('[data-pane-navigate="back"]')).toBeVisible();
    await expect.poll(() => visiblePanels(page)).toEqual(["advanced"]);

    await page.locator('[data-pane-navigate="back"]').click();
    await expect
      .poll(() => paneDisplays(page))
      .toEqual({ list: "flex", detail: "none" });
    await expect(page.locator('[data-pane-navigate="back"]')).toBeHidden();
    expect(new URL(page.url()).hash).toBe("#advanced");

    // The category already carries the selection after Back; tapping it must
    // still reopen its section on a single-pane scaffold.
    await page
      .locator('#ma-options-nav-list .m3e-list-item[data-value="advanced"]')
      .click();
    await expect
      .poll(() => paneDisplays(page))
      .toEqual({ list: "none", detail: "flex" });
    await expect.poll(() => visiblePanels(page)).toEqual(["advanced"]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
