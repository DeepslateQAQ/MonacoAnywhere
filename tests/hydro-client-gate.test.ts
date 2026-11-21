import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installHydroClientGate,
  type HydroClientGate
} from "../extension/src/lsp/hydro-client-gate";

const ORIGIN = "https://yundouxueyuan.com";
const PAGE_PATH = "/d/SZXQ/p/A101";
const LSP_PATH = "/lsp-a2f6d0c5.js";

interface TestDocument {
  baseURI: string;
  currentScript: { src: string } | null;
}

interface TestWindow {
  location: { href: string };
  document: TestDocument;
  externalModules?: Record<string, string>;
  __Hydro_lsp_loaded?: boolean;
  exports?: unknown;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

function makeWindow(): TestWindow {
  return {
    location: { href: `${ORIGIN}${PAGE_PATH}` },
    document: {
      baseURI: `${ORIGIN}${PAGE_PATH}`,
      currentScript: null
    },
    setTimeout(handler, ms) {
      return globalThis.setTimeout(handler, ms) as unknown as number;
    },
    clearTimeout(id) {
      globalThis.clearTimeout(id);
    }
  };
}

function install(win: TestWindow): HydroClientGate {
  return installHydroClientGate(win as unknown as Window);
}

function setHydroLspModules(win: TestWindow, path = LSP_PATH): void {
  win.externalModules = {
    "monaco-cpp@lsp": path,
    "monaco-c@lsp": path,
    "monaco-python@lsp": path,
    "monaco-java@lsp": path
  };
}

function assignFromScript(
  win: TestWindow,
  path: string,
  value: unknown
): void {
  win.document.currentScript = {
    src: new URL(path, win.document.baseURI).href
  };
  try {
    win.exports = value;
  } finally {
    win.document.currentScript = null;
  }
}

function assignLspExport(win: TestWindow, factory: unknown): void {
  assignFromScript(win, LSP_PATH, factory);
}

function exportedCallable(
  win: TestWindow
): (...args: unknown[]) => unknown {
  const value = win.exports;
  if (typeof value !== "function") {
    throw new Error("expected window.exports to be callable");
  }
  return value as (...args: unknown[]) => unknown;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Hydro client LSP gate", () => {
  it("returns one controller per Window", () => {
    const win = makeWindow();
    const first = install(win);
    expect(install(win)).toBe(first);
  });

  it("forwards unrelated window.exports assignments unchanged", () => {
    const win = makeWindow();
    setHydroLspModules(win);
    const gate = install(win);

    const nativeExport = function nativeExport(): string {
      return "native";
    };
    assignFromScript(win, "/assets/app.js", nativeExport);
    expect(win.exports).toBe(nativeExport);

    const lspFactory = vi.fn();
    assignLspExport(win, lspFactory);
    expect(win.exports).not.toBe(lspFactory);
    expect(gate.status()).toBe("none");

    const replacement = { module: "other" };
    assignFromScript(win, "/assets/other.js", replacement);
    expect(win.exports).toBe(replacement);
  });

  it("preserves a data property's enumerability while forwarding writes", () => {
    const win = makeWindow();
    const initial = { before: true };
    Object.defineProperty(win, "exports", {
      value: initial,
      writable: true,
      enumerable: false,
      configurable: true
    });

    const gate = install(win);
    const descriptor = Object.getOwnPropertyDescriptor(win, "exports");
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.configurable).toBe(true);
    expect(win.exports).toBe(initial);

    const next = vi.fn();
    win.exports = next;
    expect(win.exports).toBe(next);
    expect(gate.status()).toBe("none");
  });

  it("chains a pre-existing exports accessor for unrelated values", () => {
    const win = makeWindow();
    let stored: unknown = "initial";
    Object.defineProperty(win, "exports", {
      configurable: true,
      enumerable: true,
      get() {
        return stored;
      },
      set(value: unknown) {
        stored = value;
      }
    });

    install(win);
    expect(win.exports).toBe("initial");
    win.exports = "next";
    expect(win.exports).toBe("next");
    expect(stored).toBe("next");

    setHydroLspModules(win);
    const factory = vi.fn();
    assignLspExport(win, factory);
    expect(win.exports).not.toBe(factory);
    expect(stored).toBe(factory);
  });

