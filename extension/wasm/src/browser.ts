import { normalizeCompilerArguments } from "./compiler-arguments.js";
import { isClangdWasmSupported } from "./support.js";

export interface OpenClangdSessionOptions {
  compilerArguments?: string | readonly string[];
  signal?: AbortSignal;
  uri: string;
}

export interface ClangdSession {
  /** Settles if the shared native clangd runtime terminates unexpectedly. */
  closed: Promise<Error>;
  dispose(): void;
  port: MessagePort;
}

const ATTACH_TIMEOUT_MS = 10_000;

/** Opens one document session on the package's singleton clangd SharedWorker. */
export async function openClangdSession(
  options: OpenClangdSessionOptions,
): Promise<ClangdSession> {
  const { signal } = options;
  if (!isClangdWasmSupported()) {
    throw new Error("Local C++ language services are not supported here");
  }
  signal?.throwIfAborted();
  const compilerArguments = normalizeCompilerArguments(
    options.compilerArguments,
  );

  // The URL must stay inline for bundlers to detect and bundle the worker.
  const worker = new SharedWorker(
    new URL("./clangd.shared-worker.js", import.meta.url),
    { name: "algopro-clangd", type: "module" },
  );
  const port = worker.port;
  const life = new AbortController();
  const opened = deferred<void>();
  const closed = deferred<Error>();
  const lockAcquired = deferred<void>();
  const lockReleased = deferred<void>();
  let attachTimer: ReturnType<typeof setTimeout> | undefined;

  const dispose = () => {
    if (life.signal.aborted) return;
    life.abort();
    clearTimeout(attachTimer);
    port.postMessage({ type: "algopro/clangd-detach" });
    port.close();
    lockReleased.resolve();
  };
  const fail = (error: Error) => {
    closed.resolve(error);
    opened.reject(error);
    dispose();
  };

  // The worker detaches this session when the lock is released, which also
  // happens when the page closes or reloads without calling dispose().
  const lock = `algopro-clangd-session-${crypto.randomUUID()}`;
  navigator.locks
    .request(lock, () => {
      lockAcquired.resolve();
      return lockReleased.promise;
    })
    .catch(lockAcquired.reject);

  try {
    await lockAcquired.promise;
    signal?.throwIfAborted();
    signal?.addEventListener("abort", () => opened.reject(signal.reason), {
      once: true,
      signal: life.signal,
    });
    worker.addEventListener(
      "error",
      (event) => fail(new Error(event.message || "clangd worker failed")),
      { signal: life.signal },
    );
    port.addEventListener(
      "messageerror",
      () => fail(new Error("Could not read a clangd worker message")),
      { signal: life.signal },
    );
    port.addEventListener(
      "message",
      (event: MessageEvent) => {
        const data = event.data;
        switch (data?.type) {
          case "algopro/clangd-attached":
            clearTimeout(attachTimer);
            break;
          case "algopro/clangd-ready":
            opened.resolve();
            break;
          case "algopro/clangd-error":
            opened.reject(new Error(data.message));
            break;
          case "algopro/clangd-closed":
            // Consumers' readers are attached after this listener and must not
            // see the control message.
            event.stopImmediatePropagation();
            fail(new Error(data.message));
            break;
        }
      },
      { signal: life.signal },
    );
    port.start();
    attachTimer = setTimeout(
      () =>
        opened.reject(new Error("Local C++ language service did not respond")),
      ATTACH_TIMEOUT_MS,
    );
    port.postMessage({
      type: "algopro/clangd-attach",
      lock,
      compilerArguments,
      uri: options.uri,
    });
    await opened.promise;
    signal?.throwIfAborted();
  } catch (error) {
    dispose();
    throw error;
  }
  return { closed: closed.promise, port, dispose };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}
