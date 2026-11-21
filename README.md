# MonacoAnywhere

MonacoAnywhere is a Chromium desktop extension that replaces or augments
online-judge code editors with Monaco 0.57.0 and real C++ language services.
The project is licensed `AGPL-3.0-only`.

> **Current status: functional production build for the four planned OJ
> families.**
>
> The repository contains the WASM clangd engine, the Go native host, data
> packs, OJ adapters (Luogu, AtCoder, Codeforces, Hydro including its online
> IDE), manual generic-site rules, IndexedDB drafts, and shared LSP sessions.
> Verification is recorded below; gaps are listed explicitly instead of being
> presented as working features.

## What works in this build

- Monaco 0.57.0 loads in an extension page. `editor.html?fixture=1` is a real
  fixture with typing, undo, find, and C++ syntax highlighting.
- A production build includes the rebuilt Emscripten clangd engine, Debian
  GCC 15 toolchain pack, diagnostics, completion, hover, definition, references,
  safe workspace edits, and header navigation.
- Both backends are selectable: WASM clangd in a worker and a Go Native
  Messaging host that launches the system clangd and serves an authenticated
  loopback WebSocket.
- Luogu (CM6 submit/IDE), AtCoder (Ace/plain submit), Codeforces (Ace submit
  pages including `/problemset/submit/<id>/<letter>`), and Hydro (submit
  textarea and the online IDE reached with Alt+E) are taken over with element
  hiding, exact restore, and bidirectional text/language sync.
- Hydro deployments are identified from `data-app="Hydro"`, not a fixed domain.
  The online IDE keeps its problem URL; detection also checks the
  `mode--scratchpad` body state. Its unnamed `<select class="select">` language
  control is read and mapped to the shared C++ profiles.
- On Hydro pages, an explicit WASM/local choice makes the document-start client
  gate skip the site LSP initializer entirely: no site providers, model
  listeners, language clients, or LSP WebSocket are created. An already-started
  site LSP or a return to the site service requires a page reload; the extension
  does not fake provider teardown.
- The site editor header is a single 34 px row with the C++ standard selector
  and one status line. Backend, site-service, and theme controls live in the
  popup: a status card, a segmented backend choice (including site service on
  Hydro), a theme selector, and buttons for the standalone editor and settings.
- The default editor font is CSS `monospace`, so the editor uses the user's
  browser-configured monospace font. A custom CSS font stack can be entered in
  settings; the legacy built-in default is migrated to `monospace`.
- The standalone editor opens a blank C++ workspace, exposes the same seven
  standard choices, and restarts local clangd when the standard changes.
  VS Code-like shortcuts include Ctrl/Cmd+Shift+P (command palette), F1,
  Ctrl/Cmd+Shift+O (symbols), Ctrl/Cmd+S (save draft), Ctrl/Cmd+F, and
  Ctrl/Cmd+G; common Monaco editing bindings remain available.
- Unexpected language-service transport closures are retried three times with
  exponential backoff while the model text stays intact. Exhausted retries show
  an explicit error instead of silently degrading.
- Selecting an editor theme also retints the extension's M3E primary,
  secondary, tertiary and container tokens from that theme's principal accent;
  the popup and editor chrome update immediately. Backend choices use the M3E
  connected button group, not the deprecated segmented-button CSS.
- Monaco enables `calt`/`liga` ligatures through `fontLigatures: true`, so a
  ligature-capable browser monospace font renders them normally.
- Monaco's own UI follows the persisted extension locale before its modules
  load: Simplified Chinese uses Monaco's bundled NLS table, other locales keep
  Monaco's inline English strings. Context menus, find, and command palette use
  explicit opaque theme colors.
- Draft save/conflict notices appear as a compact floating toast over the editor
  instead of consuming another header row.
- Monaco offers its native VS Code themes, classic VS Code built-ins (Monokai,
  Solarized Dark/Light, Abyss, Kimbie Dark, Quiet Light, Tomorrow Night Blue,
  Red, Dark Modern, Light Modern), and the four Catppuccin variants using the
  official `catppuccin/vscode` theme definitions.
- Manually enabled origins use an explicit picker and persisted generic rules;
  the popup requests the optional host permission and registers the origin.
