import { loadBundledCatalogue } from "../data/catalogue.js";
import { getSettings } from "./state.js";
import { startNativeSession, stopNativeSession } from "./native.js";
import { onOffscreenMessage, sendOffscreen } from "./offscreen.js";
import type { OffscreenOutgoing } from "../offscreen/protocol.js";

const sessions = new Map<string, chrome.runtime.Port>();
let routerInstalled = false;

function sendError(
  port: chrome.runtime.Port,
  sessionId: string,
  code: string,
  message: string
): void {
  port.postMessage({
    type: "ma/backend-error",
    sessionId,
    code,
    message
  });
}

async function openSession(
  port: chrome.runtime.Port,
  sessionId: string,
  requestedBackend: "wasm" | "native" | null
): Promise<void> {
  const settings = await getSettings();
  const backend = requestedBackend ?? settings.backend;
  if (backend === null) {
    sendError(port, sessionId, "onboarding-required", "Choose a backend in setup first.");
    return;
  }
  let packId: string | null = null;
  let native: { port: number; token: string } | null = null;
  try {
    if (backend === "native") {
      native = await startNativeSession(sessionId, settings);
    } else {
      const catalogue = await loadBundledCatalogue();
      packId = catalogue.packs[0]?.id ?? null;
    }
  } catch (error) {
    sendError(
      port,
      sessionId,
      "backend-start-failed",
      error instanceof Error ? error.message : String(error)
    );
    return;
  }
  await sendOffscreen({
    type: "ma/backend-open",
    sessionId,
    backend,
    packId,
    native
  });
}

export function installSessionRouter(): void {
  if (routerInstalled) return;
  routerInstalled = true;

  onOffscreenMessage((message: OffscreenOutgoing) => {
    const target = sessions.get(message.sessionId);
    if (target) target.postMessage(message);
    if (message.type === "ma/backend-closed") {
      stopNativeSession(message.sessionId);
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith("ma-backend:")) return;
    if (port.sender?.id !== chrome.runtime.id) {
      port.disconnect();
      return;
    }
    const raw = port.name.slice("ma-backend:".length);
    const at = raw.lastIndexOf("@");
    const requestedBackend =
      at >= 0 && (raw.slice(at + 1) === "wasm" || raw.slice(at + 1) === "native")
        ? (raw.slice(at + 1) as "wasm" | "native")
        : null;
    const sessionId = at >= 0 ? raw.slice(0, at) : raw;
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(sessionId) || sessions.has(sessionId)) {
      port.disconnect();
      return;
    }
    sessions.set(sessionId, port);

    port.onMessage.addListener((message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const record = message as Record<string, unknown>;
      if (record.type === "ma/session-send") {
        if (typeof record.message !== "object" || record.message === null) return;
        void sendOffscreen({
          type: "ma/backend-send",
          sessionId,
          message: record.message as object
        });
        return;
      }
      if (record.type === "ma/session-read-file") {
        if (typeof record.id !== "number" || typeof record.uri !== "string") return;
        void sendOffscreen({
          type: "ma/backend-read-file",
          sessionId,
          id: record.id,
          uri: record.uri
        });
      }
    });

    port.onDisconnect.addListener(() => {
      sessions.delete(sessionId);
      stopNativeSession(sessionId);
      void sendOffscreen({ type: "ma/backend-close", sessionId });
    });

    void openSession(port, sessionId, requestedBackend).catch(
      (error: unknown) => {
        sendError(
          port,
          sessionId,
          "backend-start-failed",
          error instanceof Error ? error.message : String(error)
        );
      }
    );
  });
}
