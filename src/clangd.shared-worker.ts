import {
  Message,
  type NotificationMessage,
  type RequestMessage,
  type ResponseMessage,
} from "vscode-jsonrpc/lib/common/messages.js";

const assets = {
  compileConfigUrl: new URL(
    "../assets/clangd-compile-config.json",
    import.meta.url,
  ).href,
  dataUrl: new URL("../assets/headers.data", import.meta.url).href,
  indexUrl: new URL("../assets/system.index", import.meta.url).href,
  runtimeUrl: new URL("../assets/clangd-runtime.mjs", import.meta.url).href,
  wasmUrl: new URL("../assets/clangd.wasm", import.meta.url).href,
};

interface EmscriptenModule {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  HEAPU8: Uint8Array;
  ccall(
    name: string,
    returnType: string | null,
    types: string[],
    values: unknown[],
    options?: { async?: boolean },
  ): unknown;
}

interface ClangdRuntime {
  compilerCommandPrefix: string[];
  send(message: JsonRpcMessage): void;
  stop(): Promise<void>;
}

interface RuntimeCallbacks {
  onError(error: Error): void;
  onMessage(message: JsonRpcMessage): void;
}

interface AttachMessage {
  compilerArguments: string[];
  lock: string;
  type: "algopro/clangd-attach";
  uri: string;
}

interface Session {
  compilerArguments: string[];
  externalUri: string;
  internalPath: string;
  internalUri: string;
  opened: boolean;
  port: MessagePort;
}

interface RequestOwner {
  id: JsonRpcId;
  method: string;
  session: Session;
}

type JsonRpcId = number | string | null;
type JsonRpcMessage =
  | NotificationMessage
  | RequestMessage
  | ResponseMessage;

const BACKEND_INITIALIZE_ID = "algopro/clangd-initialize";
const IDLE_STOP_MS = 60_000;
const FORWARDED_SERVER_CAPABILITIES = [
  "completionProvider",
  "definitionProvider",
  "documentFormattingProvider",
  "hoverProvider",
  "positionEncoding",
  "referencesProvider",
  "renameProvider",
  "semanticTokensProvider",
  "signatureHelpProvider",
  "textDocumentSync",
] as const;

/** One native clangd runtime, multiplexed over all connected MessagePorts. */
class ClangdBroker {
  private backend: Promise<void> | null = null;
  private backendInitializationDone: ((error?: Error) => void) | null = null;
  private backendInitializeResult: {
    capabilities?: Record<string, any>;
  } | null = null;
  private readonly requestOwners = new Map<JsonRpcId, RequestOwner>();
  private generation = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private previousStop: Promise<void> = Promise.resolve();
  private runtime: ClangdRuntime | null = null;
  private readonly sessions = new Set<Session>();
  private nextRequestId = 0;
  private nextSessionId = 0;

  attach(port: MessagePort, message: AttachMessage) {
    const sessionId = ++this.nextSessionId;
    const internalPath = `/sessions/${sessionId}/main.cpp`;
    const session: Session = {
      port,
      compilerArguments: message.compilerArguments,
      externalUri: message.uri,
      internalPath,
      internalUri: `file://${internalPath}`,
      opened: false,
    };
    this.sessions.add(session);
    port.onmessage = (event) => this.handlePortMessage(session, event.data);
    port.start();
    port.postMessage({ type: "algopro/clangd-attached" });
    void navigator.locks.request(message.lock, () => this.detach(session));

    void this.ensureBackend()
      .then(() => {
        if (!this.sessions.has(session)) {
          return;
        }

        port.postMessage({ type: "algopro/clangd-ready" });
      })
      .catch((error) => {
        if (!this.sessions.has(session)) return;
        port.postMessage({
          type: "algopro/clangd-error",
          message:
            error instanceof Error ? error.message : "Failed to start clangd",
        });
        this.detach(session);
      });
  }

  private ensureBackend() {
    clearTimeout(this.idleTimer);
    if (!this.backend) {
      const generation = ++this.generation;
      const backend = this.previousStop.then(() =>
        this.startBackend(generation),
      );
      this.backend = backend;
      void backend.catch(() => {
        if (this.backend === backend) this.resetBackend();
      });
    }

    return this.backend;
  }