- Drafts are stored in IndexedDB keyed by origin/account/problem/slot, with
  revision and writer-session checks, leases, cross-tab broadcasts, conflict UI,
  and local-only recovery.
- Onboarding, options, popup, and editor UI are shared M3E surfaces with
  Simplified Chinese/English messages, light/dark/system themes, reduced-motion
  handling, focus restoration, and keyboard-operable controls.

## Known gaps

- Hydro's addon has no public client teardown API. Choices apply on the next
  page load when the site LSP already initialized; the overlay is withheld until
  then. Denying the addon pauses its whole bundle on that page, so site-side
  Python/Java language services are also absent until reload.
- AtCoder real submission is pending a logged-in account; the guest session
  cannot submit. The other three sites were submitted and accepted.
- Generic rules are saved with the current path pattern; broadening them for
  problem families is a manual rule edit until a rule editor ships.
- Firefox, Safari, and mobile are out of scope.

## Verification

Run locally:

```sh
pnpm typecheck
pnpm test
CHROMIUM_EXECUTABLE=/path/to/chromium pnpm test:e2e
```

The release candidate was exercised in Chromium 157 with the extension loaded
from `dist/`:

- The Monaco fixture and a Luogu CM6 submit page mount, hide the native editor,
  mirror typing back to the site, and restore the native editor on teardown.
- AtCoder submit and Codeforces `/problemset/submit/1/A` mount over their native
  editors; Codeforces language changes update the site select (`GNU G++23 14.2`)
  and the shared toolbar profile.
- A private Hydro deployment is detected from `data-app="Hydro"`. Both the
  submit textarea and the Alt+E online IDE mount. The IDE's unnamed
  `select.select` yields `C++14`, the site language remains in sync, and WASM
  clangd reports ready.
- On a fresh Hydro IDE page with WASM selected, the document-start gate kept
  `window.__Hydro_lsp_loaded` undefined, no site LSP console messages or
  WebSocket were observed, and the overlay reported the site LSP as paused.
  Choosing “Use site service” produced an explicit reload-required notice;
  after reload the original site LSP started with no overlay. The options reset
  action cleared the per-site choice, and selecting WASM again restored the
  gated overlay.
- The generic picker selected a textarea and language select on an approved
  local origin, saved a rule, mounted the overlay, and mirrored editor text to
  the native textarea.
- The native smoke test verified token/origin/upgrade rejection (401/403/426),
  clangd initialization, diagnostics, completion, hover, workspace path guards,
  shutdown, and host exit.
- Real submissions from an explicit user request: Luogu P1001 record
  `R311370357` Accepted, Codeforces 1A submission `399395178` Accepted, and the
  private Hydro A101 record AC 10/10. An earlier Luogu record `R311370343` was
  a Compile Error caused by shell escaping in the test harness, not by the
  extension; it is disclosed here instead of being hidden. AtCoder could not be
  submitted from a guest session; its editor and language sync were verified
  only.
- Light and dark preferences render; the shared controls keep keyboard focus,
  reduced-motion behavior, and focus restoration in unit tests.

