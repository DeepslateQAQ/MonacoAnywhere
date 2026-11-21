import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  clearOnboardingCompletion,
  getSettings,
  markOnboardingComplete,
  normalizeSettings,
  subscribeSettings,
  updateSettings,
  type Settings
} from "../extension/src/background/state";

interface MockStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

type MockListener = (
  changes: Record<string, MockStorageChange>,
  areaName: "local" | "sync" | "managed" | "session"
) => void;

interface ChromeMock {
  data: Map<string, unknown>;
  readBarrier: Promise<void> | null;
  writeRaw(key: string, value: unknown): void;
  emitChange(changes: Record<string, MockStorageChange>): void;
}

// Test-only global installation; the extension uses the real chrome namespace.
const globalScope = globalThis as typeof globalThis & { chrome?: unknown };
const originalChrome = globalScope.chrome;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve };
}

function installChromeMock(): ChromeMock {
  const data = new Map<string, unknown>();
  const listeners = new Set<MockListener>();
  const mock: ChromeMock = {
    data,
    readBarrier: null,
    writeRaw(key, value) {
      const oldValue = data.get(key);
      data.set(key, clone(value));
      mock.emitChange({ [key]: { oldValue, newValue: clone(value) } });
    },
    emitChange(changes) {
      for (const listener of listeners) {
        listener(clone(changes), "local");
      }
    }
  };

  const local = {
    async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
      if (mock.readBarrier) {
        await mock.readBarrier;
      }
      if (keys === undefined || keys === null) {
        return Object.fromEntries(
          [...data.entries()].map(([key, value]) => [key, clone(value)])
        );
      }
      const wanted = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of wanted) {
        if (data.has(key)) {
          result[key] = clone(data.get(key));
        }
      }
      return result;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      const changes: Record<string, MockStorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        const oldValue = data.get(key);
        data.set(key, clone(value));
        changes[key] = { oldValue, newValue: clone(value) };
      }
      if (Object.keys(changes).length > 0) {
        mock.emitChange(changes);
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        data.delete(key);
      }
    },
    async clear(): Promise<void> {
      data.clear();
    }
  };

  globalScope.chrome = {
    storage: {
      local,
      onChanged: {
        addListener(listener: MockListener) {
          listeners.add(listener);
        },
        removeListener(listener: MockListener) {
          listeners.delete(listener);
        }
      }
    }
  };
  return mock;
}

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

afterEach(() => {
  if (originalChrome === undefined) {
    delete globalScope.chrome;
  } else {
    globalScope.chrome = originalChrome;
  }
});

