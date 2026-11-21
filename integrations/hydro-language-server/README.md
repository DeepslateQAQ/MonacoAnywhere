# Hydro cooperative language-server patch

MonacoAnywhere can only take over C/C++ language services on a Hydro deployment
whose `@hydrooj/language-server` addon carries this patch. Unpatched deployments
keep their remote provider; the extension shows “不可安全接管” and never
registers a competing provider.

## Pinned upstream

- Addon: `@hydrooj/language-server` 0.0.2
- Revision: `dbcbfc5fac360fa7d76302e8716382c764190cf1`
- Verified file: `frontend/lsp.lazy.ts`, git blob SHA-1
  `c695b069cc213b341e7d7ed7cd24b25842891032`
- Hydro frontend: `>= 4.59.1`
- Patch protocol: 1, patch version 1.0.0

The installer refuses a source tree whose blob hashes differ. It does not
fuzzy-match and does not modify commercial/private forks; those need their own
patch against their own source.

## Apply

The addon directory is the installed `@hydrooj/language-server` package, for
example `~/hydro/addons/language-server` in a source deployment.

```sh
node integrations/hydro-language-server/apply.mjs --addon <dir> --check
node integrations/hydro-language-server/apply.mjs --addon <dir> --apply
```

`--check` prints `可应用` for a pristine pinned source or `已应用` when the
patch is present, and exits 0. A source mismatch prints an error and exits 2
without writing anything.

Restart the deployment the same way it is normally restarted. With PM2:

```sh
pm2 restart hydrooj
```

## What the patch changes

- `registerLspProvider` gains an optional `cooperative` flag and returns
  `{ status(), suspend(), resume() }`. Only the C/C++ provider is cooperative;
  Python and Java behaviour is unchanged.
- Suspending clears the visibility timer, suppresses model additions, stops the
  language client and closes the remote WebSocket. Resuming re-adds C/C++ models
  that still exist in the site Monaco.
- A guarded `window.postMessage` bridge answers `ma/lsp-hello` with
  `ma/lsp-status` (`protocol`, `patchVersion`, `upstreamRevision`, `state`), and
  handles `ma/lsp-suspend-cpp` / `ma/lsp-resume-cpp`. Endpoint and tokens are
  never returned.
- `state` is `running`, `suspended`, or `unsupported` when the C/C++ provider
  is absent.

The extension switches providers strictly in this order: remote `suspend`
completes, then the local session starts; local dispose completes, then remote
`resume`. A failure rolls back to the remote running state and shows the error.

## Revert

```sh
node integrations/hydro-language-server/apply.mjs --addon <dir> --revert
```

Revert uses `state.json` written by `--apply`, verifies hashes, restores the
pinned original bytes, and removes the state file. Without `state.json` it
refuses to touch the source. Restart the deployment afterwards.

## Fixture

`tests/fixtures/hydro-addon/` contains the exact pinned upstream
`package.json` and `frontend/lsp.lazy.ts` used for reproducibility checks. The
fixture’s content hash must remain `c695b069…`.
