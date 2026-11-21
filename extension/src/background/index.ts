/*
 * Service worker for the bootstrap slice.
 *
 * Responsibilities here are deliberately narrow:
 *   - register the MAIN/ISOLATED content script pairs dynamically;
 *   - re-synchronise them on startup and permission changes;
 *   - open the setup page after a fresh install.
 *
 * No OJ adapter, LSP transport, download, or arbitrary chrome API forwarding
 * lives in this slice. Optional origins are never taken from every granted
 * permission: only origins explicitly stored in siteRegistrations:v1 (written
 * by a deliberate user action in a later UI) are considered, then intersected
 * with the permissions Chrome actually reports as granted.
 */
import { installSessionRouter } from "./session-router.js";

installSessionRouter();

const DECLARED_MATCHES = [
  "https://*.luogu.com.cn/*",
  "https://*.luogu.org/*",
  "https://atcoder.jp/*",
  "https://codeforces.com/*",
  "https://*.hydro.ac/*"
] as const;

const DECLARED_MATCH_SET: ReadonlySet<string> = new Set<string>(DECLARED_MATCHES);
const SITE_REGISTRATIONS_KEY = "siteRegistrations:v1";
const OWNED_ID_PREFIXES = ["ma-main:", "ma-iso:", "ma-lsp-decision:"] as const;

interface NarrowOrigin {
  scheme: "*" | "http" | "https";
  host: string;
}

function isOwnedScriptId(id: string): boolean {
  return OWNED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function parseNarrowOriginPattern(value: unknown): NarrowOrigin | null {
  if (typeof value !== "string") {
    return null;
  }
  let candidate = value.trim();
  if (/^(https?|\*):\/\/[^/]+$/.test(candidate)) {
    candidate += "/*";
  } else if (/^(https?|\*):\/\/[^/]+\/$/.test(candidate)) {
    candidate += "*";
  }
  const match = /^(https?|\*):\/\/([^/]+)\/\*$/.exec(candidate);
  if (!match) {
    return null;
  }
  const rawScheme = match[1];
  const rawHost = match[2];
  if (rawScheme !== "http" && rawScheme !== "https" && rawScheme !== "*") {
    return null;
  }
  if (!rawHost) {
    return null;
  }
  const host = rawHost.toLowerCase();
  const hostMatch = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(host);
  const hostname = hostMatch?.[1] ?? "";
  const port = hostMatch?.[2];
  if (
    hostname.length === 0 ||
    hostname === "*" ||
    hostname.startsWith(".") ||
    hostname.includes("*") ||
    hostname.includes("/") ||
    (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
  ) {
    return null;
  }
  return { scheme: rawScheme, host: hostname };
}

function intersectWithGranted(
  approvedPattern: string,
  grantedOrigins: readonly string[]
): string | null {
  const approved = parseNarrowOriginPattern(approvedPattern);
  if (!approved) {
    return null;
  }
  for (const candidate of grantedOrigins) {
    const granted = parseNarrowOriginPattern(candidate);
    if (!granted || granted.host !== approved.host) {
      continue;
    }
    if (
      approved.scheme !== "*" &&
      granted.scheme !== "*" &&
      approved.scheme !== granted.scheme
    ) {
      continue;
    }
    const scheme = approved.scheme === "*" ? granted.scheme : approved.scheme;
    return `${scheme}://${approved.host}/*`;
  }
  return null;
}

function assertRegistrable(match: string): void {
  if (match === "<all_urls>" || match.includes("*://*/*")) {
    throw new Error(`Refusing broad content-script match: ${match}`);
  }
}

function makeScript(
  match: string,
  world: "MAIN" | "ISOLATED",
  file: string
): chrome.scripting.RegisteredContentScript {
  assertRegistrable(match);
  return {
    id: `${world === "MAIN" ? "ma-main:" : "ma-iso:"}${match}`,
    js: [file],
    matches: [match],
    runAt: "document_idle",
    allFrames: false,
    persistAcrossSessions: true,
    world
  };
}

async function readApprovedOrigins(): Promise<string[]> {
  const stored = await chrome.storage.local.get(SITE_REGISTRATIONS_KEY);
  const value: unknown = stored[SITE_REGISTRATIONS_KEY];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

async function buildDesiredScripts(): Promise<
  Map<string, chrome.scripting.RegisteredContentScript>
> {
  const desired = new Map<string, chrome.scripting.RegisteredContentScript>();

  const add = (match: string): void => {
    const mainScript = {
      ...makeScript(match, "MAIN", "content-main.js"),
      runAt: "document_start" as const
    };
    const isolatedScript = makeScript(match, "ISOLATED", "content-isolated.js");
    desired.set(mainScript.id, mainScript);
    desired.set(isolatedScript.id, isolatedScript);
    const decisionScript = {
      ...makeScript(match, "ISOLATED", "content-lsp-decision.js"),
      id: `ma-lsp-decision:${match}`,
      runAt: "document_start" as const
    };
    desired.set(decisionScript.id, decisionScript);
  };

  for (const match of DECLARED_MATCHES) {
    add(match);
  }

  const approvedOrigins = await readApprovedOrigins();
  if (approvedOrigins.length > 0) {
    const permissions = await chrome.permissions.getAll();
    const grantedOrigins = permissions.origins ?? [];
    const optionalMatches = new Set<string>();
    for (const approved of approvedOrigins) {
      const intersection = intersectWithGranted(approved, grantedOrigins);
      if (intersection) {
        optionalMatches.add(intersection);
      }
    }
    for (const match of [...optionalMatches].sort()) {
      if (!DECLARED_MATCH_SET.has(match)) {
        add(match);
      }
    }
  }

  return desired;
}

function sameStringArray(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameScript(
  existing: chrome.scripting.RegisteredContentScript,
  desired: chrome.scripting.RegisteredContentScript
): boolean {
  return (
    sameStringArray(existing.js, desired.js) &&
    sameStringArray(existing.matches, desired.matches) &&
    (existing.runAt ?? "document_idle") === desired.runAt &&
    (existing.allFrames ?? false) === desired.allFrames &&
    (existing.world ?? "ISOLATED") === desired.world &&
    (existing.persistAcrossSessions ?? true) === desired.persistAcrossSessions
  );
}

async function syncDynamicContentScripts(): Promise<void> {
  const desired = await buildDesiredScripts();
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const existingById = new Map(existing.map((script) => [script.id, script]));

  const staleIds = existing
    .filter((script) => {
      if (!isOwnedScriptId(script.id)) {
        return false;
      }
      const wanted = desired.get(script.id);
      return !wanted || !sameScript(script, wanted);
    })
    .map((script) => script.id);
  if (staleIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: staleIds });
  }

  const toRegister: chrome.scripting.RegisteredContentScript[] = [];
  for (const script of desired.values()) {
    const current = existingById.get(script.id);
    if (!current || !sameScript(current, script)) {
      toRegister.push(script);
    }
  }

  for (const script of toRegister) {
    try {
      await chrome.scripting.registerContentScripts([script]);
    } catch (error) {
      console.error(`[MonacoAnywhere] Failed to register content script ${script.id}`, error);
    }
  }
}

let syncChain: Promise<void> = Promise.resolve();

function scheduleContentScriptSync(): void {
  syncChain = syncChain
    .then(syncDynamicContentScripts)
    .catch((error: unknown) => {
      console.error("[MonacoAnywhere] Content-script registration failed", error);
    });
}

async function openOnboarding(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
}

function isOpenOnboardingMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 2 &&
    keys.every((key) => key === "__ma" || key === "type") &&
    record.__ma === 1 &&
    record.type === "ma/open-onboarding"
  );
}