Toolchain data is public at
[`data-2026.11.1`](https://github.com/DeepslateQAQ/MonacoAnywhere/releases/tag/data-2026.11.1).
The Debian GCC 15 pack downloads with SHA-256
`d56d1729ca4dd0f7a46b8f5b34df5e1e642e78a4e892b2bab93828a17a54190e`.

## Requirements

- Chromium desktop 137 or newer. Chrome and Edge are the acceptance targets;
  Firefox, Safari, and mobile are out of scope.
- Node.js 22 or newer. The repository pins pnpm `12.9.0` in `package.json`.
- Nix with flakes is optional but is the reproducible development path.

The default Nix shell provides Node, pnpm, Go, clangd, LLVM, Emscripten, CMake,
Ninja, Python, and related build tools. A separate `.#browser` shell provides an
unbranded Chromium and exports `CHROMIUM_EXECUTABLE`:

```sh
direnv allow                         # activates the default devShell
nix develop .#browser                # separate shell with Chromium
printf '%s\n' "$CHROMIUM_EXECUTABLE"
```

Recent branded Chrome builds may ignore or remove the command-line
`--load-extension` switch. In that case load the unpacked directory manually via
`chrome://extensions`, or use the Chromium binary from `.#browser`. This project
does not depend on an automated browser launch.

## Quick start

```sh
pnpm install
node esbuild.config.mjs
```

Then:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repository's `dist/` directory.
4. Confirm that the extension ID equals `extension-id.txt`.
5. Complete the setup wizard, choose WASM or the local backend, then open a
   supported problem page. The editor overlay and toolbar should appear.

`--bootstrap` still exists for UI-only development. It records bootstrap mode in
`dist/build-info.json` and omits the engine and catalogue; it is not a release
build.

Shared UI modules live in `extension/src/ui/`. Use `theme.css?inline` for shadow
roots; its processed font URLs stay on the extension origin. For asynchronous
dialogs outside a focused toolbar, pass `{ host: shadowRoot }` to `openDialog`.

## Production build gate

```sh
node esbuild.config.mjs
```

Production mode succeeds only when all of the following are present and valid:

```text
extension/manifest.json                         committed RSA public key
extension/wasm/dist/clangd.wasm                 non-trivial WASM, valid magic
extension/wasm/dist/clangd-runtime.mjs          real ESM runtime
extension/wasm/dist/clangd-runtime.data         resource headers
extension/src/data/catalogue.json               real pack bytes/sha256 + engine ID
```

`extension/wasm/dist/system-indexer` is copied if present. The catalogue must
use `schema: "monacoanywhere.catalogue/1"`, `engineAbi: "ma-clangd-wasm/1"`,
and its `engineBuildId` must equal the SHA-256 of `clangd.wasm`. Pack entries
must have positive sizes, real lowercase SHA-256 values, and HTTPS mirrors on
the allowlisted GitHub/gh-proxy hosts. Placeholder hashes, zero sizes, missing
artifacts, and invalid catalogue JSON fail the build.

Validation completes **before** `dist/` is removed. A failed production build
leaves any existing `dist/` untouched and exits non-zero.

## Build outputs

| Output | Purpose |
| --- | --- |
| `background.js` | MV3 service worker: sessions, offscreen/native routing, registration |
| `content-isolated.js` | ISOLATED router, overlay, drafts, picker, language sync |
| `content-main.js` | MAIN-world site bridge for the four adapters and generic rules |
| `editor.js`, `editor.css` | Monaco editor page with LSP providers and toolbar |
| `onboarding.js`, `options.js`, `popup.js`, `offscreen.js` | Setup, preferences, site approval, engine owner |
| `theme.css`, `fonts/` | Scoped M3E stylesheet and offline font assets |
| `licenses/` | Original component licenses/NOTICES and hashed provenance |
| `workers/editor.worker.js`, `workers/ts.worker.js` | Monaco workers |
| `workers/clangd.worker.js`, `wasm/` | Emscripten clangd worker and engine |
| `manifest.json` | Manifest with the package version injected |
| `icons/` | Extension icons |
| `build-info.json` | Mode, version, extension ID, engine availability |
| `data/catalogue.json` | Toolchain pack metadata and hashes |

`editor.js` sets `MonacoEnvironment.getWorker` to return workers from
`workers/`; the editor page never loads script from a remote URL. Worker and
asset paths are part of the extension package. Monaco CSS is emitted separately
as `editor.css` and linked by `editor.html`.

## Dynamic content-script policy

There are no static `content_scripts` entries. On install, startup, permission
changes, and `siteRegistrations:v1` changes the service worker synchronises
these registrations:

- Fixed built-ins: `https://*.luogu.com.cn/*`, `https://*.luogu.org/*`,
  `https://atcoder.jp/*`, `https://codeforces.com/*`, `https://*.hydro.ac/*`.
- Optional sites: only origins explicitly listed in `siteRegistrations:v1`
  (match patterns such as `https://host/*`, `*://host/*`, or the bare origin
  `https://host`) **and** granted by `chrome.permissions.getAll()`. The parser
  rejects wildcard hosts, `<all_urls>`, and `*://*/*`. A granted data-download
  origin is not registered unless it also appears in `siteRegistrations:v1`.
- Each origin produces `ma-main:<match>` (`content-main.js`, MAIN world) and
  `ma-iso:<match>` (`content-isolated.js`, ISOLATED world), with
  `runAt: "document_idle"` and `allFrames: false`.
- Removing a permission removes the corresponding registrations on the next
  sync. Broad registration is refused by an explicit guard.

The popup's **Enable on site** action and the generic editor picker are the only
writers of `siteRegistrations:v1`. The popup awaits the background
`ma/sync-sites` acknowledgement before reloading the tab.

## Target architecture

The target implementation keeps the host page untrusted:

```text
OJ page
├─ ISOLATED content script ── chrome.runtime.Port ──► service worker
└─ MAIN-world bridge ── window.postMessage (closed schema) ──┘
                                                    │
                                                    ▼
                                          offscreen document
                                          ├─ WASM clangd worker / session
                                          └─ native host WebSocket
```

Replacement editors use an extension-origin `editor.html` iframe. Sites that
already have Monaco are covered by the same overlay after an explicit per-site
backend choice. For Hydro, a narrow MAIN-world gate at document start holds the
legacy LSP module's initializer until the stored per-origin choice is known, so
the overlay and the site LSP cannot compete. No server-side change is involved.

## Security notes

- Manifest `key` is a committed RSA **public** key. The matching private key is
  never committed. The browser's extension ID is derived from the public-key
  SHA-256 and is written to `extension-id.txt`.
- The extension CSP permits local WASM evaluation, extension workers, loopback
  connections, and the named data-release hosts only. Workers are addressed
  through `chrome.runtime.getURL`; no `blob:` worker is required.
- The MAIN-world bridge accepts only same-window messages with a fixed enum,
  strict shape, and a 1 MiB serialised limit. It has no script-evaluation or
  chrome-API forwarding channel.
- Extension settings are changed only from extension-origin pages. Page content
  cannot write settings or request host permissions.
- The Hydro LSP gate recognizes only the declared `monaco-{cpp,c,python,java}@lsp`
  module URL and leaves unrelated `window.exports` assignments intact. It never
  sends page code anywhere, never patches WebSocket globally, and requires a
  reload when no safe module interception exists.
- The content script only reads or hides an editor after a dedicated adapter or
  user-created generic rule matches. Drafts are local-only in IndexedDB, keyed by
  origin/account/problem/editor slot, with revision, lease, and writer-session
  isolation.

## Repository layout (current slice)

```text
package.json, pnpm-workspace.yaml       workspace and exact dependency pins
tsconfig.base.json, tsconfig.json       strict TypeScript configuration
esbuild.config.mjs                      bootstrap/production builds and gates
extension/
  manifest.json                         MV3 manifest with stable public key
  editor.html … offscreen.html          extension pages
  icons/                                extension icons
  fonts/                                self-hosted fonts and provenance
  licenses/                             original upstream licenses and notices
  src/ui/                               scoped M3E primitives and i18n
  src/background/index.ts               service worker registration/session routing
  src/content/index.ts                  site router, overlay, drafts, picker
  src/content/lsp-decision.ts           early per-origin Hydro LSP decision
  src/content/*.ts                      generic rules, language sync, mount
  src/page-adapter/bridge.ts            MAIN-world site bridge and Hydro gate
  src/editor/index.ts                   Monaco, LSP providers, toolbar
  src/lsp/                              session, providers, transport, guard
  src/onboarding/index.ts               backend choice and real probe
  src/options/index.ts                  local preference editing
  src/popup/index.ts                    status, site enable, navigation
  src/offscreen/index.ts                WASM/native engine owner
  src/data/                             catalogue, toolchain packs, drafts
  src/sites/                            Luogu, AtCoder, Codeforces, Hydro adapters
  src/globals.d.ts                      build constants and settings shape
extension-id.txt                        generated from the committed key
LICENSE                                  AGPL-3.0-only full text
THIRD-PARTY-NOTICES.md                   dependency, engine, and data notices
host/                                    Go native-messaging host and installers
scripts/                                 pack build, licenses, release helpers
```

## License

The project is `AGPL-3.0-only`; see [`LICENSE`](LICENSE). Third-party
components, fonts, and future toolchain data retain their own licenses and
sources; see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

This repository is a public release. Language-service readiness is limited to
the verified backends and sites above; the known gaps are listed explicitly.
