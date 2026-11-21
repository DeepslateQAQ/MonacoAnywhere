//===--- ClangdWasmMain.cpp ------------------------------------*- C++ -*-===//
// The WASM entry point deliberately embeds clangd's supported LSP API instead
// of emulating stdin/stdout. JavaScript owns the queue and multiplexes clients.

#include "BrowserTransport.h"

#include "ClangdLSPServer.h"
#include "ClangdServer.h"
#include "CodeComplete.h"
#include "clang/Basic/Version.h"
#include "index/Serialization.h"
#include "support/ThreadsafeFS.h"
#include "llvm/Support/Error.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#include <memory>
#include <string>

namespace {

// MonacoAnywhere fork: the static index is optional. clangd's dynamic index
// always covers the open document; a pack index adds toolchain symbols.
std::unique_ptr<clang::clangd::SymbolIndex> loadSystemIndex(const char *Path) {
  if (Path == nullptr || Path[0] == '\0')
    return nullptr;
  return clang::clangd::loadIndex(
      Path, clang::clangd::SymbolOrigin::Static,
      /*UseDex=*/true, /*SupportContainedRefs=*/false);
}

clang::clangd::ClangdLSPServer::Options makeOptions(
    clang::clangd::SymbolIndex *SystemIndex) {
  clang::clangd::ClangdLSPServer::Options Options;
  Options.AsyncThreadsCount = 0;
  Options.BuildDynamicSymbolIndex = true;
  Options.BackgroundIndex = false;
  Options.UseDirBasedCDB = false;
  Options.UseDirtyHeaders = true;
  Options.StorePreamblesInMemory = true;
  // One editor per worker/session; keep one idle AST.
  Options.RetentionPolicy.MaxRetainedASTs = 1;
  Options.ResourceDir = "/lib/clang/" CLANG_VERSION_MAJOR_STRING;
  Options.StaticIndex = SystemIndex;
  Options.CodeComplete.ForceLoadPreamble = true;
  Options.CodeComplete.InsertIncludes =
      clang::clangd::Config::HeaderInsertionPolicy::IWYU;
  Options.CodeComplete.AllScopes = true;
  Options.CodeComplete.EnableInsertReplace = false;
  Options.CodeComplete.RankingModel =
      clang::clangd::CodeCompleteOptions::DecisionForest;
  return Options;
}

algopro::clangd_wasm::BrowserTransport *ActiveTransport = nullptr;

} // namespace

// Emscripten invokes this asynchronously. It returns once clangd receives an
// LSP exit notification or the JS runtime disposes its message queue.
extern "C" {
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
// IndexPath is the mounted static index path, or "" for none. The dynamic
// index still tracks the open document.
int clangd_wasm_run(const char *IndexPath) {
  auto SystemIndex = loadSystemIndex(IndexPath);
  if (IndexPath != nullptr && IndexPath[0] != '\0' && !SystemIndex)
    return 2;

  clang::clangd::RealThreadsafeFS Filesystem;
  algopro::clangd_wasm::BrowserTransport Transport;
  ActiveTransport = &Transport;
  const auto Options = makeOptions(SystemIndex.get());
  clang::clangd::ClangdLSPServer Server(Transport, Filesystem, Options);
  const bool CleanShutdown = Server.run();
  ActiveTransport = nullptr;
  return CleanShutdown ? 0 : 1;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void clangd_wasm_stop() {
  if (ActiveTransport)
    ActiveTransport->requestStop();
}
}
