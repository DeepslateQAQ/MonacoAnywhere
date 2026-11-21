/*
 * Client-owned suspension of the Hydro language-server bundle.
 *
 * Hydro loads one legacy external module for every monaco-(cpp|c|python|java)
 * LSP feature. That bundle assigns its initializer to `window.exports`; Hydro's
 * loader reads the value after the script's load event and invokes it with the
 * page's monaco namespace. The initializer then installs Monaco services,
 * model/visibility listeners, and its own WebSockets inside a closure. There is
 * no stop handle, no provider to dispose, and diagnostics are only a symptom.
 *
 * The one observable point before those side effects is the `window.exports`
 * assignment made by the recognized script. This gate withholds that
 * initializer when the local backend is selected and otherwise forwards calls
 * unchanged. Every observed LSP feature key resolves to the same bundle, so the
 * whole bundle is paused on this page, not a single language. The decision is
 * page-local: it neither modifies the Hydro server/addon nor sends client code.
 *
 * The gate starts pending so an early decision from the isolated world can
 * arrive before the loader invokes the initializer. If no decision arrives (for
 * example, an extension update removed the companion script from a loaded
 * page), a bounded deadline forwards the pending invocation, restoring native
 * site behavior. It never reports `suspended` after an initializer has run.
 *
 * Recovery is a reload. After a skipped initializer, replaying it into models
 * that already exist is unsafe, so switching back to `site` reports
 * `reload-required`. If the site initializer already ran, its closure cannot be
 * stopped from outside, so choosing `local` also reports `reload-required`.
 * This module never reloads the page, stores settings, or uses Chrome APIs.
 *
 * Only an assignment made while `document.currentScript.src` exactly equals a
 * resolved `externalModules` URL for a monaco-(cpp|c|python|java)@lsp feature is
 * intercepted. Other `window.exports` assignments and their data/accessor
 * behavior are forwarded.
 */

import { isRecord } from "./json.js";

export type HydroClientLspState =
  | "none"
  | "active"
  | "suspended"
  | "reload-required"
  | "unsupported";

export interface HydroClientGate {
  /** Current page-local state. Safe to call before or after configuration. */
  status(): HydroClientLspState;
  /**
   * Choose whether the Hydro initializer may run. Idempotent for a repeated
   * mode; a transition that would require replaying or stopping an already
   * executed initializer returns `reload-required` instead.
   */
  configure(mode: "site" | "local"): HydroClientLspState;
}

type GateMode = "site" | "local";
type ExportFunction = (this: unknown, ...args: unknown[]) => unknown;

