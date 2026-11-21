/*
 * Honest readiness probes for the setup wizard.
 *
 * Nothing here simulates an engine, a download, a native host, or a fixture
 * completion. Every result is derived from the packaged build or from a real
 * Native Messaging attempt. When a prerequisite is absent, the caller must
 * show it as unavailable and must not write onboardingComplete.
 */

import type { BackendChoice } from "../background/state.js";

export const NATIVE_HOST_NAME = "com.monacoanywhere.host";

export interface PackagedState {
  /** Whether the production build recorded real engine artifacts. */
  engineAvailable: boolean;
  /** Number of toolchain packs recorded by the build, when available. */
  packCount: number | null;
  /** Whether the packaged data catalogue could be fetched and parsed. */
  cataloguePresent: boolean;
}

interface BuildInfoShape {
  mode: "bootstrap" | "production";
  engine: { available: boolean; packs?: number };
}

async function readPackagedJson(path: string): Promise<unknown> {
  try {
    const response = await fetch(chrome.runtime.getURL(path), {
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function parseBuildInfo(value: unknown): BuildInfoShape | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const info = value as Record<string, unknown>;
  const mode = info.mode;
  const engine = info.engine;
  if (
    (mode !== "bootstrap" && mode !== "production") ||
    typeof engine !== "object" ||
    engine === null ||
    Array.isArray(engine) ||
    typeof (engine as Record<string, unknown>).available !== "boolean"
  ) {
    return null;
  }
  const engineRecord = engine as Record<string, unknown>;
  const packs =
    typeof engineRecord.packs === "number" &&
    Number.isSafeInteger(engineRecord.packs) &&
    engineRecord.packs >= 0
      ? engineRecord.packs
      : undefined;
  return {
    mode,
    engine: {
      available: engineRecord.available === true,
      ...(packs === undefined ? {} : { packs })
    }
  };
}

/**
 * Read the packaged build info and catalogue. The data-download client is not
 * part of this integration, so resource preparation can never be reported
 * ready here even when engine artifacts are packaged.
 */
export async function probePackagedResources(): Promise<PackagedState> {
  const buildInfo = parseBuildInfo(
    await readPackagedJson("build-info.json")
  );
  // Bootstrap builds deliberately omit the catalogue and engine; only a
  // production build records them, so avoid a predictable 404 in bootstrap.
  const catalogueValue =
    buildInfo?.mode === "production"
      ? await readPackagedJson("data/catalogue.json")
      : null;

  const catalogue =
    typeof catalogueValue === "object" &&
    catalogueValue !== null &&
    !Array.isArray(catalogueValue)
      ? (catalogueValue as Record<string, unknown>)
      : null;
  let cataloguePresent = false;
  let cataloguePackCount: number | null = null;
  if (
    catalogue !== null &&
    catalogue.schema === "monacoanywhere.catalogue/1" &&
    Array.isArray(catalogue.packs)
  ) {
    cataloguePresent = true;
    cataloguePackCount = catalogue.packs.length;
  }

  return {
    engineAvailable: buildInfo?.engine.available === true,
    packCount: buildInfo?.engine.packs ?? cataloguePackCount,
    cataloguePresent
  };
}

export interface ValidationProbe {
  engineAvailable: boolean;
}

/**
 * Report whether a real fixture validation could run. This deliberately sends
 * no completion request and cannot succeed until a real client is integrated:
 * the UI must never report a completion count or write onboardingComplete from
 * this probe.
 */
export async function probeFixtureValidation(
  _backend: BackendChoice
): Promise<ValidationProbe> {
  const packaged = await probePackagedResources();
  return {
    engineAvailable: packaged.engineAvailable
  };
}

export type NativeDetection =
  | { status: "missing"; error: string }
  | { status: "empty" }
  | { status: "failed"; error: string }
  | { status: "responded"; summary: string };

const NATIVE_PROBE_TIMEOUT_MS = 4000;

function safeToken(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/**
 * Summarize a host response without exposing ports, tokens, file paths or
 * arbitrary host content. Only a bounded type/code/version is surfaced.
 */
function summarizeNativeResponse(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return typeof value;
  }
  const response = value as Record<string, unknown>;
  const type = safeToken(response.type, /^[A-Za-z][A-Za-z0-9/._-]{0,63}$/u);
  const code = safeToken(response.code, /^[a-z0-9][a-z0-9-]{0,63}$/u);
  const version =
    safeToken(
      response.clangdVersion,
      /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,79}$/u
    ) ?? safeToken(response.version, /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,79}$/u);
  return [
    type === null ? "unknown" : type,
    code === null ? null : `code=${code}`,
    version === null ? null : `version=${version}`
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * Attempt a real Native Messaging request. With no installed host Chrome
 * reports an error synchronously, which is shown as not detected. A host that
 * answers is reported honestly; this function never claims that language
 * services or validation work.
 */
export function detectNativeHost(): Promise<NativeDetection> {
  const { promise, resolve } = Promise.withResolvers<NativeDetection>();
  let settled = false;
  const finish = (result: NativeDetection): void => {
    if (settled) {
      return;
    }
    settled = true;
    window.clearTimeout(timer);
    resolve(result);
  };

  const timer = window.setTimeout(() => {
    finish({
      status: "failed",
      error: `no response within ${NATIVE_PROBE_TIMEOUT_MS} ms`
    });
  }, NATIVE_PROBE_TIMEOUT_MS);

  try {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { __ma: 1, type: "ma/probe", protocol: 1 },
      (response: unknown) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          finish({
            status: "missing",
            error: lastError.message ?? "native messaging failed"
          });
        } else if (response === null || response === undefined) {
          finish({ status: "empty" });
        } else {
          finish({
            status: "responded",
            summary: summarizeNativeResponse(response)
          });
        }
      }
    );
  } catch (error: unknown) {
    finish({
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return promise;
}
