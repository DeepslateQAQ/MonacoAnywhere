#!/usr/bin/env node
/*
 * MonacoAnywhere build.
 *
 *   node esbuild.config.mjs              production build (validated)
 *   node esbuild.config.mjs --bootstrap  skeleton/UI inspection only
 *
 * Production validation happens before dist/ is removed. The bootstrap mode is
 * explicit, embeds its mode in every UI surface, and never copies engine/data
 * artifacts or claims language-service readiness.
 */

import { build } from "esbuild";
import { createHash, createPublicKey } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.join(ROOT, "extension");
const DIST_DIR = path.join(ROOT, "dist");
const MANIFEST_SOURCE = path.join(EXTENSION_DIR, "manifest.json");
const ENGINE_DIR = path.join(EXTENSION_DIR, "wasm", "dist");
const CATALOGUE_SOURCE = path.join(EXTENSION_DIR, "src", "data", "catalogue.json");
const EXTENSION_ID_FILE = path.join(ROOT, "extension-id.txt");

const ENGINE_ARTIFACTS = [
  "clangd.wasm",
  "clangd-runtime.mjs",
  "clangd-runtime.data"
];
const OPTIONAL_ENGINE_ARTIFACTS = ["system-indexer"];

const EXPECTED_PERMISSIONS = [
  "offscreen",
  "nativeMessaging",
  "scripting",
  "storage"
];
const EXPECTED_HOST_PERMISSIONS = [
  "https://*.hydro.ac/*",
  "https://*.luogu.com.cn/*",
  "https://*.luogu.org/*",
  "https://atcoder.jp/*",
  "https://codeforces.com/*"
];
const REQUIRED_WAR_RESOURCES = [
  "editor.html",
  "editor.js",
  "editor.css",
  "workers/*",
  "assets/*",
  "fonts/*"
];
const REQUIRED_CSP_TOKENS = [
  "script-src 'self' 'wasm-unsafe-eval'",
  "object-src 'self'",
  "worker-src 'self'",
  "http://127.0.0.1:*",
  "ws://127.0.0.1:*",
  "https://github.com",
  "https://objects.githubusercontent.com",
  "https://gh-proxy.org",
  "https://ghproxy.net"
];
const ALLOWED_MIRROR_HOSTS = new Set([
  "github.com",
  "gh-proxy.org",
  "ghproxy.net"
]);
const HTML_PAGES = [
  "editor.html",
  "onboarding.html",
  "options.html",
  "popup.html",
  "offscreen.html"
];

const EXPECTED_MONACO_VERSION = "0.57.0";
const MONACO_PACKAGE_DIR = path.join(ROOT, "node_modules", "monaco-editor");
const MONACO_WORKER_FILES = {
  "editor.worker": path.join(
    MONACO_PACKAGE_DIR,
    "esm",
    "vs",
    "editor",
    "editor.worker.js"
  ),
  "ts.worker": path.join(
    MONACO_PACKAGE_DIR,
    "esm",
    "vs",
    "language",
    "typescript",
    "ts.worker.js"
  )
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    return false;
  }
  const values = new Set(actual);
  return values.size === expected.length && expected.every((item) => values.has(item));
}

function parseArgs(argv) {
  const unknown = argv.filter((arg) => arg !== "--bootstrap");
  if (unknown.length > 0) {
    fail(`Unknown argument(s): ${unknown.join(" ")}. Use --bootstrap for the skeleton build.`);
  }
  return { bootstrap: argv.includes("--bootstrap") };
}

