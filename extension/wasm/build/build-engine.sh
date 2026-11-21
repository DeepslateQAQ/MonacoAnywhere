#!/usr/bin/env bash
# MonacoAnywhere maintenance fork of the upstream build script.
#
# Differences from upstream (see ../FORK-NOTICE.md):
#  - Emscripten may come from the pinned Nix devShell (6.0.9) instead of emsdk.
#  - No CLANGD_WASM_SYSROOT: the toolchain sysroot is mounted at session time.
#  - Artifacts land in dist/ with MonacoAnywhere names, plus engine-build.json.
set -euo pipefail

package_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1091
source "$package_root/build/config.env"
# shellcheck disable=SC1091
source "$package_root/build/llvm-patches.sh"
if [[ -f "$package_root/build/work/dependencies.env" ]]; then
  # shellcheck disable=SC1091
  source "$package_root/build/work/dependencies.env"
fi

: "${LLVM_SRC:?Set LLVM_SRC to an LLVM source checkout at $LLVM_REVISION}"
test -d "$LLVM_SRC/llvm"

if [[ -n "${EMSDK:-}" ]]; then
  test -x "$EMSDK/upstream/emscripten/emcmake"
  # shellcheck disable=SC1091
  source "$EMSDK/emsdk_env.sh" >/dev/null
  emcmake_bin="$EMSDK/upstream/emscripten/emcmake"
else
  emcmake_bin=$(command -v emcmake || true)
  [[ -n "$emcmake_bin" ]] || {
    echo "No Emscripten found. Use the pinned Nix devShell or set EMSDK." >&2
    exit 1
  }
fi

mkdir -p "$package_root/build/work" "$package_root/dist"

trap 'restore_llvm_patches "$LLVM_SRC"' EXIT INT TERM
apply_llvm_patches "$LLVM_SRC"

"$emcmake_bin" cmake -S "$LLVM_SRC/llvm" -B "$package_root/build/work/llvm-wasm" -G Ninja \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DCMAKE_C_FLAGS=-mtail-call \
  -DCMAKE_CXX_FLAGS=-mtail-call \
  -DLLVM_ENABLE_PROJECTS=clang\;clang-tools-extra \
  -DLLVM_TARGETS_TO_BUILD= \
  -DLLVM_ENABLE_LTO="$LLVM_ENABLE_LTO" \
  -DCROSS_TOOLCHAIN_FLAGS_NATIVE=-DLLVM_ENABLE_ASSERTIONS=OFF\;-DLLVM_ENABLE_EH=OFF\;-DLLVM_ENABLE_RTTI=OFF\;-DLLVM_ENABLE_LTO=OFF\;-DLLVM_ENABLE_ZLIB=OFF\;-DCLANGD_TIDY_CHECKS=OFF\;-DCLANG_BUILD_TOOLS=OFF\;-DCLANG_ENABLE_STATIC_ANALYZER=OFF\;-DCLANG_ENABLE_ARCMT=OFF \
  -DLLVM_ENABLE_ASSERTIONS=OFF \
  -DLLVM_ENABLE_EH=OFF \
  -DLLVM_ENABLE_RTTI=OFF \
  -DLLVM_ENABLE_THREADS=ON \
  -DLLVM_ENABLE_ZLIB="$LLVM_ENABLE_ZLIB" \
  -DCLANGD_DECISION_FOREST="$CLANGD_DECISION_FOREST" \
  -DCLANGD_TIDY_CHECKS=OFF \
  -DCLANG_ENABLE_CLANGD=ON \
  -DLLVM_EXTERNAL_PROJECTS=clangd_wasm \
  -DLLVM_EXTERNAL_CLANGD_WASM_SOURCE_DIR="$package_root/native" \
  -DCLANG_BUILD_TOOLS=OFF \
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
  -DCLANG_ENABLE_ARCMT=OFF \
  -DLLVM_BUILD_TESTS=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_DOCS=OFF

cmake --build "$package_root/build/work/llvm-wasm" --target clangd-wasm-runtime
cmake --build "$package_root/build/work/llvm-wasm" --target clangd-wasm-native-indexer
cmake --build "$package_root/build/work/llvm-wasm/NATIVE" \
  --target clangd-indexer clang-resource-headers

runtime="$package_root/build/work/llvm-wasm/bin/clangd-runtime.js"
wasm="$package_root/build/work/llvm-wasm/bin/clangd-runtime.wasm"
headers="$package_root/build/work/llvm-wasm/bin/clangd-runtime.data"
test -s "$runtime"
test -s "$wasm"
test -s "$headers"
install -m 0644 "$runtime" "$package_root/dist/clangd-runtime.mjs"
install -m 0644 "$wasm" "$package_root/dist/clangd.wasm"
install -m 0644 "$headers" "$package_root/dist/clangd-runtime.data"
install -m 0644 "$package_root/README.md" "$package_root/dist/README.md"

llvm_version=${LLVM_REVISION#llvmorg-}
llvm_major=${llvm_version%%.*}
resource_dir="$package_root/build/work/llvm-wasm/NATIVE/lib/clang/$llvm_major"
native_indexer="$package_root/build/work/llvm-wasm/NATIVE/bin/clangd-indexer"
test -x "$native_indexer"
test -d "$resource_dir/include"
printf 'export CLANGD_INDEXER=%q\nexport CLANG_RESOURCE_DIR=%q\n' \
  "$native_indexer" "$resource_dir" > "$package_root/build/work/native-tools.env"

node -e '
const { createHash } = require("node:crypto");
const { readFileSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const dist = process.argv[1];
const files = ["clangd.wasm", "clangd-runtime.mjs", "clangd-runtime.data"];
const sha256 = (file) =>
  createHash("sha256").update(readFileSync(path.join(dist, file))).digest("hex");
const info = {
  schema: "monacoanywhere.engine-build/1",
  engineAbi: "ma-clangd-wasm/1",
  llvmRevision: process.env.LLVM_REVISION,
  emscripten: process.env.EMSCRIPTEN_VERSION,
  buildId: sha256("clangd.wasm"),
  artifacts: Object.fromEntries(
    files.map((file) => [file, {
      bytes: statSync(path.join(dist, file)).size,
      sha256: sha256(file)
    }])
  )
};
writeFileSync(path.join(dist, "engine-build.json"), JSON.stringify(info, null, 2) + "\n");
' "$package_root/dist"

echo "WASM engine assets and native clangd-indexer are ready."