  private async startBackend(generation: number) {
    const runtime = await createClangdRuntime({
      onMessage: (message) => {
        if (generation === this.generation) {
          this.handleBackendMessage(message);
        }
      },
      onError: (error) => {
        if (generation === this.generation) this.failBackend(error);
      },
    });
    try {
      if (generation !== this.generation) {
        throw new Error("Local C++ language service was closed while starting");
      }
      this.runtime = runtime;

      await new Promise<void>((resolve, reject) => {
        const done = (error?: Error) => {
          this.backendInitializationDone = null;
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
        this.backendInitializationDone = done;
        runtime.send({
          jsonrpc: "2.0",
          id: BACKEND_INITIALIZE_ID,
          method: "initialize",
          params: {
            processId: null,
            rootUri: null,
            capabilities: {
              general: { positionEncodings: ["utf-16"] },
              textDocument: {
                completion: {
                  completionItem: { snippetSupport: true },
                },
                hover: { contentFormat: ["markdown", "plaintext"] },
                publishDiagnostics: {
                  relatedInformation: true,
                  versionSupport: true,
                },
                semanticTokens: {
                  formats: ["relative"],
                  multilineTokenSupport: false,
                  overlappingTokenSupport: false,
                  requests: { full: { delta: true }, range: true },
                  tokenModifiers: [
                    "declaration",
                    "definition",
                    "readonly",
                    "static",
                    "deprecated",
                    "abstract",
                    "async",
                    "modification",
                    "documentation",
                    "defaultLibrary",
                  ],
                  tokenTypes: [
                    "namespace",
                    "type",
                    "class",
                    "enum",
                    "interface",
                    "struct",
                    "typeParameter",
                    "parameter",
                    "variable",
                    "property",
                    "enumMember",
                    "event",
                    "function",
                    "method",
                    "macro",
                    "keyword",
                    "modifier",
                    "comment",
                    "string",
                    "number",
                    "regexp",
                    "operator",
                    "decorator",
                  ],
                },
                signatureHelp: {
                  contextSupport: true,
                  signatureInformation: {
                    activeParameterSupport: true,
                    documentationFormat: ["markdown", "plaintext"],
                    parameterInformation: { labelOffsetSupport: true },
                  },
                },
              },
            },
          },
        });
      });
      runtime.send({
        jsonrpc: "2.0",
        method: "initialized",
        params: {},
      });
    } catch (error) {
      if (this.runtime === runtime) this.runtime = null;
      try {
        await runtime.stop();
      } catch {
        // The module may already be aborted.
      }
      throw error;
    }
  }

  private handlePortMessage(session: Session, message: unknown) {
    if (!this.sessions.has(session)) return;
    if (!isJsonRpcMessage(message)) {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "algopro/clangd-detach"
      ) {
        this.detach(session);
      }
      return;
    }

    if (!this.runtime) {
      if (Message.isRequest(message)) {
        session.port.postMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32603,
            message: "Local C++ language service is not running",
          },
        });
      }
      return;
    }

    if (Message.isRequest(message) && message.method === "initialize") {
      this.replyVirtualInitialize(session, message);
      return;
    }
    if (
      (Message.isNotification(message) && message.method === "initialized") ||
      (Message.isRequest(message) && message.method === "shutdown")
    ) {
      if (Message.isRequest(message)) {
        session.port.postMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: null,
        });
      }
      return;
    }
    if (Message.isNotification(message) && message.method === "exit") {
      this.detach(session);
      return;
    }

    if (
      Message.isNotification(message) &&
      message.method === "$/cancelRequest"
    ) {
      this.forwardCancellation(session, message);
      return;
    }
    if (
      Message.isNotification(message) &&
      message.method === "textDocument/didOpen"
    ) {
      session.opened = true;
      this.setCompileCommand(session);
    }

    const forwarded = translateUri(
      message,
      session.externalUri,
      session.internalUri,
    );
    if (Message.isRequest(message)) {
      const backendId = `algopro/${++this.nextRequestId}`;
      this.requestOwners.set(backendId, {
        id: message.id,
        method: message.method,
        session,
      });
      forwarded.id = backendId;
    }
    this.runtime.send(forwarded);
  }

  private forwardCancellation(
    session: Session,
    message: NotificationMessage,
  ) {
    const clientID = (message.params as { id?: unknown } | undefined)?.id;
    if (typeof clientID !== "number" && typeof clientID !== "string") return;
    const owner = [...this.requestOwners.entries()].find(
      ([, candidate]) =>
        candidate.session === session && candidate.id === clientID,
    );
    if (!owner) return;
    this.runtime?.send({
      ...message,
      params: { ...message.params, id: owner[0] },
    });
  }

  private replyVirtualInitialize(session: Session, message: RequestMessage) {
    const backendCapabilities =
      this.backendInitializeResult?.capabilities ?? {};
    const capabilities = Object.fromEntries(
      FORWARDED_SERVER_CAPABILITIES.flatMap((name) =>
        name in backendCapabilities ? [[name, backendCapabilities[name]]] : [],
      ),
    );
    session.port.postMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities,
        serverInfo: { name: "clangd-wasm" },
      },
    });
  }

  private setCompileCommand(session: Session) {
    if (!this.runtime) {
      return;
    }
    this.runtime.send({
      jsonrpc: "2.0",
      method: "workspace/didChangeConfiguration",
      params: {
        settings: {
          compilationDatabaseChanges: {
            [session.internalPath]: {
              workingDirectory: "/sessions",
              compilationCommand: [
                ...this.runtime.compilerCommandPrefix,
                "-std=c++20",
                ...session.compilerArguments,
                session.internalPath,
              ],
            },
          },
        },
      },
    });
  }

  private handleBackendMessage(message: JsonRpcMessage) {
    if (Message.isResponse(message) && message.id === BACKEND_INITIALIZE_ID) {
      if ("error" in message) {
        this.backendInitializationDone?.(
          new Error(message.error?.message ?? "clangd initialization failed"),
        );
      } else {
        this.backendInitializeResult =
          typeof message.result === "object" &&
          message.result !== null &&
          !Array.isArray(message.result)
            ? (message.result as { capabilities?: Record<string, any> })
            : null;
        this.backendInitializationDone?.();
      }
      return;
    }

    if (Message.isResponse(message)) {
      const owner = this.requestOwners.get(message.id);
      if (!owner) {
        return;
      }
      this.requestOwners.delete(message.id);
      if ("error" in message) {
        console.error(`[clangd-wasm] ${owner.method} failed`, message.error);
      }
      owner.session.port.postMessage({
        ...translateUri(
          message,
          owner.session.internalUri,
          owner.session.externalUri,
        ),
        id: owner.id,
      });
      return;
    }

    if (!Message.isNotification(message)) return;
    const uri = (message.params as { uri?: unknown } | undefined)?.uri;
    if (typeof uri === "string") {
      for (const session of this.sessions) {
        if (session.internalUri === uri) {
          session.port.postMessage(
            translateUri(message, session.internalUri, session.externalUri),
          );
        }
      }
      return;
    }

    // Server notifications without a document URI are not relevant to a
    // particular editor session and intentionally remain private to the broker.
  }

  private detach(session: Session) {
    if (!this.sessions.delete(session)) {
      return;
    }
    session.port.onmessage = null;
    for (const [id, owner] of this.requestOwners) {
      if (owner.session !== session) continue;
      this.requestOwners.delete(id);
      this.runtime?.send({
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id },
      });
    }
    if (session.opened) {
      this.runtime?.send({
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: { textDocument: { uri: session.internalUri } },
      });
    }
    if (this.sessions.size === 0) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (this.sessions.size === 0) this.resetBackend();
      }, IDLE_STOP_MS);
    }
  }

  private resetBackend() {
    clearTimeout(this.idleTimer);
    this.generation++;
    this.backendInitializationDone?.(
      new Error("Local C++ language service was closed while starting"),
    );
    const { backend, runtime } = this;
    this.backend = null;
    this.runtime = null;
    this.backendInitializeResult = null;
    this.requestOwners.clear();
    // A new runtime must not start before the old one has fully stopped: they
    // share the global message hooks.
    this.previousStop = this.previousStop
      .then(() => backend?.catch(() => undefined))
      .then(() => runtime?.stop())
      .catch(() => undefined);
  }

  private failBackend(error: Error) {
    console.error("[clangd-wasm] runtime failed", error);
    this.backendInitializationDone?.(error);
    for (const owner of this.requestOwners.values()) {
      owner.session.port.postMessage({
        jsonrpc: "2.0",
        id: owner.id,
        error: { code: -32603, message: error.message },
      });
    }
    this.requestOwners.clear();
    for (const session of this.sessions) {
      session.port.postMessage({
        type: "algopro/clangd-closed",
        message: error.message,
      });
      session.port.onmessage = null;
    }
    this.sessions.clear();
    this.resetBackend();
  }
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (typeof value !== "object" || value === null) return false;
  return (
    Message.isRequest(value as JsonRpcMessage) ||
    Message.isNotification(value as JsonRpcMessage) ||
    Message.isResponse(value as JsonRpcMessage)
  );
}

