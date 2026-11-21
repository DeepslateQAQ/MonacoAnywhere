import { isClangdWasmSupported } from "./support.js";

export interface MountFile {
  /** Absolute path inside the Emscripten filesystem. */
  path: string;
  bytes: ArrayBuffer;
}

export interface OpenSessionOptions {
  /** Extension-origin URLs for the packaged runtime. */
  workerUrl: string;
  runtimeUrl: string;
  wasmUrl: string;
  dataUrl: string;
  /** Static index content, or null for dynamic indexing only. */
  index?: { path: string; bytes: ArrayBuffer } | null;
  files: MountFile[];
  signal?: AbortSignal;
}

export interface ClangdWasmSession {
  send(message: object): void;
  onMessage(callback: (message: unknown) => void): () => void;
  onClose(callback: (reason: string) => void): () => void;
  readFile(path: string): Promise<Uint8Array | null>;
  dispose(): Promise<void>;
}

const OPEN_TIMEOUT_MS = 120_000;
const DISPOSE_TIMEOUT_MS = 2_000;

/** Opens one dedicated Worker with its own clangd instance. */
export async function openSession(
  options: OpenSessionOptions,
): Promise<ClangdWasmSession> {
  if (!isClangdWasmSupported()) {
    throw new Error("This browser does not support the WASM clangd engine");
  }
  options.signal?.throwIfAborted();

  const worker = new Worker(options.workerUrl, { type: "module" });
  const channel = new MessageChannel();
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<(reason: string) => void>();
  const pendingReads = new Map<
    number,
    { resolve: (bytes: Uint8Array | null) => void; reject: (error: Error) => void }
  >();
  let nextReadId = 1;
  let closed = false;
  const ready = Promise.withResolvers<void>();
  const terminated = Promise.withResolvers<void>();
  const openTimer = setTimeout(() => {
    ready.reject(new Error("clangd engine did not start in time"));
  }, OPEN_TIMEOUT_MS);

  const settleClose = (reason: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(openTimer);
    ready.reject(new Error(reason));
    terminated.resolve();
    for (const entry of pendingReads.values()) entry.resolve(null);
    pendingReads.clear();
    for (const listener of closeListeners) listener(reason);
    worker.terminate();
    channel.port1.close();
    channel.port2.close();
  };

  worker.addEventListener("error", (event) => {
    settleClose(event.message || "clangd worker crashed");
  });
  worker.addEventListener("messageerror", () => {
    settleClose("unreadable clangd worker message");
  });

  channel.port1.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as
      | { type: "ready" }
      | { type: "message"; json: string }
      | { type: "error"; message: string }
      | { type: "exit"; code: number }
      | { type: "readFileResult"; id: number; bytes?: Uint8Array; error?: string };
    switch (data.type) {
      case "ready":
        clearTimeout(openTimer);
        ready.resolve();
        break;
      case "message":
        try {
          const parsed: unknown = JSON.parse(data.json);
          for (const listener of messageListeners) listener(parsed);
        } catch {
          settleClose("clangd worker sent invalid JSON");
        }
        break;
      case "error":
        settleClose(data.message);
        break;
      case "exit":
        settleClose(`clangd stopped (exit code ${data.code})`);
        break;
      case "readFileResult": {
        const entry = pendingReads.get(data.id);
        if (!entry) break;
        pendingReads.delete(data.id);
        if (data.error || !data.bytes) {
          entry.resolve(null);
        } else {
          entry.resolve(data.bytes);
        }
        break;
      }
    }
  });
  channel.port1.start();

  const dispose = async (): Promise<void> => {
    if (closed) return;
    worker.postMessage({ type: "stop" } satisfies { type: "stop" });
    const timeout = Promise.withResolvers<void>();
    const timer = setTimeout(timeout.resolve, DISPOSE_TIMEOUT_MS);
    await Promise.race([terminated.promise, timeout.promise]);
    clearTimeout(timer);
    settleClose("session disposed");
  };

  try {
    worker.postMessage(
      {
        type: "init",
        runtimeUrl: options.runtimeUrl,
        wasmUrl: options.wasmUrl,
        dataUrl: options.dataUrl,
        indexPath: options.index?.path ?? null,
        indexBytes: options.index?.bytes ?? null,
        files: options.files,
      },
      [channel.port2, ...options.files.map((file) => file.bytes)],
    );
    await ready.promise;
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    send(message: object) {
      if (closed) return;
      worker.postMessage({ type: "send", json: JSON.stringify(message) });
    },
    onMessage(callback) {
      messageListeners.add(callback);
      return () => messageListeners.delete(callback);
    },
    onClose(callback) {
      closeListeners.add(callback);
      return () => closeListeners.delete(callback);
    },
    readFile(path: string) {
      if (closed) return Promise.resolve(null);
      const id = nextReadId++;
      const result = Promise.withResolvers<Uint8Array | null>();
      pendingReads.set(id, result);
      worker.postMessage({ type: "readFile", id, path });
      return result.promise;
    },
    dispose,
  };
}
