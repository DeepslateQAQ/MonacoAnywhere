import {
  downloadAndInstallPack,
  loadPack,
  type LoadedPack
} from "../data/pack.js";
import { loadBundledCatalogue } from "../data/catalogue.js";
import { openSession } from "../../wasm/src/browser.js";
import type { NativeCredentials } from "./protocol.js";

export interface ActiveBackend {
  send(message: object): void;
  onMessage(callback: (message: object) => void): () => void;
  onClose(callback: (reason: string) => void): () => void;
  readFile(uri: string): Promise<string | null>;
  dispose(): Promise<void>;
}

const ENGINE_WORKER = "wasm/clangd.worker.js";
const ENGINE_RUNTIME = "wasm/clangd-runtime.mjs";
const ENGINE_WASM = "wasm/clangd.wasm";
const ENGINE_DATA = "wasm/clangd-runtime.data";
const READ_CHUNK = 512 * 1024;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pathFromUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return null;
    return decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
}

async function ensurePack(packId: string): Promise<LoadedPack> {
  try {
    return await loadPack(packId);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code !== "pack-not-installed") {
      throw error;
    }
  }
  const catalogue = await loadBundledCatalogue();
  const pack = catalogue.packs.find((entry) => entry.id === packId);
  if (!pack) throw new Error(`Toolchain pack ${packId} is not in the catalogue`);
  await downloadAndInstallPack(pack, { catalogue });
  return loadPack(packId);
}

export async function createWasmBackend(packId: string): Promise<ActiveBackend> {
  const pack = await ensurePack(packId);
  const files = [...pack.sysrootFiles.entries()].map(([path, bytes]) => ({
    path,
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  }));
  const index = pack.index
    ? { path: "/assets/system.index", bytes: pack.index.buffer.slice(0) as ArrayBuffer }
    : null;
  const session = await openSession({
    workerUrl: chrome.runtime.getURL(ENGINE_WORKER),
    runtimeUrl: chrome.runtime.getURL(ENGINE_RUNTIME),
    wasmUrl: chrome.runtime.getURL(ENGINE_WASM),
    dataUrl: chrome.runtime.getURL(ENGINE_DATA),
    index,
    files
  });
  return {
    send: (message) => session.send(message),
    onMessage: (callback) => session.onMessage((message) => {
      if (typeof message === "object" && message !== null) {
        callback(message as object);
      }
    }),
    onClose: (callback) => session.onClose(callback),
    async readFile(uri) {
      const path = pathFromUri(uri);
      if (!path) return null;
      const bytes = await session.readFile(path);
      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    dispose: () => session.dispose()
  };
}

export async function createNativeBackend(
  credentials: NativeCredentials
): Promise<ActiveBackend> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${credentials.port}/lsp`,
    ["monacoanywhere.lsp", `ma-token.${credentials.token}`]
  );
  const listeners = new Set<(message: object) => void>();
  const closeListeners = new Set<(reason: string) => void>();
  let closed = false;
  const opened = Promise.withResolvers<void>();

  const timer = setTimeout(
    () => opened.reject(new Error("native LSP connection timed out")),
    15_000
  );
  socket.onopen = () => {
    clearTimeout(timer);
    opened.resolve();
  };
  socket.onerror = () => {
    clearTimeout(timer);
    opened.reject(new Error("native LSP connection failed"));
  };
  socket.onmessage = (event) => {
    try {
      const message: unknown = JSON.parse(String(event.data));
      if (typeof message === "object" && message !== null) {
        for (const listener of listeners) listener(message as object);
      }
    } catch {
      // Ignore malformed frames from the local host.
    }
  };
  socket.onclose = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    opened.reject(new Error("native LSP connection closed"));
    for (const listener of closeListeners) listener("native connection closed");
  };

  try {
    await opened.promise;
  } catch (error) {
    socket.close();
    throw error;
  }

  const base = `http://127.0.0.1:${credentials.port}`;
  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    onMessage(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    onClose(callback) {
      closeListeners.add(callback);
      return () => closeListeners.delete(callback);
    },
    async readFile(uri) {
      let offset = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const response = await fetch(`${base}/ma/readFile`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${credentials.token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ path: uri, offset, length: READ_CHUNK })
        });
        if (!response.ok) return null;
        const body = (await response.json()) as {
          bytes?: string;
          nextOffset?: number;
          eof?: boolean;
        };
        if (typeof body.bytes !== "string") return null;
        chunks.push(decodeBase64(body.bytes));
        if (body.eof || typeof body.nextOffset !== "number") break;
        offset = body.nextOffset;
      }
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const all = new Uint8Array(total);
      let cursor = 0;
      for (const chunk of chunks) {
        all.set(chunk, cursor);
        cursor += chunk.byteLength;
      }
      return new TextDecoder().decode(all);
    },
    async dispose() {
      closed = true;
      socket.close();
      clearTimeout(timer);
    }
  };
}
