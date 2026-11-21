import type { Settings } from "./state.js";

export const NATIVE_HOST_NAME = "com.monacoanywhere.host";
const START_TIMEOUT_MS = 10_000;

export interface NativeCredentials {
  port: number;
  token: string;
}

export interface NativeSession {
  credentials: NativeCredentials;
  close(): void;
}

const sessions = new Map<string, chrome.runtime.Port>();

function disconnectMessage(): string {
  const error = chrome.runtime.lastError;
  return error?.message ?? "native host disconnected";
}

function translateError(message: string): string {
  if (message.includes("Specified native messaging host not found")) {
    return "native-host-missing";
  }
  if (message.includes("Access to the specified native messaging host is forbidden")) {
    return "native-host-forbidden";
  }
  return message;
}

export async function startNativeSession(
  sessionId: string,
  settings: Settings
): Promise<NativeCredentials> {
  if (sessions.has(sessionId)) {
    throw new Error("native session already exists");
  }
  const host = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  sessions.set(sessionId, host);
  let settled = false;
  const ready = Promise.withResolvers<NativeCredentials>();

  const timer = setTimeout(() => {
    ready.reject(new Error("native-host-timeout"));
    close();
  }, START_TIMEOUT_MS);

  const close = (): void => {
    clearTimeout(timer);
    const active = sessions.get(sessionId);
    if (active === host) sessions.delete(sessionId);
    try {
      host.disconnect();
    } catch {
      // Already disconnected.
    }
  };

  host.onMessage.addListener((message: unknown) => {
    if (settled || typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    if (record.type === "ma/ready") {
      const port = record.port;
      const token = record.token;
      if (
        !Number.isInteger(port) ||
        typeof token !== "string" ||
        (port as number) <= 0 ||
        (port as number) > 65535
      ) {
        settled = true;
        ready.reject(new Error("native-host-invalid-ready"));
        close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      ready.resolve({ port: port as number, token });
      return;
    }
    if (record.type === "ma/error") {
      settled = true;
      ready.reject(new Error(String(record.code ?? "native-host-error")));
      close();
    }
  });
  host.onDisconnect.addListener(() => {
    const message = translateError(disconnectMessage());
    if (!settled) {
      settled = true;
      ready.reject(new Error(message));
    }
    if (sessions.get(sessionId) === host) sessions.delete(sessionId);
  });

  try {
    host.postMessage({
      type: "ma/start",
      clangdPath: settings.clangdPath ?? "",
      queryDriverGlobs: settings.queryDriverAllowlist,
      extraIncludeDirs: settings.extraIncludeDirs
    });
    return await ready.promise;
  } catch (error) {
    close();
    throw error;
  }
}

export function stopNativeSession(sessionId: string): void {
  const host = sessions.get(sessionId);
  if (!host) return;
  sessions.delete(sessionId);
  try {
    host.postMessage({ type: "ma/stop" });
  } catch {
    // Port already gone.
  }
  try {
    host.disconnect();
  } catch {
    // Already disconnected.
  }
}