chrome.runtime.onInstalled.addListener((details) => {
  scheduleContentScriptSync();
  if (details.reason === "install") {
    void openOnboarding().catch((error: unknown) => {
      console.error("[MonacoAnywhere] Could not open onboarding", error);
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  scheduleContentScriptSync();
});

chrome.permissions.onAdded.addListener(() => {
  scheduleContentScriptSync();
});

chrome.permissions.onRemoved.addListener(() => {
  scheduleContentScriptSync();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    Object.prototype.hasOwnProperty.call(changes, SITE_REGISTRATIONS_KEY)
  ) {
    scheduleContentScriptSync();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }
  if (isOpenOnboardingMessage(message)) {
    void openOnboarding()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error: unknown) => {
        console.error("[MonacoAnywhere] Could not open onboarding", error);
        sendResponse({ ok: false });
      });
    return true;
  }
  if (
    typeof message === "object" &&
    message !== null &&
    !Array.isArray(message) &&
    (message as Record<string, unknown>).__ma === 1 &&
    (message as Record<string, unknown>).type === "ma/keepalive"
  ) {
    sendResponse({ ok: true });
    return false;
  }
  if (
    typeof message === "object" &&
    message !== null &&
    !Array.isArray(message) &&
    (message as Record<string, unknown>).__ma === 1 &&
    (message as Record<string, unknown>).type === "ma/sync-sites"
  ) {
    scheduleContentScriptSync();
    void syncChain
      .then(async () => {
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        sendResponse({
          ok: true,
          scripts: scripts.map((script) => script.id)
        });
      })
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
  return false;
});

// Content scripts are (re)registered by install/permission/storage events and
// on an explicit ma/sync-sites request. Do not call the async registration
// chain during worker evaluation: a pending registration can keep the service
// worker from answering the first backend port.
