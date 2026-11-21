/*
 * MonacoAnywhere: one dedicated Worker per clangd session.
 *
 * The worker owns the Emscripten module and forwards JSON-RPC messages exactly
 * as sent by the real client; it never virtualizes initialize, rewrites IDs, or
 * filters server notifications. Server-initiated requests therefore reach the
 * client.
 */

interface InitMessage {
  type: "init";
  runtimeUrl: string;
  wasmUrl: string;
  dataUrl: string;
  indexPath: string | null;
  indexBytes: ArrayBuffer | null;
  files: Array<{ path: string; bytes: ArrayBuffer }>;
}

interface SendMessage {
  type: "send";
  json: string;
}

interface StopMessage {
  type: "stop";
}

interface ReadFileMessage {
  type: "readFile";
  id: number;
  path: string;
}

type Incoming = InitMessage | SendMessage | StopMessage | ReadFileMessage;

interface EmscriptenModule {
  HEAPU8: Uint8Array;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string, options: { encoding: "binary" }): Uint8Array;
  };
  ccall(
    name: string,
    returnType: string | null,
    argumentTypes: string[],
    args: unknown[],
    options?: { async?: boolean },
  ): unknown;
}

const pending: string[] = [];
let wake: (() => void) | null = null;
let engine: EmscriptenModule | null = null;
let stopping = false;
let channel: MessagePort | null = null;

function wakeLoop(): void {
  const current = wake;
  wake = null;
  current?.();
}

function post(message: unknown): void {
  channel?.postMessage(message);
}

Object.assign(globalThis, {
  __algoproClangdPostMessage(json: string) {
    post({ type: "message", json });
  },
  __algoproClangdReceiveMessage(): Promise<string | null> {
    if (pending.length) return Promise.resolve(pending.shift() ?? null);
    const resolvers = Promise.withResolvers<string | null>();
    wake = () => resolvers.resolve(pending.shift() ?? null);
    return resolvers.promise;
  },
  __algoproClangdWakeMessageLoop: wakeLoop,
});

async function initialise(message: InitMessage): Promise<void> {
  // The runtime URL comes from the extension package at runtime.
  const generated = (await import(/* @vite-ignore */ message.runtimeUrl)) as {
    default(options: {
      locateFile(file: string): string;
    }): Promise<EmscriptenModule>;
  };
  engine = await generated.default({
    locateFile(file) {
      if (file.endsWith(".wasm")) return message.wasmUrl;
      if (file.endsWith(".data")) return message.dataUrl;
      return new URL(file, message.runtimeUrl).href;
    }
  });

  for (const file of message.files) {
    if (!file.path.startsWith("/") || file.path.includes("..")) {
      throw new Error(`Refusing to mount invalid path: ${file.path}`);
    }
    const directory = file.path.slice(0, file.path.lastIndexOf("/")) || "/";
    engine.FS.mkdirTree(directory);
    engine.FS.writeFile(file.path, new Uint8Array(file.bytes));
  }

  if (message.indexPath !== null && message.indexBytes !== null) {
    const directory = message.indexPath.slice(0, message.indexPath.lastIndexOf("/")) || "/";
    engine.FS.mkdirTree(directory);
    engine.FS.writeFile(message.indexPath, new Uint8Array(message.indexBytes));
  }

  const indexPath = message.indexPath !== null && message.indexBytes !== null
    ? message.indexPath
    : "";
  const run = Promise.resolve(
    engine.ccall("clangd_wasm_run", "number", ["string"], [indexPath], {
      async: true
    })
  );
  post({ type: "ready" });
  void run.then(
    (code) => {
      if (!stopping) post({ type: "exit", code });
    },
    (error: unknown) => {
      if (!stopping) {
        post({
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  );
}

self.addEventListener("message", (event: MessageEvent<Incoming>) => {
  const data = event.data;
  if (data.type === "init") {
    channel = event.ports[0] ?? null;
    channel?.start();
    initialise(data).catch((error: unknown) => {
      post({
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    });
    return;
  }
  if (data.type === "send") {
    pending.push(data.json);
    wakeLoop();
    return;
  }
  if (data.type === "readFile") {
    if (!engine) {
      post({ type: "readFileResult", id: data.id, error: "engine-not-ready" });
      return;
    }
    const allowed = ["/sysroot/", "/lib/clang/", "/workspace/"];
    if (!allowed.some((prefix) => data.path.startsWith(prefix))) {
      post({ type: "readFileResult", id: data.id, error: "forbidden-path" });
      return;
    }
    try {
      const bytes = engine.FS.readFile(data.path, { encoding: "binary" });
      post({ type: "readFileResult", id: data.id, bytes });
    } catch (error: unknown) {
      post({
        type: "readFileResult",
        id: data.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }
  if (data.type === "stop") {
    stopping = true;
    engine?.ccall("clangd_wasm_stop", null, [], []);
    wakeLoop();
  }
});