interface PendingInvocation {
  readonly initializer: ExportFunction;
  readonly thisArg: unknown;
  readonly args: unknown[];
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

/** Feature keys are exact; a version suffix other than `@lsp` is not ours. */
const HYDRO_LSP_FEATURE = /^monaco-(?:cpp|c|python|java)@lsp$/;
const FAIL_OPEN_TIMEOUT_MS = 2_000;

const gates = new WeakMap<Window, HydroClientGate>();

/** One controller per Window; repeat calls share the installed hook. */
export function installHydroClientGate(win: Window): HydroClientGate {
  const existing = gates.get(win);
  if (existing !== undefined) return existing;
  const gate = createHydroClientGate(win);
  gates.set(win, gate);
  return gate;
}

function createHydroClientGate(win: Window): HydroClientGate {
  let mode: GateMode | null = null;
  let skipped = false;
  /** The gate invoked the original initializer at least once. */
  let started = false;
  let intercepted: ExportFunction | null = null;
  let pending: PendingInvocation[] = [];
  let deadline: number | null = null;

  let hookInstalled = false;
  let nativeGetter: (() => unknown) | null = null;
  let nativeSetter: ((value: unknown) => void) | null = null;
  let nativeValue: unknown;

  function readExports(): unknown {
    if (intercepted !== null) return intercepted;
    if (nativeGetter !== null) return nativeGetter.call(win);
    return nativeValue;
  }

  function writeExports(value: unknown): void {
    if (isHydroLspExportAssignment(win)) {
      intercepted = interceptExport(value);
      // Keep the native property's own state consistent for later readers.
      if (nativeSetter !== null) nativeSetter.call(win, value);
      else nativeValue = value;
      return;
    }
    intercepted = null;
    if (nativeSetter !== null) {
      nativeSetter.call(win, value);
      return;
    }
    nativeValue = value;
  }

  function interceptExport(value: unknown): ExportFunction {
    return function interceptedHydroExport(
      this: unknown,
      ...args: unknown[]
    ): unknown {
      return invoke(value, this, args);
    };
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(win, "exports");
    let hookable = true;
    let enumerable = true;
    if (descriptor !== undefined) {
      enumerable = descriptor.enumerable === true;
      if (!descriptor.configurable) {
        hookable = false;
      } else if ("value" in descriptor) {
        if (descriptor.writable === false) {
          hookable = false;
        } else {
          nativeValue = descriptor.value;
        }
      } else {
        const getter = descriptor.get;
        const setter = descriptor.set;
        if (typeof getter === "function") {
          nativeGetter = () => getter.call(win);
        }
        if (typeof setter === "function") {
          nativeSetter = (value: unknown) => setter.call(win, value);
        } else {
          // An assignment hook we cannot observe would make suspension a lie.
          hookable = false;
        }
      }
    }
    if (hookable) {
      Object.defineProperty(win, "exports", {
        configurable: true,
        enumerable,
        get: readExports,
        set: writeExports
      });
      hookInstalled = true;
    }
  } catch {
    hookInstalled = false;
  }

  function hookAvailable(): boolean {
    if (!hookInstalled) return false;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(win, "exports");
      return (
        descriptor !== undefined &&
        descriptor.get === readExports &&
        descriptor.set === writeExports
      );
    } catch {
      return false;
    }
  }

  function status(): HydroClientLspState {
    if (runtimeAlreadyStarted(win)) {
      return mode === "local" ? "reload-required" : "active";
    }
    if (!hookAvailable()) return "unsupported";
    if (started) {
      return mode === "local" ? "reload-required" : "active";
    }
    if (skipped) {
      return mode === "site" ? "reload-required" : "suspended";
    }
    // Local mode is a standing promise: a recognized initializer that loads
    // later will be withheld, even if the module has not been captured yet.
    if (mode === "local") return "suspended";
    return "none";
  }

  function configure(next: GateMode): HydroClientLspState {
    if (runtimeAlreadyStarted(win)) {
      mode = next;
      if (next === "local") {
        releasePending(false, false);
        return "reload-required";
      }
      releasePending(true, false);
      return "active";
    }
    if (!hookAvailable()) return "unsupported";
    if (started) {
      mode = next;
      if (next === "local") {
        releasePending(false, false);
        return "reload-required";
      }
      releasePending(true, false);
      return "active";
    }
    if (skipped) {
      mode = next;
      if (next === "site") {
        releasePending(false, false);
        return "reload-required";
      }
      releasePending(false, false);
      return "suspended";
    }
    mode = next;
    if (next === "site") {
      releasePending(true, false);
      return started ? "active" : "none";
    }
    releasePending(false, true);
    return status();
  }

  function invoke(
    value: unknown,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    if (skipped) return undefined;
    if (mode === "local") {
      // Do not mark a skip when an untracked runtime already ran; that state
      // is reload-required, not suspended.
      if (!runtimeAlreadyStarted(win)) skipped = true;
      return undefined;
    }
    const initializer = resolveInitializer(value);
    if (initializer === null) return undefined;
    if (mode === "site" || started || runtimeAlreadyStarted(win)) {
      return callInitializer(initializer, thisArg, args);
    }
    return deferInvocation(initializer, thisArg, args);
  }

