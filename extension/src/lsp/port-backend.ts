import type { Backend } from "./backend.js";

interface BackendReady {
  type: "ma/backend-ready";
}

interface BackendError {
  type: "ma/backend-error";
  code: string;
  message: string;
}

interface BackendMessage {
  type: "ma/backend-message";
  message: unknown;
}

interface BackendClosed {
  type: "ma/backend-closed";
  reason: string;
}

interface BackendFile {
  type: "ma/backend-file";
  id: number;
  text: string | null;
}

type BackendReply =
  | BackendReady
  | BackendError
  | BackendMessage
  | BackendClosed
  | BackendFile;

/** Opens one backend session through the service worker and offscreen host. */
export async function openPortBackend(
  sessionId: string,
  backend?: "wasm" | "native"
): Promise<Backend> {
  const suffix = backend ? `@${backend}` : "";
  const port = chrome.runtime.connect({
    name: `ma-backend:${sessionId}${suffix}`
  });
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<(reason: string) => void>();
  const pendingFiles = new Map<
    number,
    (text: string | null) => void
  >();
  let nextFileId = 1;
  let disposed = false;
  let readySettled = false;

  const ready = Promise.withResolvers<void>();
  const settleReady = (error: Error | null): void => {
    if (readySettled) return;
    readySettled = true;
    if (error) ready.reject(error);
    else ready.resolve();
  };

  const finish = (reason: string): void => {
    if (disposed) return;
    disposed = true;
    settleReady(new Error(reason));
    for (const resolve of pendingFiles.values()) resolve(null);
    pendingFiles.clear();
    for (const listener of closeListeners) listener(reason);
    try {
      port.disconnect();
    } catch {
      // Already disconnected.
    }
  };

  port.onMessage.addListener((reply: BackendReply) => {
    if (typeof reply !== "object" || reply === null) return;
    switch (reply.type) {
      case "ma/backend-ready":
        settleReady(null);
        break;
      case "ma/backend-error":
        settleReady(new Error(`${reply.code}: ${reply.message}`));
        finish(`${reply.code}: ${reply.message}`);
        break;
      case "ma/backend-message":
        for (const listener of messageListeners) listener(reply.message);
        break;
      case "ma/backend-file": {
        const resolve = pendingFiles.get(reply.id);
        if (resolve) {
          pendingFiles.delete(reply.id);
          resolve(reply.text);
        }
        break;
      }
      case "ma/backend-closed":
        finish(reply.reason);
        break;
    }
  });
  port.onDisconnect.addListener(() => {
    finish(chrome.runtime.lastError?.message ?? "backend disconnected");
  });

  try {
    await ready.promise;
  } catch (error) {
    await Promise.resolve();
    throw error;
  }

  return {
    send(message) {
      if (disposed) return;
      port.postMessage({ type: "ma/session-send", message });
    },
    onMessage(callback) {
      messageListeners.add(callback);
      return () => messageListeners.delete(callback);
    },
    onClose(callback) {
      closeListeners.add(callback);
      return () => closeListeners.delete(callback);
    },
    readFile(uri) {
      if (disposed) return Promise.resolve(null);
      const id = nextFileId++;
      const result = Promise.withResolvers<string | null>();
      pendingFiles.set(id, result.resolve);
      port.postMessage({ type: "ma/session-read-file", id, uri });
      return result.promise;
    },
    async dispose() {
      if (disposed) return;
      port.postMessage({ type: "ma/session-close" });
      finish("session disposed");
    }
  };
}
