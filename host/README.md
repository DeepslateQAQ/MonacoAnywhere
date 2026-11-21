# MonacoAnywhere native host

A standalone Go program that provides local clangd to the extension over an
authenticated loopback WebSocket. It is not a daemon and is not installed with
system privileges.

## Build

From the repository root (the pinned devShell provides Go):

```sh
go build -ldflags "-X main.embeddedExtensionID=$(tr -d '\n' < extension-id.txt)" \
  -o host/dist/monacoanywhere-host ./host/cmd/monacoanywhere-host
```

`go build ./host/...` also works for a compile check; embedding the ID at build
time is required so the host can enforce the exact `Origin`.

## Install (per user)

```sh
host/dist/monacoanywhere-host install --extension-id "$(tr -d '\n' < extension-id.txt)"
```

This writes:

- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.monacoanywhere.host.json`
  and the same under `~/.config/microsoft-edge/NativeMessagingHosts/`.
- macOS: `~/Library/Application Support/{Google/Chrome,Microsoft Edge}/NativeMessagingHosts/…`
- Windows: `%LOCALAPPDATA%\MonacoAnywhere\com.monacoanywhere.host.json` plus the
  `HKCU\Software\{Google\Chrome,Microsoft\Edge}\NativeMessagingHosts\com.monacoanywhere.host`
  default values.

The host executable must stay at the absolute path recorded in the manifest; if
it moves, rerun `install`. `uninstall` removes only these files/keys.

## Serve

Chrome launches the binary with no arguments. The first native message must be:

```json
{"type":"ma/start","clangdPath":"/optional/path","queryDriverGlobs":[],"extraIncludeDirs":[]}
```

The host discovers clangd in this order: `--clangd`, `ma/start`'s `clangdPath`,
`PATH`. It requires clangd ≥ 17, starts it with `--background-index=false` and
an empty private cwd, and returns:

```json
{"type":"ma/ready","port":12345,"token":"…","clangdVersion":"clangd version …"}
```

`ma/stop`, stdin EOF, or closing the WebSocket shuts clangd down, flushes the
temporary workspace, and deletes it. Frame size to the browser is limited to
1 MiB.

`{"type":"ma/probe","protocol":1}` (as used by `sendNativeMessage`) returns
`{"type":"ma/probe-ok","protocol":1}` without starting clangd.

## Security boundary

- Loopback only, ephemeral port, 32 random bytes of token held in memory.
- `GET /lsp` requires the exact `Origin: chrome-extension://<id>` and either
  `Authorization: Bearer <token>` or the `ma-token.<token>` WebSocket
  subprotocol (browsers cannot set Authorization on WebSockets). Wrong origin is
  403, missing/wrong token 401, a second live connection 409.
- JSON-RPC is forwarded unchanged except protocol URI fields, compile-command
  paths and `compilationDatabaseChanges` keys. Document text and arbitrary
  strings are never searched or rewritten.
- `POST /ma/readFile` is token- and origin-protected, canonicalises symlinks and
  allows only the session workspace, user-configured include directories and
  clang resource include directories. Responses are base64 chunks of at most
  512 KiB.
- Ports and tokens are returned only over Native Messaging to the extension;
  they never appear in the page, a URL, or a log.

## Manual checks

```sh
curl -i http://127.0.0.1:<port>/lsp
# 401 without a token
curl -i -H 'Origin: https://example.com' -H 'Authorization: Bearer <token>' \
  http://127.0.0.1:<port>/lsp
# 403 for the wrong origin
```

The extension sends URI `file:///workspace/<path>` and absolute
`/workspace/<path>` compile arguments; the host maps them to its temporary
directory. Headers outside that directory come back as
`file:///toolchain/<absolute-path>` and are readable through `/ma/readFile`
only within the allowlist.