describe("stored settings normalization", () => {
  it("replaces hostile or malformed stored fields with honest defaults", async () => {
    const hostile = JSON.parse(
      JSON.stringify({
        backend: "definitely-wasm",
        siteBackends: {
          "https://oj.example": "wasm",
          "https://slow.example": "bogus",
          "https://private.example/d/abc": "native",
          "__proto__": "site"
        },
        theme: "neon",
        locale: "fr-CA",
        hiddenPauseMs: -5,
        clangdPath: 42,
        queryDriverAllowlist: [" -I/a ", "-I/a", 2, "", "  "],
        extraIncludeDirs: "not-an-array",
        editorFontFamily: "   ",
        editorTheme: 12,
        onboardingComplete: "yes",
        unexpectedField: { nested: true }
      })
    );
    mock.writeRaw(SETTINGS_STORAGE_KEY, hostile);

    const settings = await getSettings();
    expect(settings).toEqual({
      backend: null,
      siteBackends: {
        "https://oj.example": "wasm",
        "https://private.example/d/abc": "native"
      },
      theme: "system",
      locale: "auto",
      hiddenPauseMs: 30_000,
      queryDriverAllowlist: ["-I/a"],
      extraIncludeDirs: [],
      editorFontFamily: "monospace",
      editorTheme: "vs-dark",
      onboardingComplete: false
    });
    expect("unexpectedField" in settings).toBe(false);
    expect("clangdPath" in settings).toBe(false);
    expect(
      normalizeSettings({
        editorFontFamily: '"IBM Plex Mono", Consolas, monospace'
      }).editorFontFamily
    ).toBe("monospace");
  });

  it("normalizes null and non-object storage without throwing", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("garbage")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it("discards a completion stored without a selected backend", async () => {
    mock.writeRaw(SETTINGS_STORAGE_KEY, {
      backend: null,
      onboardingComplete: true
    });
    const settings = await getSettings();
    expect(settings.backend).toBeNull();
    expect(settings.onboardingComplete).toBe(false);
  });
});

describe("concurrent partial patches", () => {
  it("merges two concurrent updates without a last-write clobber", async () => {
    const gate = deferred();
    mock.readBarrier = gate.promise;

    const first = updateSettings({ theme: "dark" });
    const second = updateSettings({
      locale: "en",
      queryDriverAllowlist: [" -I/first ", "-I/first"]
    });
    mock.readBarrier = null;
    gate.resolve();
    await Promise.all([first, second]);

    const settings = await getSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.locale).toBe("en");
    expect(settings.queryDriverAllowlist).toEqual(["-I/first"]);
  });

  it("ignores invalid patch values and keeps the stored value", async () => {
    await updateSettings({ theme: "light", editorTheme: "vs" });

    const next = await updateSettings({
      theme: "disco",
      hiddenPauseMs: 0,
      siteBackends: { "https://oj.example": "mystery" },
      onboardingComplete: true
    } as unknown as Partial<Settings>);

    expect(next.theme).toBe("light");
    expect(next.hiddenPauseMs).toBe(30_000);
    expect(next.siteBackends).toEqual({});
    expect(next.onboardingComplete).toBe(false);
    expect((await getSettings()).editorTheme).toBe("vs");
  });

  it("merges per-site backend patches and deletes entries explicitly", async () => {
    await updateSettings({
      siteBackends: {
        "https://a.example": "wasm",
        "https://b.example": "native"
      }
    });

    let settings = await updateSettings({
      siteBackends: { "https://b.example": "site" }
    });
    expect(settings.siteBackends).toEqual({
      "https://a.example": "wasm",
      "https://b.example": "site"
    });

    settings = await updateSettings({
      siteBackends: { "https://a.example": undefined }
    } as unknown as Partial<Settings>);
    expect(settings.siteBackends).toEqual({ "https://b.example": "site" });
  });

  it("clears the optional clangd path with undefined or an empty string", async () => {
    let settings = await updateSettings({ clangdPath: " /usr/bin/clangd " });
    expect(settings.clangdPath).toBe("/usr/bin/clangd");

    settings = await updateSettings({ clangdPath: "" });
    expect("clangdPath" in settings).toBe(false);

    await updateSettings({ clangdPath: "/opt/clangd" });
    settings = await updateSettings({ clangdPath: undefined });
    expect("clangdPath" in settings).toBe(false);
  });
});

describe("onboarding completion guard", () => {
  it("cannot be set through updateSettings", async () => {
    await updateSettings({ backend: "wasm" });
    await markOnboardingComplete("wasm");

    const settings = await updateSettings({ onboardingComplete: false });
    expect(settings.onboardingComplete).toBe(true);
    expect((await getSettings()).onboardingComplete).toBe(true);
  });

  it("is invalidated by a backend change and can be cleared explicitly", async () => {
    await updateSettings({ backend: "wasm" });
    await markOnboardingComplete("wasm");

    let settings = await updateSettings({ backend: "native" });
    expect(settings.onboardingComplete).toBe(false);

    await expect(markOnboardingComplete("wasm")).rejects.toThrow(
      /backend changed/i
    );
    settings = await markOnboardingComplete("native");
    expect(settings.onboardingComplete).toBe(true);

    settings = await clearOnboardingCompletion();
    expect(settings.onboardingComplete).toBe(false);
  });

  it("requires a selected backend", async () => {
    await expect(markOnboardingComplete()).rejects.toThrow(
      /without a selected backend/i
    );
  });
});

describe("settings subscription", () => {
  it("reports normalized changes from other extension contexts", async () => {
    const seen: Settings[] = [];
    const unsubscribe = subscribeSettings((settings) => {
      seen.push(settings);
    });

    await updateSettings({ theme: "dark" });
    expect(seen.at(-1)?.theme).toBe("dark");

    mock.writeRaw(SETTINGS_STORAGE_KEY, {
      backend: "native",
      theme: "bogus",
      hiddenPauseMs: 12_000,
      onboardingComplete: true
    });
    expect(seen.at(-1)).toMatchObject({
      backend: "native",
      theme: "system",
      hiddenPauseMs: 12_000,
      onboardingComplete: true
    });

    unsubscribe();
    const count = seen.length;
    await updateSettings({ theme: "light" });
    expect(seen.length).toBe(count);
  });
});

describe("defaults", () => {
  it("never preselect a backend or claim completion", () => {
    expect(DEFAULT_SETTINGS.backend).toBeNull();
    expect(DEFAULT_SETTINGS.onboardingComplete).toBe(false);
    expect(DEFAULT_SETTINGS.hiddenPauseMs).toBe(30_000);
  });
});
