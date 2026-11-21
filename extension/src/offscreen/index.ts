/*
 * Offscreen document: owns every long-lived language-service transport.
 *
 * The service worker opens this document and connects a port named
 * `ma-offscreen`. Sessions are opened here, never in the page or the iframe.
 */
import {
  createNativeBackend,
  createWasmBackend,
  type ActiveBackend
} from "./backends.js";
import type {
  OffscreenIncoming,
  OffscreenOutgoing
} from "./protocol.js";

interface Session {
  backend: ActiveBackend;
  subscriptions: Array<() => void>;
}

const sessions = new Map<string, Session>();
let offscreenPort: chrome.runtime.Port | null = null;

function post(message: OffscreenOutgoing): void {
  offscreenPort?.postMessage(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }
  return "backend-error";
}

async function closeSession(sessionId: string, reason: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  for (const unsubscribe of session.subscriptions) unsubscribe();
  await session.backend.dispose();
  post({ type: "ma/backend-closed", sessionId, reason });
}

async function openSession(message: OffscreenIncoming): Promise<void> {
  if (message.type !== "ma/backend-open") return;
  if (sessions.has(message.sessionId)) {
    post({
      type: "ma/backend-error",
      sessionId: message.sessionId,
      code: "already-open",
      message: "session already exists"
    });
    return;
  }
  try {
    const backend =
      message.backend === "wasm"
        ? await createWasmBackend(requirePackId(message.packId))
        : await createNativeBackend(requireNative(message.native));
    const subscriptions = [
      backend.onMessage((payload) =>
        post({
          type: "ma/backend-message",
          sessionId: message.sessionId,
          message: payload
        })
      ),
      backend.onClose((reason) => {
        void closeSession(message.sessionId, reason);
      })
    ];
    sessions.set(message.sessionId, { backend, subscriptions });
    post({ type: "ma/backend-ready", sessionId: message.sessionId });
  } catch (error) {
    post({
      type: "ma/backend-error",
      sessionId: message.sessionId,
      code: errorCode(error),
      message: errorMessage(error)
    });
  }
}

function requirePackId(packId: string | null): string {
  if (!packId) throw new Error("no toolchain pack was selected");
  return packId;
}

function requireNative(
  credentials: { port: number; token: string } | null
): { port: number; token: string } {
  if (!credentials) throw new Error("native credentials are missing");
  return credentials;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ma-offscreen") return;
  if (offscreenPort) {
    port.disconnect();
    return;
  }
  offscreenPort = port;
  port.onDisconnect.addListener(() => {
    if (offscreenPort === port) offscreenPort = null;
    for (const sessionId of [...sessions.keys()]) {
      void closeSession(sessionId, "offscreen port closed");
    }
  });
  port.onMessage.addListener((message: OffscreenIncoming) => {
    if (typeof message !== "object" || message === null) return;
    switch (message.type) {
      case "ma/backend-open":
        void openSession(message);
        break;
      case "ma/backend-send": {
        const session = sessions.get(message.sessionId);
        if (session && typeof message.message === "object") {
          session.backend.send(message.message);
        }
        break;
      }
      case "ma/backend-read-file": {
        const session = sessions.get(message.sessionId);
        if (!session) {
          post({
            type: "ma/backend-file",
            sessionId: message.sessionId,
            id: message.id,
            text: null
          });
          break;
        }
        void session.backend
          .readFile(message.uri)
          .then((text) =>
            post({
              type: "ma/backend-file",
              sessionId: message.sessionId,
              id: message.id,
              text
            })
          )
          .catch(() =>
            post({
              type: "ma/backend-file",
              sessionId: message.sessionId,
              id: message.id,
              text: null
            })
          );
        break;
      }
      case "ma/backend-close":
        void closeSession(message.sessionId, "requested");
        break;
    }
  });
});