  function callInitializer(
    initializer: ExportFunction,
    thisArg: unknown,
    args: unknown[]
  ): unknown {
    started = true;
    return Reflect.apply(initializer, thisArg, args);
  }

  function deferInvocation(
    initializer: ExportFunction,
    thisArg: unknown,
    args: unknown[]
  ): Promise<unknown> {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    pending.push({ initializer, thisArg, args, resolve, reject });
    scheduleDeadline();
    return promise;
  }

  function scheduleDeadline(): void {
    if (deadline !== null || mode !== null) return;
    try {
      deadline = win.setTimeout(() => {
        deadline = null;
        if (mode !== null) return;
        mode = "site";
        releasePending(true, false);
      }, FAIL_OPEN_TIMEOUT_MS);
    } catch {
      deadline = null;
      mode = "site";
      releasePending(true, false);
    }
  }

  function clearDeadline(): void {
    if (deadline === null) return;
    try {
      win.clearTimeout(deadline);
    } catch {
      // Teardown of a deadline must never affect the page.
    }
    deadline = null;
  }

  function releasePending(invokeSite: boolean, markSkipped: boolean): void {
    const calls = pending;
    pending = [];
    clearDeadline();
    if (calls.length === 0) return;
    if (invokeSite) {
      started = true;
      for (const call of calls) {
        try {
          call.resolve(
            Reflect.apply(call.initializer, call.thisArg, call.args)
          );
        } catch (error) {
          call.reject(error);
        }
      }
      return;
    }
    if (markSkipped) skipped = true;
    for (const call of calls) call.resolve(undefined);
  }

  return { status, configure };
}

function readWindowValue(win: Window, key: string): unknown {
  try {
    return Reflect.get(win, key);
  } catch {
    return undefined;
  }
}

function documentBaseUrl(win: Window): string | null {
  try {
    const base = win.document?.baseURI;
    if (typeof base === "string" && base.length > 0) return base;
  } catch {
    // Fall through to location.
  }
  try {
    const href = win.location?.href;
    if (typeof href === "string" && href.length > 0) return href;
  } catch {
    // No usable document URL.
  }
  return null;
}

function resolvePageUrl(win: Window, value: string): string | null {
  const base = documentBaseUrl(win);
  try {
    return base === null ? new URL(value).href : new URL(value, base).href;
  } catch {
    return null;
  }
}

function currentScriptSource(win: Window): string | null {
  try {
    const script = win.document?.currentScript;
    if (script === null || script === undefined) return null;
    const source = Reflect.get(script, "src");
    return typeof source === "string" && source.length > 0 ? source : null;
  } catch {
    return null;
  }
}

function hydroLspFeatureValues(win: Window): string[] {
  const modules = readWindowValue(win, "externalModules");
  if (!isRecord(modules)) return [];
  const values: string[] = [];
  try {
    for (const [name, value] of Object.entries(modules)) {
      if (
        HYDRO_LSP_FEATURE.test(name) &&
        typeof value === "string" &&
        value.length > 0
      ) {
        values.push(value);
      }
    }
  } catch {
    return [];
  }
  return values;
}

function isHydroLspExportAssignment(win: Window): boolean {
  const source = currentScriptSource(win);
  if (source === null) return false;
  const resolvedSource = resolvePageUrl(win, source);
  if (resolvedSource === null) return false;
  return hydroLspFeatureValues(win).some(
    (url) => resolvePageUrl(win, url) === resolvedSource
  );
}

function runtimeAlreadyStarted(win: Window): boolean {
  return readWindowValue(win, "__Hydro_lsp_loaded") === true;
}

function resolveInitializer(value: unknown): ExportFunction | null {
  if (typeof value === "function") return value as ExportFunction;
  if (!isRecord(value)) return null;
  try {
    if (typeof value.default === "function") {
      return value.default as ExportFunction;
    }
    if (typeof value.apply === "function") {
      return value.apply as ExportFunction;
    }
  } catch {
    return null;
  }
  return null;
}
