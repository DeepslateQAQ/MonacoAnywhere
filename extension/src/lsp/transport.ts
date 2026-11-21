import {
  AbstractMessageReader,
  AbstractMessageWriter
} from "vscode-jsonrpc/browser";
import type {
  DataCallback,
  Disposable,
  Message
} from "vscode-jsonrpc/browser";

import type { Backend } from "./backend.js";

/**
 * Adapts a Backend's object stream to vscode-jsonrpc.
 *
 * Messages that arrive before the connection calls listen() are queued. The
 * backend never owns the port's onmessage handler, unlike BrowserMessageReader.
 */
export class BackendMessageReader extends AbstractMessageReader {
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeClose: () => void;
  private callback: DataCallback | null = null;
  private listening = false;
  private disposed = false;
  private readonly queue: Message[] = [];

  constructor(backend: Backend) {
    super();
    this.unsubscribeMessage = backend.onMessage((message) => {
      this.receive(message);
    });
    this.unsubscribeClose = backend.onClose(() => {
      if (!this.disposed) this.fireClose();
    });
  }

  override listen(callback: DataCallback): Disposable {
    if (this.listening) {
      throw new Error("BackendMessageReader.listen() may only be called once");
    }
    this.listening = true;
    this.callback = callback;
    const pending = this.queue.splice(0);
    for (const message of pending) callback(message);
    return {
      dispose: () => {
        this.listening = false;
        this.callback = null;
      }
    };
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeMessage();
    this.unsubscribeClose();
    this.queue.length = 0;
    this.callback = null;
    this.listening = false;
    super.dispose();
  }

  private receive(value: unknown): void {
    if (this.disposed) return;
    const message = parseJsonRpcMessage(value);
    if (!message) {
      this.fireError(new Error("Backend delivered a malformed JSON-RPC message"));
      return;
    }
    if (this.listening && this.callback) {
      this.callback(message);
    } else {
      this.queue.push(message);
    }
  }
}

/**
 * Writes objects directly to the backend. Content-Length framing belongs to
 * the native stdio bridge and the WASM engine glue, not this layer.
 */
export class BackendMessageWriter extends AbstractMessageWriter {
  private readonly unsubscribeClose: () => void;
  private disposed = false;

  constructor(private readonly backend: Backend) {
    super();
    this.unsubscribeClose = backend.onClose(() => {
      if (!this.disposed) this.fireClose();
    });
  }

  write(message: Message): Promise<void> {
    if (this.disposed) {
      const error = new Error("Cannot write to a disposed LSP backend");
      this.fireError(error, message, 1);
      return Promise.reject(error);
    }
    try {
      this.backend.send(message);
      return Promise.resolve();
    } catch (cause) {
      const error =
        cause instanceof Error ? cause : new Error(String(cause));
      this.fireError(error, message, 1);
      return Promise.reject(error);
    }
  }

  end(): void {
    // The Session owns backend disposal; ending the writer must not close it.
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeClose();
    super.dispose();
  }
}

function parseJsonRpcMessage(value: unknown): Message | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record["jsonrpc"] !== "2.0") return null;
  const hasMethod = typeof record["method"] === "string";
  const hasId = Object.prototype.hasOwnProperty.call(record, "id");
  const isResponse =
    hasId &&
    (Object.prototype.hasOwnProperty.call(record, "result") ||
      Object.prototype.hasOwnProperty.call(record, "error"));
  if (!hasMethod && !isResponse) return null;
  return value as unknown as Message;
}