  it("defers a recognized factory until site is configured", async () => {
    const win = makeWindow();
    setHydroLspModules(win);
    const gate = install(win);
    const monaco = { editor: {} };
    const factory = vi.fn();

    assignLspExport(win, factory);
    const pending = exportedCallable(win)(monaco) as Promise<unknown>;

    expect(factory).not.toHaveBeenCalled();
    expect(pending).toBeInstanceOf(Promise);
    expect(gate.status()).toBe("none");

    expect(gate.configure("site")).toBe("active");
    await expect(pending).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(monaco);
    expect(gate.status()).toBe("active");

    expect(gate.configure("site")).toBe("active");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("skips a recognized factory in local mode without side effects", () => {
    const win = makeWindow();
    const gate = install(win);
    expect(gate.configure("local")).toBe("suspended");
    expect(gate.status()).toBe("suspended");

    setHydroLspModules(win);
    const factory = vi.fn();
    assignLspExport(win, factory);

    expect(exportedCallable(win)({ editor: {} })).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    expect(win.__Hydro_lsp_loaded).toBeUndefined();
    expect(gate.status()).toBe("suspended");
  });

  it("requires a reload when local is chosen after the site factory ran", () => {
    const win = makeWindow();
    setHydroLspModules(win);
    const gate = install(win);
    expect(gate.configure("site")).toBe("none");

    const factory = vi.fn(() => {
      win.__Hydro_lsp_loaded = true;
    });
    assignLspExport(win, factory);
    expect(exportedCallable(win)({})).toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(gate.status()).toBe("active");

    expect(gate.configure("local")).toBe("reload-required");
    expect(gate.status()).toBe("reload-required");
    expect(gate.configure("local")).toBe("reload-required");

    expect(gate.configure("site")).toBe("active");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("requires a reload when site is chosen after a skip and never replays", () => {
    const win = makeWindow();
    setHydroLspModules(win);
    const gate = install(win);
    expect(gate.configure("local")).toBe("suspended");

    const factory = vi.fn(() => {
      win.__Hydro_lsp_loaded = true;
    });
    assignLspExport(win, factory);
    expect(exportedCallable(win)({})).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();

    expect(gate.configure("site")).toBe("reload-required");
    expect(gate.status()).toBe("reload-required");
    expect(exportedCallable(win)({})).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    expect(win.__Hydro_lsp_loaded).toBeUndefined();

    expect(gate.configure("site")).toBe("reload-required");
  });

  it("fails open after the deadline and reports active", async () => {
    const win = makeWindow();
    setHydroLspModules(win);
    const gate = install(win);
    const factory = vi.fn(() => {
      win.__Hydro_lsp_loaded = true;
    });

    assignLspExport(win, factory);
    const pending = exportedCallable(win)({ editor: {} }) as Promise<unknown>;
    expect(factory).not.toHaveBeenCalled();
    expect(gate.status()).toBe("none");

    await vi.advanceTimersByTimeAsync(2_000);
    await pending;

    expect(factory).toHaveBeenCalledTimes(1);
    expect(gate.status()).toBe("active");
    expect(gate.configure("local")).toBe("reload-required");
    expect(gate.status()).toBe("reload-required");
  });

  it("reports an already loaded runtime as active, never suspended", () => {
    const win = makeWindow();
    win.__Hydro_lsp_loaded = true;
    const gate = install(win);

    expect(gate.status()).toBe("active");
    expect(gate.configure("local")).toBe("reload-required");
    expect(gate.status()).toBe("reload-required");
    expect(gate.configure("site")).toBe("active");
  });

  it("reports an old runtime as active even when the hook is unavailable", () => {
    const win = makeWindow();
    Object.defineProperty(win, "exports", {
      value: vi.fn(),
      writable: true,
      enumerable: true,
      configurable: false
    });
    win.__Hydro_lsp_loaded = true;

    const gate = install(win);
    expect(gate.status()).toBe("active");
    expect(gate.configure("local")).toBe("reload-required");
  });

  it("detects a late untracked runtime instead of claiming suspension", () => {
    const win = makeWindow();
    const gate = install(win);
    expect(gate.configure("local")).toBe("suspended");

    win.__Hydro_lsp_loaded = true;
    expect(gate.status()).toBe("reload-required");
    expect(gate.configure("local")).toBe("reload-required");
  });

  it("fails closed when the exports hook is non-configurable", () => {
    const win = makeWindow();
    const original = vi.fn();
    Object.defineProperty(win, "exports", {
      value: original,
      writable: true,
      enumerable: true,
      configurable: false
    });

    const gate = install(win);
    expect(gate.status()).toBe("unsupported");
    expect(gate.configure("local")).toBe("unsupported");
    expect(gate.configure("site")).toBe("unsupported");
    expect(win.exports).toBe(original);
  });

  it("fails closed when another script replaces the exports hook", () => {
    const win = makeWindow();
    const gate = install(win);
    expect(gate.status()).toBe("none");

    Object.defineProperty(win, "exports", {
      value: "replaced",
      writable: false,
      enumerable: true,
      configurable: false
    });

    expect(gate.status()).toBe("unsupported");
    expect(gate.configure("local")).toBe("unsupported");
  });

  it("leaves LSP-like scripts untracked unless key and URL match", () => {
    const win = makeWindow();
    win.externalModules = { "monaco-cpp@v1": LSP_PATH };
    const gate = install(win);

    const factory = vi.fn();
    assignLspExport(win, factory);
    expect(win.exports).toBe(factory);
    expect(gate.status()).toBe("none");

    setHydroLspModules(win);
    const otherFactory = vi.fn();
    assignFromScript(win, "/assets/app.js", otherFactory);
    expect(win.exports).toBe(otherFactory);
    expect(gate.status()).toBe("none");
  });
});
