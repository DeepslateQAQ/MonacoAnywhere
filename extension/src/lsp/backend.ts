/*
 * JSON-RPC transport boundary. Implementations may be the WASM engine worker
 * bridge or the native host WebSocket; both pass decoded JSON-RPC objects,
 * never Content-Length framed strings.
 */

export interface Backend {
  /** Send one decoded JSON-RPC message. Must not block. */
  send(message: object): void;
  /** Subscribe to decoded JSON-RPC messages; returns an unsubscribe function. */
  onMessage(callback: (message: unknown) => void): () => void;
  /** Subscribe to transport closure; fires at most once. */
  onClose(callback: (reason: string) => void): () => void;
  /** Dispose the transport. Idempotent. */
  dispose(): Promise<void>;
  /**
   * Optional read access to files mounted for this session (WASM sysroot or
   * native toolchain files). The implementation enforces its own path policy.
   */
  readFile?(uri: string): Promise<string | null>;
}
