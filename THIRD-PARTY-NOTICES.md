# Third-party notices

MonacoAnywhere is licensed under `AGPL-3.0-only`; the full license text is in
[`LICENSE`](LICENSE). This file records the third-party software, fonts, and
toolchain data used by the project. Copyright in these works remains with their
respective authors and projects. MonacoAnywhere claims no copyright in them.

The current bootstrap build contains no clangd engine and no toolchain data
pack. The engine/data entries below are recorded now because the repository and
future release artifacts must carry their notices; they are not present in
`dist/` until the engine gate is satisfied.

## Components

| Component | Version / revision | License | Upstream source |
| --- | --- | --- | --- |
| Monaco Editor (`monaco-editor`) | 0.57.0 | MIT | https://github.com/microsoft/monaco-editor |
| VS Code language server protocol and JSON-RPC (`vscode-languageserver-protocol`, `vscode-jsonrpc`) | 3.18.4 / 9.0.3 | MIT | https://github.com/microsoft/vscode-languageserver-node |
| `vscode-ws-jsonrpc` | 4.0.3 | MIT | https://github.com/TypeFox/monaco-languageclient |
| `monaco-languageserver-types` | 0.4.1 | MIT | https://github.com/remcohaszing/monaco-languageserver-types |
| `css-tree` (build-time CSS parser; not bundled at runtime) | 3.2.1 | MIT | https://github.com/csstree/csstree |
| M3E packages (`@kyralabs/m3e-css`, `@kyralabs/m3e-tokens`, `@kyralabs/m3e-elements`) | 1.8.0 | Apache-2.0 | https://github.com/kyra-labs/m3exp-web |
| Google Sans Flex | 5.000, source commit `bd8f81ddb5c74d5c8897b36ad88b440266245103` | SIL Open Font License 1.1 | https://github.com/google/fonts/tree/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/googlesansflex |
| Material Symbols Rounded | locally pinned 11-glyph subset | Apache-2.0 | https://github.com/google/material-design-icons |
| LLVM / clang / clangd (WASM engine and toolchain data) | LLVM 23.1.1 build base | Apache-2.0 WITH LLVM-exception | https://llvm.org/ · https://github.com/llvm/llvm-project |
| Emscripten runtime and generated JavaScript glue | 6.0.9 build base | MIT and University of Illinois/NCSA Open Source License (dual) | https://emscripten.org/ · https://github.com/emscripten-core/emscripten |
| GNU libstdc++ headers (toolchain data packs) | GCC toolchain matching the pack | GPL-3.0-or-later WITH GCC-exception-3.1 | https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html |
| GNU C Library headers (toolchain data packs) | glibc used by the pack | LGPL-2.1-or-later | https://www.gnu.org/software/libc/ |
| Linux UAPI headers (toolchain data packs) | kernel headers used by the pack | GPL-2.0 WITH Linux-syscall-note; some files under BSD-3-Clause or other permissive notices | https://github.com/torvalds/linux/tree/master/include/uapi · https://github.com/torvalds/linux/tree/master/LICENSES |

Original component LICENSE and NOTICE texts are packaged in
`extension/licenses/`; `sources.json` records their source versions and hashes.
Font licenses, trademarks and provenance are in `extension/fonts/` and
`extension/icons/`. The Nushu subset restores the upstream `.notdef` outline
to repair a zero-length glyph table; its exact source and old/new hashes are
documented in `extension/fonts/PROVENANCE.txt`.


## Copyright notices

- Monaco Editor: Copyright (c) 2016 - present Microsoft Corporation. Monaco's
  package also contains `ThirdPartyNotices.txt` for components bundled into
  Monaco itself; that file is retained in `node_modules/monaco-editor/` and in
  upstream distributions.
- VS Code language server node packages: Copyright (c) Microsoft Corporation.
- `vscode-ws-jsonrpc`: Copyright 2018 - present TypeFox GmbH.
- `monaco-languageserver-types`: Copyright © 2023 Remco Haszing.
- Google Sans Flex: Copyright 2015 The Google Sans Flex Authors
  (https://github.com/googlefonts/googlesans-flex).
- LLVM, Emscripten, GNU libstdc++, glibc, and Linux UAPI notices are retained
  with their upstream sources and are reproduced or referenced below.

No additional copyright holder is asserted for any component. If a component's
upstream distribution carries a NOTICE file, that NOTICE is retained with the
upstream package and must be included when redistributing the component.

## MIT License

The following text applies to the MIT-licensed components listed above:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0

The M3E packages and the LLVM project are licensed under the Apache License,
Version 2.0. The full Apache-2.0 text is available at
https://www.apache.org/licenses/LICENSE-2.0 and is included in each upstream
package distribution. The LLVM project adds the LLVM Exceptions; the complete
LLVM license and exception text is at https://llvm.org/LICENSE.txt and in
https://github.com/llvm/llvm-project/blob/main/llvm/LICENSE.TXT.

The LLVM exception permits distributing binaries and headers derived from LLVM
under the Apache-2.0 terms without the exception's additional conditions being
treated as an additional restriction on the combined work. Any data pack that
contains LLVM-derived binaries or headers must carry the LLVM license text and
the upstream NOTICE files.

## SIL Open Font License 1.1

Google Sans Flex is licensed under the SIL Open Font License, Version 1.1.
The complete text is bundled as `extension/fonts/LICENSE-google-sans-flex.txt`,
with the upstream trademark notice alongside it. The font may not be sold by
itself; the license's reserved-name conditions apply to modified versions.

## Emscripten

Emscripten is available under either the MIT license or the University of
Illinois/NCSA Open Source License. The full dual-license text and copyright
notices are at https://github.com/emscripten-core/emscripten/blob/main/LICENSE
and are retained with the Emscripten build inputs.

## GNU libstdc++

The GNU C++ standard library headers distributed in toolchain packs are part of
GCC and are licensed under GPL-3.0-or-later with the GCC Runtime Library
Exception, version 3.1. The exception permits compiling programs that use the
headers and linking them with the runtime library without the resulting
program being covered by the GPL. The license and exception text are available
at https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html and
https://www.gnu.org/licenses/gcc-exception-3.1.html. Data packs must retain the
GCC COPYING3, COPYING.RUNTIME, and applicable NOTICE files.

## GNU C Library

Headers from the GNU C Library are distributed under the GNU Lesser General
Public License, version 2.1 or later. The license text is available at
https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html and is retained with
the glibc source or header package used to build each toolchain data pack.

## Linux UAPI headers

Linux user-space API headers are distributed under GPL-2.0 WITH
Linux-syscall-note, with some individual files carrying BSD-3-Clause or other
permissive notices. The syscall note clarifies that user-space programs using
the UAPI headers are not thereby covered by the GPL. The authoritative notice
files are `COPYING` and `LICENSES/` in
https://github.com/torvalds/linux and must be retained with any redistributed
header tree.

## Distribution requirement

If a future release distributes prebuilt engine binaries, JavaScript glue,
headers, indexes, or toolchain data packs, its release archive must include the
corresponding upstream license and NOTICE files for every component actually
included. This notice file is not a substitute for those per-artifact files.