function translateUri(value: unknown, from: string, to: string): any {
  if (Array.isArray(value))
    return value.map((item) => translateUri(item, from, to));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key === from ? to : key,
      typeof item === "string" &&
      (key === "uri" || key.endsWith("Uri")) &&
      item === from
        ? to
        : translateUri(item, from, to),
    ]),
  );
}

function isAttachMessage(value: unknown): value is AttachMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "algopro/clangd-attach" &&
    "uri" in value &&
    typeof value.uri === "string" &&
    "lock" in value &&
    typeof value.lock === "string" &&
    "compilerArguments" in value &&
    Array.isArray(value.compilerArguments) &&
    value.compilerArguments.every((argument) => typeof argument === "string")
  );
}

async function createClangdRuntime(
  options: RuntimeCallbacks,
): Promise<ClangdRuntime> {
  const pending: string[] = [];
  let wake: (() => void) | null = null;
  let stopping: Promise<void> | null = null;
  const wakeLoop = () => {
    wake?.();
    wake = null;
  };

  Object.assign(globalThis, {
    __algoproClangdPostMessage(message: string) {
      options.onMessage(JSON.parse(message) as JsonRpcMessage);
    },
    __algoproClangdReceiveMessage() {
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise<string | null>((resolve) => {
        wake = () => resolve(pending.shift() ?? null);
      });
    },
    __algoproClangdWakeMessageLoop: wakeLoop,
  });

  const generated = (await import(
    /* webpackIgnore: true */ assets.runtimeUrl
  )) as {
    default(options: {
      locateFile(file: string): string;
    }): Promise<EmscriptenModule>;
  };
  const module = await generated.default({
    locateFile(file) {
      if (file.endsWith(".wasm")) return assets.wasmUrl;
      if (file.endsWith(".data")) return assets.dataUrl;
      return new URL(file, assets.runtimeUrl).href;
    },
  });
  let heapBytes = module.HEAPU8.byteLength;
  const reportHeapGrowth = () => {
    const currentHeapBytes = module.HEAPU8.byteLength;
    if (currentHeapBytes <= heapBytes) return;
    console.info(
      `[clangd-wasm] WebAssembly heap grew from ${formatMiB(heapBytes)} to ${formatMiB(currentHeapBytes)}`,
    );
    heapBytes = currentHeapBytes;
  };
  const [indexResponse, compileConfigResponse] = await Promise.all([
    fetch(assets.indexUrl),
    fetch(assets.compileConfigUrl),
  ]);
  if (!indexResponse.ok) {
    throw new Error(
      `Could not load system index: HTTP ${indexResponse.status}`,
    );
  }
  if (!compileConfigResponse.ok) {
    throw new Error(
      `Could not load compiler configuration: HTTP ${compileConfigResponse.status}`,
    );
  }
  const compileConfig = parseCompileConfiguration(
    await compileConfigResponse.json(),
  );
  module.FS.mkdirTree("/assets");
  module.FS.mkdirTree("/sessions");
  module.FS.writeFile(
    "/assets/system.index",
    new Uint8Array(await indexResponse.arrayBuffer()),
  );

  const run = Promise.resolve(
    module.ccall("clangd_wasm_run", "number", [], [], { async: true }),
  );
  void run.then(
    (exitCode) => {
      if (!stopping) {
        options.onError(
          new Error(
            `clangd terminated unexpectedly with exit code ${String(exitCode)}`,
          ),
        );
      }
    },
    (error) => {
      if (!stopping) {
        options.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
  );
  return {
    compilerCommandPrefix: [
      "clang++",
      `--target=${compileConfig.targetTriple}`,
      "--sysroot=/sysroot",
      "-nostdinc++",
      ...compileConfig.includeDirectories.flatMap((directory) => [
        "-isystem",
        directory,
      ]),
    ],
    send(message) {
      pending.push(JSON.stringify(message));
      wakeLoop();
      setTimeout(reportHeapGrowth, 0);
    },
    stop() {
      if (!stopping) {
        stopping = run.then(
          () => undefined,
          () => undefined,
        );
        module.ccall("clangd_wasm_stop", null, [], []);
        wakeLoop();
      }
      return stopping;
    },
  };
}

function formatMiB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function parseCompileConfiguration(value: unknown): {
  includeDirectories: string[];
  targetTriple: string;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Compiler configuration has an invalid shape");
  }
  const config = value as {
    includeDirectories?: unknown;
    targetTriple?: unknown;
  };
  if (
    typeof config.targetTriple !== "string" ||
    !Array.isArray(config.includeDirectories) ||
    !config.includeDirectories.every(
      (directory) =>
        typeof directory === "string" && directory.startsWith("/sysroot/usr/"),
    )
  ) {
    throw new Error("Compiler configuration has an invalid shape");
  }
  return {
    targetTriple: config.targetTriple,
    includeDirectories: config.includeDirectories,
  };
}

const broker = new ClangdBroker();
interface SharedWorkerScopeLike {
  onconnect: ((event: MessageEvent) => void) | null;
}

const workerScope = self as unknown as SharedWorkerScopeLike;
workerScope.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  const onFirstMessage = (messageEvent: MessageEvent<unknown>) => {
    if (!isAttachMessage(messageEvent.data)) {
      port.postMessage({
        type: "algopro/clangd-error",
        message: "Expected clangd attach message",
      });
      return;
    }
    broker.attach(port, messageEvent.data);
  };
  port.addEventListener("message", onFirstMessage, { once: true });
  port.start();
};
