# MonacoAnywhere

MonacoAnywhere is a Chromium desktop extension that replaces or augments
online-judge code editors with Monaco 0.57.0 and real C++ language services.
The project is licensed `AGPL-3.0-only`.

> **Current status: bootstrap build, not a release.**
>
> This repository currently contains a loadable MV3 bootstrap: stable extension
> ID, dynamic content-script registration, scoped offline Material 3 Expressive
> pages, and a working Monaco fixture with C++ syntax highlighting.
> It does **not** yet contain the WASM engine, native host, data packs, OJ
> adapters, drafts, LSP sessions, or real OOBE validation. Language services are
> explicitly unavailable; no engine or OOBE success is simulated.

## What works in this build

- Monaco 0.57.0 loads in an extension page. `editor.html?fixture=1` is a real
  fixture: typing, undo, find, and C++ syntax highlighting work.
- Extension pages (`onboarding.html`, `options.html`, `popup.html`) can read and
  save the local `settings:v1` preference object. Onboarding deliberately has no
  backend preselected and cannot write `onboardingComplete`.
- Shared Material 3 Expressive controls use native HTML semantics, self-hosted
  fonts, and Simplified Chinese/English messages. UI styles do not target Monaco.
- The service worker registers MAIN-world and ISOLATED-world content scripts
  dynamically. Fixed OJ origins come from `manifest.json`; manually approved
  origins are read from `siteRegistrations:v1` and intersected with granted
  permissions. There is no static `content_scripts` declaration.
- A content script on a matching page only adds a dismissible status banner. It
  does not hide, replace, or modify any editor.
- The MAIN-world entry exposes a closed `ma/bridge-hello` message that returns
  static build status. It cannot execute scripts or forward chrome APIs.

## Not implemented yet

- WASM clangd engine, source-rebuilt runtime, resource headers, and toolchain
  data packs.
- Native Go host, clangd discovery, Native Messaging, and loopback WebSocket.
- OJ adapters, editor takeover, language mapping/synchronisation, and drafts.
- LSP providers, diagnostics, workspace edits, header navigation, and the
  offscreen session owner. The offscreen document exists only as a status
  placeholder and reports `engine: "unavailable"`.

OJ adapters must not be implemented before the real WASM engine fixture spike
passes.

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

## Bootstrap quick start

```sh
pnpm install
node esbuild.config.mjs --bootstrap
```

Then:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repository's `dist/` directory.
4. Confirm that the extension ID shown by the browser equals the content of
   `extension-id.txt` (one line, the 32-character Chrome alphabet `a`–`p`).
5. Click the extension action, then **Open Monaco fixture**, or open
   `editor.html?fixture=1` from the extension. The status bar must say that
   language services are unavailable. This is expected in bootstrap mode.

The bootstrap mode is explicit. It is recorded in `dist/build-info.json`, in
`editor.html`'s status bar, and in the popup/onboarding/options surfaces. It does
not copy engine artifacts or a data catalogue and cannot be used as a substitute
for the production gate.

`pnpm typecheck` checks the TypeScript sources. The bootstrap was exercised in
Chromium 157: the loaded ID matched `extension-id.txt`, C++ editing and Undo
worked, and the ten declared MAIN/ISOLATED registrations used only their
dedicated site matches. Production builds rejected the absent engine.
These checks do not establish full clangd or OJ compatibility.

Shared UI modules live in `extension/src/ui/`. Use `theme.css?inline` for shadow
roots; its processed font URLs stay on the extension origin. For asynchronous
dialogs outside a focused toolbar, pass `{ host: shadowRoot }` to `openDialog`.
Native dialog cancellation/focus restoration, light/dark token inheritance,
button press morphing, and the loading indicator's static reduced-motion frame
were exercised in Chromium. `pnpm exec vitest run tests/i18n.test.ts` covers key
compatibility, locale selection, and interpolation; missing translations also
abort the build.


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
leaves any existing `dist/` untouched and exits non-zero. The script refuses
unknown flags, so there is no environment switch that silently turns a
production build into bootstrap mode.

Even after the artifacts exist, this particular slice still does not implement
the LSP session; the production gate proves packaging prerequisites, not engine
readiness. The WASM spike and session integration are later phases.

## Build outputs

| Output | Purpose |
| --- | --- |
| `background.js` | MV3 service worker: dynamic registration, install onboarding |
| `content-isolated.js` | ISOLATED content script (status banner only) |
| `content-main.js` | MAIN-world closed bridge baseline |
| `editor.js`, `editor.css` | Monaco fixture / future replacement editor page |
| `onboarding.js`, `options.js`, `popup.js`, `offscreen.js` | Extension pages |
| `theme.css`, `fonts/` | Scoped M3E stylesheet and offline font assets |
| `licenses/` | Original component licenses/NOTICES and hashed provenance |
| `workers/editor.worker.js`, `workers/ts.worker.js` | Monaco workers, loaded via `chrome.runtime.getURL` with `{ type: "module" }` |
| `manifest.json` | Source manifest with the package version injected |
| `icons/` | Extension icons |
| `build-info.json` | Mode, version, extension ID, engine availability |
| `wasm/`, `data/catalogue.json` | Production build only; copied after validation |

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

The future picker/manual-site UI will be the only writer of
`siteRegistrations:v1`; nothing in this slice registers every granted origin.

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
already have Monaco keep their model and receive only the extension's LSP
providers. Both paths share one LSP/provider layer later; this slice contains
neither path's implementation.

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
- The bootstrap content script does not read code, hide editors, or start an
  adapter. Drafts are absent; when added they must be local-only and isolated by
  origin/account/problem/editor slot.

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
  src/background/index.ts               service worker registration/onboarding
  src/content/index.ts                  status-only ISOLATED entry
  src/page-adapter/index.ts             closed MAIN-world bridge baseline
  src/editor/index.ts                   Monaco fixture + worker setup
  src/onboarding/index.ts               backend choice, no completion
  src/options/index.ts                  local preference editing
  src/popup/index.ts                    status and navigation
  src/offscreen/index.ts                status-only engine placeholder
  src/globals.d.ts                      build constants and settings shape
extension-id.txt                        generated from the committed key
LICENSE                                  AGPL-3.0-only full text
THIRD-PARTY-NOTICES.md                   dependency, engine, and data notices
```

The native Go host, Hydro patch kit, WASM fork, site adapters, LSP layer, data
loader, and their test suites remain later slices.

## License

The project is `AGPL-3.0-only`; see [`LICENSE`](LICENSE). Third-party
components, fonts, and future toolchain data retain their own licenses and
sources; see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

This repository is not a public release and makes no stability or language-
service-readiness promise yet.
