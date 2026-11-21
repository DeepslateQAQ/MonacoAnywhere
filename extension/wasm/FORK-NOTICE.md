# MonacoAnywhere engine fork

This directory vendors `@algoproclub/clangd-wasm` as a git subtree and is built
locally; the published npm binary is never shipped.

- Upstream: https://github.com/algoproclub/clangd-wasm
- Imported commit: `3bcab14849f48dbed7511cbc0d5cab6819982510` (release 0.1.1)
- License: Apache-2.0 WITH LLVM-exception (see `LICENSES/`)
- LLVM source: `llvmorg-23.1.1` = `6dfe1677ab8dffbc6ec13d53a1e0215d75147689`
- Emscripten: 6.0.9

## Changes from upstream

1. `native/ClangdWasmMain.cpp`
   - `clangd_wasm_run` takes the static-index path; an empty string means no
     static index (the dynamic index still tracks the open document).
   - `BuildDynamicSymbolIndex = true` and `UseDirtyHeaders = true`.
   - Unchanged: `AsyncThreadsCount = 0`, `BackgroundIndex = false`,
     `UseDirBasedCDB = false`, `StorePreamblesInMemory = true`, resource dir,
     IWYU include insertion, and decision-forest ranking.
2. `native/CMakeLists.txt`
   - Removed the `CLANGD_WASM_SYSROOT` requirement and its `--preload-file`.
   - Clang's own resource headers remain preloaded into
     `/lib/clang/<major>/include`; the toolchain sysroot is mounted by the
     session worker from a verified data pack.
   - Existing JSPI flags, `JSPI_EXPORTS=['clangd_wasm_run']`,
     `ENVIRONMENT=worker`, modular ES6 output, and `--no-entry` are retained.
3. `build/build-engine.sh`
   - Works with the pinned Nix Emscripten 6.0.9 when `EMSDK` is unset.
   - No sysroot input.
   - Installs `dist/{clangd.wasm,clangd-runtime.mjs,clangd-runtime.data}` and
     writes `dist/engine-build.json` with artifact sizes and SHA-256 hashes.
4. `src/browser.ts`, `src/clangd.worker.ts`, `src/support.ts`
   - Replaced the SharedWorker multiplexer with one dedicated Worker per
     clangd session. Every client JSON-RPC message and every server message or
     request is forwarded unchanged; there is no virtual `initialize`, ID or URI
     rewriting, capability filtering, or idle stop.
   - Support requirements are dedicated `Worker`, WebAssembly JSPI, and the
     bulk-memory/tail-call probe. SharedWorker and Web Locks are not required.
   - The worker mounts pack files, optionally an index, and calls
     `ccall("clangd_wasm_run", "number", ["string"], [indexPath], {async:true})`.
   - `readFile` is limited to `/sysroot/`, `/lib/clang/`, and `/workspace/`.
   - Disposal sends `stop` and terminates after a two-second grace period.

`src/clangd.shared-worker.ts` and `src/compiler-arguments.ts` are retained from
upstream only until the extension's own worker is fully integrated; the built
extension uses `src/clangd.worker.ts`.

## Building

From the repository root, inside the pinned devShell:

```sh
LLVM_SRC=$PWD/.build/llvm-project EMSCRIPTEN_VERSION=6.0.9 \
  bash extension/wasm/build/build-engine.sh
```

The LLVM source checkout must be at the pinned revision. Apply/remove of the
two upstream LLVM patches is handled by the build script and must stay
byte-identical to `patches/`.