async function fileInfo(file) {
  try {
    const info = await stat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

async function requireFile(file, label) {
  const info = await fileInfo(file);
  if (!info) {
    fail(`Missing ${label}: ${path.relative(ROOT, file)}`);
  }
  return info;
}

function validateManifest(manifest) {
  assert(manifest && typeof manifest === "object", "manifest.json must contain a JSON object");
  assert(manifest.manifest_version === 3, "manifest_version must be 3");
  assert(manifest.minimum_chrome_version === "137", 'minimum_chrome_version must be "137"');
  assert(
    sameStringSet(manifest.permissions, EXPECTED_PERMISSIONS),
    `permissions must be exactly: ${EXPECTED_PERMISSIONS.join(", ")}`
  );
  assert(
    sameStringSet(manifest.host_permissions, EXPECTED_HOST_PERMISSIONS),
    `host_permissions must be exactly the declared OJ origins: ${EXPECTED_HOST_PERMISSIONS.join(", ")}`
  );
  assert(
    sameStringSet(manifest.optional_host_permissions, ["*://*/*"]),
    'optional_host_permissions must be exactly ["*://*/*"]'
  );
  assert(
    manifest.background?.service_worker === "background.js" &&
      manifest.background?.type === "module",
    "background.service_worker must be background.js with type module"
  );
  assert(manifest.action?.default_popup === "popup.html", "action.default_popup must be popup.html");
  assert(manifest.options_ui?.page === "options.html", "options_ui.page must be options.html");
  assert(
    manifest.content_scripts === undefined,
    "static content_scripts are forbidden; registration is dynamic"
  );

  const csp = manifest.content_security_policy?.extension_pages;
  assert(typeof csp === "string" && csp.length > 0, "extension_pages CSP is required");
  for (const token of REQUIRED_CSP_TOKENS) {
    assert(csp.includes(token), `extension_pages CSP must include: ${token}`);
  }

  assert(Array.isArray(manifest.web_accessible_resources), "web_accessible_resources is required");
  assert(
    manifest.web_accessible_resources.length === 1,
    "expected exactly one web_accessible_resources entry"
  );
  const war = manifest.web_accessible_resources[0];
  assert(war && typeof war === "object", "web_accessible_resources entry must be an object");
  assert(
    Array.isArray(war.matches) &&
      war.matches.length === 1 &&
      war.matches[0] === "<all_urls>",
    'web_accessible_resources matches must be exactly ["<all_urls>"]'
  );
  for (const resource of REQUIRED_WAR_RESOURCES) {
    assert(
      Array.isArray(war.resources) && war.resources.includes(resource),
      `web_accessible_resources must include ${resource}`
    );
  }

  const key = manifest.key;
  assert(typeof key === "string" && key.length > 0, "manifest.key is required (commit the public key)");
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(key), "manifest.key must be unpadded/padded base64 text");
  const keyBytes = Buffer.from(key, "base64");
  assert(keyBytes.length > 0, "manifest.key is not valid base64");
  assert(
    keyBytes.toString("base64").replace(/=+$/, "") === key.replace(/=+$/, ""),
    "manifest.key is not canonical base64"
  );
  let publicKey;
  try {
    publicKey = createPublicKey({ key: keyBytes, format: "der", type: "spki" });
  } catch {
    fail("manifest.key must be a DER-encoded SubjectPublicKeyInfo public key");
  }
  assert(publicKey.asymmetricKeyType === "rsa", "manifest.key must be an RSA public key");
  const modulusLength = publicKey.asymmetricKeyDetails?.modulusLength;
  assert(
    typeof modulusLength === "number" && modulusLength >= 2048,
    "manifest.key must be RSA-2048 or larger"
  );

  const iconEntries = manifest.icons;
  assert(iconEntries && typeof iconEntries === "object", "icons must be declared");
  for (const [size, iconPath] of Object.entries(iconEntries)) {
    assert(
      typeof iconPath === "string" && iconPath.endsWith(".png"),
      `icons[${size}] must point to a PNG`
    );
  }

  return { manifest, keyBytes };
}

function computeExtensionId(keyBytes) {
  const digest = createHash("sha256").update(keyBytes).digest();
  const hex = digest.subarray(0, 16).toString("hex");
  return [...hex]
    .map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16)))
    .join("");
}

async function validateDependencies() {
  const packageFile = path.join(MONACO_PACKAGE_DIR, "package.json");
  await requireFile(packageFile, "monaco-editor package (run pnpm install)");
  const monacoPackage = JSON.parse(await readFile(packageFile, "utf8"));
  assert(
    monacoPackage.version === EXPECTED_MONACO_VERSION,
    `monaco-editor must be ${EXPECTED_MONACO_VERSION}, found ${monacoPackage.version}`
  );
  for (const [name, file] of Object.entries(MONACO_WORKER_FILES)) {
    await requireFile(file, `Monaco worker entry ${name}`);
  }
}

