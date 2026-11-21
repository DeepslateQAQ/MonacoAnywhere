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
| VS Code built-in color themes (Monokai, Solarized, Abyss, Kimbie, Quiet Light, Tomorrow Night Blue, Red, Dark/Light Modern) | `microsoft/vscode@bfbf12b35b9978b92b2d341e81ade49f2b18c68c` | MIT | https://github.com/microsoft/vscode |
| Catppuccin for VS Code color themes | `catppuccin/vscode` `befc9e6fc41980f4241408f7049755d47c06ff45` (catppuccin-vsc-v3.19.0) | MIT | https://github.com/catppuccin/vscode |
| VS Code language server protocol and JSON-RPC (`vscode-languageserver-protocol`, `vscode-jsonrpc`) | 3.18.4 / 9.0.3 | MIT | https://github.com/microsoft/vscode-languageserver-node |
| `vscode-ws-jsonrpc` | 4.0.3 | MIT | https://github.com/TypeFox/monaco-languageclient |
| `monaco-languageserver-types` | 0.4.1 | MIT | https://github.com/remcohaszing/monaco-languageserver-types |
| `css-tree` (build-time CSS parser; not bundled at runtime) | 3.2.1 | MIT | https://github.com/csstree/csstree |
| `github.com/coder/websocket` (native host) | 1.8.14 | MIT | https://github.com/coder/websocket |
| `golang.org/x/sys` (native host) | 0.50.0 | BSD-3-Clause | https://go.googlesource.com/sys |
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
- VS Code built-in theme color data: Copyright (c) Microsoft Corporation.
- Catppuccin for VS Code: Copyright (c) Catppuccin contributors.
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

## BSD 3-Clause License

`golang.org/x/sys` is distributed under the BSD 3-Clause License:

Copyright (c) 2009 The Go Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of Google Inc. nor the names of its contributors may be
   used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

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
