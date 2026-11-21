import { REQUIRED_WASM_FEATURES } from "./required-wasm-features.js";

/**
 * Checks what the packaged runtime needs: a dedicated Worker, JSPI, bulk memory
 * and tail calls. The MonacoAnywhere fork uses one Worker per session, so
 * SharedWorker and Web Locks are deliberately not required.
 */
export function isClangdWasmSupported(): boolean {
  if (typeof Worker !== "function" || typeof WebAssembly === "undefined") {
    return false;
  }
  const wasm = WebAssembly as typeof WebAssembly & {
    Suspending?: unknown;
    promising?: unknown;
  };
  return (
    typeof wasm.Suspending === "function" &&
    typeof wasm.promising === "function" &&
    WebAssembly.validate(REQUIRED_WASM_FEATURES)
  );
}