async function validateStaticAssets() {
  for (const page of HTML_PAGES) {
    await requireFile(path.join(EXTENSION_DIR, page), `extension page ${page}`);
  }
  const iconsDir = await stat(path.join(EXTENSION_DIR, "icons")).catch(() => null);
  assert(iconsDir?.isDirectory(), "extension/icons/ is required");
  const manifest = JSON.parse(await readFile(MANIFEST_SOURCE, "utf8"));
  for (const iconPath of Object.values(manifest.icons ?? {})) {
    if (typeof iconPath === "string") {
      await requireFile(path.join(EXTENSION_DIR, iconPath), `manifest icon ${iconPath}`);
    }
  }
}

async function validateEngineAndCatalogue() {
  for (const artifact of ENGINE_ARTIFACTS) {
    await requireFile(path.join(ENGINE_DIR, artifact), `engine artifact ${artifact}`);
  }

  const wasmPath = path.join(ENGINE_DIR, "clangd.wasm");
  const wasmBytes = await readFile(wasmPath);
  assert(wasmBytes.length >= 1024 * 1024, "clangd.wasm is too small to be a real engine build");
  assert(
    wasmBytes[0] === 0x00 &&
      wasmBytes[1] === 0x61 &&
      wasmBytes[2] === 0x73 &&
      wasmBytes[3] === 0x6d,
    "clangd.wasm does not start with the WebAssembly magic bytes"
  );
  const wasmHash = createHash("sha256").update(wasmBytes).digest("hex");

  const runtimePath = path.join(ENGINE_DIR, "clangd-runtime.mjs");
  const runtimeBytes = await readFile(runtimePath);
  assert(runtimeBytes.length >= 1024, "clangd-runtime.mjs is too small to be a real ESM runtime");
  const runtimeText = runtimeBytes.toString("utf8");
  assert(!/^\s*<!doctype html/i.test(runtimeText), "clangd-runtime.mjs looks like an HTML placeholder");
  assert(/\bexport\s*(default|\{)/.test(runtimeText), "clangd-runtime.mjs is not an ES module");

  const dataInfo = await requireFile(
    path.join(ENGINE_DIR, "clangd-runtime.data"),
    "engine artifact clangd-runtime.data"
  );
  assert(
    dataInfo.size >= 1024 * 1024,
    "clangd-runtime.data is too small to contain resource headers"
  );

  for (const artifact of OPTIONAL_ENGINE_ARTIFACTS) {
    const artifactPath = path.join(ENGINE_DIR, artifact);
    const info = await stat(artifactPath).catch(() => null);
    if (info && !info.isFile()) {
      fail(`Optional engine artifact ${artifact} must be a file when present`);
    }
  }

  let catalogue;
  try {
    catalogue = JSON.parse(await readFile(CATALOGUE_SOURCE, "utf8"));
  } catch {
    fail(
      `Production build requires a valid ${path.relative(
        ROOT,
        CATALOGUE_SOURCE
      )} with real pack hashes and sizes`
    );
  }

  assert(
    catalogue && typeof catalogue === "object" && !Array.isArray(catalogue),
    "catalogue must be a JSON object"
  );
  assert(
    catalogue.schema === "monacoanywhere.catalogue/1",
    "catalogue.schema must be monacoanywhere.catalogue/1"
  );
  assert(
    catalogue.engineAbi === "ma-clangd-wasm/1",
    "catalogue.engineAbi must be ma-clangd-wasm/1"
  );
  assert(
    typeof catalogue.engineBuildId === "string" &&
      /^[a-f0-9]{64}$/.test(catalogue.engineBuildId),
    "catalogue.engineBuildId must be a real lowercase SHA-256"
  );
  assert(
    catalogue.engineBuildId === wasmHash,
    "catalogue.engineBuildId does not match the SHA-256 of clangd.wasm"
  );
  assert(
    Array.isArray(catalogue.packs) && catalogue.packs.length > 0,
    "catalogue.packs must be a non-empty array"
  );

  const packIds = new Set();
  for (const pack of catalogue.packs) {
    assert(pack && typeof pack === "object", "each catalogue pack must be an object");
    for (const field of ["id", "version", "asset", "releaseTag"]) {
      assert(
        typeof pack[field] === "string" &&
          pack[field].length > 0 &&
          !/[{<>}]/.test(pack[field]),
        `pack.${field} must be a non-empty concrete string`
      );
    }
    assert(!packIds.has(pack.id), `duplicate catalogue pack id ${pack.id}`);
    packIds.add(pack.id);
    assert(
      /\.tar\.gz$/.test(pack.asset) && !/[/\\]/.test(pack.asset),
      `pack ${pack.id}: asset must be a basename ending in .tar.gz`
    );
    assert(
      Number.isInteger(pack.bytes) && pack.bytes > 0,
      `pack ${pack.id}: bytes must be a positive integer`
    );
    assert(
      typeof pack.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(pack.sha256) &&
        !/^0{64}$/.test(pack.sha256) &&
        !/^(.)\1{63}$/.test(pack.sha256),
      `pack ${pack.id}: sha256 must be a real lowercase SHA-256`
    );
    assert(
      Array.isArray(pack.mirrors) && pack.mirrors.length > 0,
      `pack ${pack.id}: mirrors must be a non-empty array`
    );

    for (const mirror of pack.mirrors) {
      assert(typeof mirror === "string", `pack ${pack.id}: mirror must be a string`);
      const resolved = mirror
        .replaceAll("{tag}", pack.releaseTag)
        .replaceAll("{asset}", pack.asset);
      let url;
      try {
        url = new URL(resolved);
      } catch {
        fail(`pack ${pack.id}: invalid mirror URL ${mirror}`);
      }
      assert(url.protocol === "https:", `pack ${pack.id}: mirror must use https`);
      assert(
        ALLOWED_MIRROR_HOSTS.has(url.hostname),
        `pack ${pack.id}: mirror host ${url.hostname} is not allowlisted`
      );
    }
  }

  return { catalogue, wasmHash };
}

async function copyIfDirectory(source, target) {
  const info = await stat(source).catch(() => null);
  if (info?.isDirectory()) {
    await cp(source, target, { recursive: true });
  }
}

async function writeManifest(manifest, version) {
  const distManifest = { ...manifest, version };
  await writeFile(
    path.join(DIST_DIR, "manifest.json"),
    `${JSON.stringify(distManifest, null, 2)}\n`,
    "utf8"
  );
}

async function runEsbuild({ bootstrap, version }) {
  const define = {
    __MA_BUILD_MODE__: JSON.stringify(bootstrap ? "bootstrap" : "production"),
    __MA_BOOTSTRAP__: String(bootstrap),
    __MA_BUILD_VERSION__: JSON.stringify(version)
  };
  const common = {
    bundle: true,
    platform: "browser",
    target: ["chrome137"],
    logLevel: "info",
    sourcemap: bootstrap ? "linked" : false,
    legalComments: "eof",
    charset: "utf8",
    define,
    loader: {
      ".ttf": "file",
      ".woff": "file",
      ".woff2": "file",
      ".png": "file",
      ".svg": "file"
    },
    assetNames: "assets/[name]-[hash]"
  };

  await build({
    ...common,
    entryPoints: {
      background: path.join(EXTENSION_DIR, "src", "background", "index.ts"),
      editor: path.join(EXTENSION_DIR, "src", "editor", "index.ts"),
      onboarding: path.join(EXTENSION_DIR, "src", "onboarding", "index.ts"),
      options: path.join(EXTENSION_DIR, "src", "options", "index.ts"),
      popup: path.join(EXTENSION_DIR, "src", "popup", "index.ts"),
      offscreen: path.join(EXTENSION_DIR, "src", "offscreen", "index.ts")
    },
    outdir: DIST_DIR,
    entryNames: "[name]",
    format: "esm",
    splitting: false
  });

  await build({
    ...common,
    entryPoints: {
      "content-isolated": path.join(EXTENSION_DIR, "src", "content", "index.ts"),
      "content-main": path.join(EXTENSION_DIR, "src", "page-adapter", "index.ts")
    },
    outdir: DIST_DIR,
    entryNames: "[name]",
    format: "iife",
    splitting: false
  });

  await build({
    ...common,
    entryPoints: Object.entries(MONACO_WORKER_FILES).map(([name, file]) => ({
      in: file,
      out: name
    })),
    outdir: path.join(DIST_DIR, "workers"),
    entryNames: "[name]",
    format: "esm",
    splitting: false
  });

  for (const output of [
    "background.js",
    "editor.js",
    "editor.css",
    "onboarding.js",
    "options.js",
    "popup.js",
    "offscreen.js",
    "content-isolated.js",
    "content-main.js",
    "workers/editor.worker.js",
    "workers/ts.worker.js",
    "manifest.json"
  ]) {
    await requireFile(path.join(DIST_DIR, output), `build output ${output}`);
  }
}

async function main() {
  const { bootstrap } = parseArgs(process.argv.slice(2));
  const mode = bootstrap ? "bootstrap" : "production";

  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const version = packageJson.version;
  assert(typeof version === "string", "package.json version is required");
  assert(
    /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(version),
    "package.json version must be a Chrome-compatible numeric version"
  );
  assert(
    version
      .split(".")
      .every((part) => Number(part) <= 65535),
    "package.json version components must be <= 65535"
  );

  const manifest = JSON.parse(await readFile(MANIFEST_SOURCE, "utf8"));
  const { keyBytes } = validateManifest(manifest);
  const extensionId = computeExtensionId(keyBytes);

  const previousId = await readFile(EXTENSION_ID_FILE, "utf8").catch(() => null);
  if (previousId !== null && previousId.trim() !== extensionId) {
    console.warn(
      `[MonacoAnywhere build] extension-id.txt changes from ${previousId.trim()} to ${extensionId}`
    );
  }
  await writeFile(EXTENSION_ID_FILE, `${extensionId}\n`, "utf8");

  await validateDependencies();
  await validateStaticAssets();

  let engineResult = null;
  if (!bootstrap) {
    engineResult = await validateEngineAndCatalogue();
  }

  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  await writeManifest(manifest, version);
  for (const page of HTML_PAGES) {
    await cp(path.join(EXTENSION_DIR, page), path.join(DIST_DIR, page));
  }
  await cp(path.join(EXTENSION_DIR, "icons"), path.join(DIST_DIR, "icons"), {
    recursive: true
  });
  await copyIfDirectory(path.join(EXTENSION_DIR, "assets"), path.join(DIST_DIR, "assets"));
  await copyIfDirectory(path.join(EXTENSION_DIR, "fonts"), path.join(DIST_DIR, "fonts"));

  for (const file of ["LICENSE", "THIRD-PARTY-NOTICES.md"]) {
    const source = path.join(ROOT, file);
    if (await fileInfo(source)) {
      await cp(source, path.join(DIST_DIR, file));
    }
  }

  if (!bootstrap) {
    const engineTarget = path.join(DIST_DIR, "wasm");
    await mkdir(engineTarget, { recursive: true });
    for (const artifact of ENGINE_ARTIFACTS) {
      await cp(
        path.join(ENGINE_DIR, artifact),
        path.join(engineTarget, artifact)
      );
    }
    for (const artifact of OPTIONAL_ENGINE_ARTIFACTS) {
      const source = path.join(ENGINE_DIR, artifact);
      if (await fileInfo(source)) {
        await cp(source, path.join(engineTarget, artifact));
      }
    }
    const dataTarget = path.join(DIST_DIR, "data");
    await mkdir(dataTarget, { recursive: true });
    await cp(CATALOGUE_SOURCE, path.join(dataTarget, "catalogue.json"));
  }

  await runEsbuild({ bootstrap, version });

  const buildInfo = {
    mode,
    version,
    extensionId,
    engine: bootstrap
      ? {
          available: false,
          reason: "bootstrap build; engine and catalogue are not copied"
        }
      : {
          available: true,
          buildId: engineResult?.catalogue?.engineBuildId,
          packs: engineResult?.catalogue?.packs?.length
        }
  };
  await writeFile(
    path.join(DIST_DIR, "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `[MonacoAnywhere] ${mode} build complete → dist/ (extension ID ${extensionId})`
  );
  if (bootstrap) {
    console.log(
      "[MonacoAnywhere] bootstrap build: language services are unavailable; production remains gated on the real engine and data catalogue."
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[MonacoAnywhere build] ${message}`);
  process.exitCode = 1;
});
