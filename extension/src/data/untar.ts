import { MAX_FILE_BYTES, MAX_UNPACKED_BYTES } from "./catalogue.js";
import { TarError } from "./errors.js";

const BLOCK_SIZE = 512;
const NAME_LENGTH = 100;
const PREFIX_LENGTH = 155;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;

export interface UntarOptions {
  /**
   * When supplied, every regular file must be listed and every directory must
   * be an ancestor of a listed file. Names may include a leading slash.
   */
  allowedFiles?: readonly string[];
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface DecompressOptions {
  maxBytes?: number;
}

type EntryType = "file" | "dir";

function fail(code: string, message: string): never {
  throw new TarError(code, message);
}

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let index = offset; index < offset + BLOCK_SIZE; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function isZeroTail(bytes: Uint8Array, offset: number): boolean {
  for (let index = offset; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function readAsciiField(
  block: Uint8Array,
  start: number,
  length: number,
  field: string
): string {
  let end = start;
  while (end < start + length && block[end] !== 0) end += 1;
  for (let index = end; index < start + length; index += 1) {
    if (block[index] !== 0) {
      fail("malformed-header", `${field} has non-NUL trailing bytes`);
    }
  }
  let text = "";
  for (let index = start; index < end; index += 1) {
    const byte = block[index];
    if (byte === undefined || byte < 0x20 || byte > 0x7e) {
      fail("malformed-header", `${field} must be printable ASCII`);
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

function readOctal(
  block: Uint8Array,
  start: number,
  length: number,
  field: string
): number {
  let begin = start;
  const end = start + length;
  while (begin < end && block[begin] === 0x20) begin += 1;
  let trimmedEnd = end;
  while (
    trimmedEnd > begin &&
    (block[trimmedEnd - 1] === 0 || block[trimmedEnd - 1] === 0x20)
  ) {
    trimmedEnd -= 1;
  }
  let text = "";
  for (let index = begin; index < trimmedEnd; index += 1) {
    const byte = block[index];
    if (byte === undefined || byte < 0x30 || byte > 0x37) {
      fail("malformed-header", `${field} is not an octal number`);
    }
    text += String.fromCharCode(byte);
  }
  if (text === "") return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) {
    fail("malformed-header", `${field} is out of range`);
  }
  return value;
}

function verifyChecksum(block: Uint8Array): void {
  const stored = readOctal(
    block,
    CHECKSUM_OFFSET,
    CHECKSUM_LENGTH,
    "header checksum"
  );
  let unsigned = 0;
  let signed = 0;
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    const byte =
      index >= CHECKSUM_OFFSET && index < CHECKSUM_OFFSET + CHECKSUM_LENGTH
        ? 0x20
        : block[index] ?? 0;
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  if (stored !== unsigned && stored !== signed) {
    fail(
      "checksum-mismatch",
      `header checksum ${stored} does not match ${unsigned}`
    );
  }
}

function canonicalPath(name: string, prefix: string): string {
  let path = prefix.length > 0 ? `${prefix}/${name}` : name;
  // GNU tar commonly prefixes every entry with `./` when the source is `.`.
  // It is not traversal, so canonicalize it away; internal dot segments stay
  // rejected below.
  while (path.startsWith("./")) path = path.slice(2);
  while (path.endsWith("/")) path = path.slice(0, -1);
  if (path.length === 0) return "";
  if (path.startsWith("/")) {
    fail("absolute-path", `archive entry ${path} is absolute`);
  }
  if (path.includes("\\")) {
    fail("unsafe-path", `archive entry ${path} contains a backslash`);
  }
  if (path.includes(":")) {
    fail("unsafe-path", `archive entry ${path} contains a drive/ADS colon`);
  }
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) {
      fail("unsafe-path", `archive entry ${path} is not printable ASCII`);
    }
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      fail("unsafe-path", `archive entry ${path} has an unsafe segment`);
    }
  }
  return path;
}

function normalizeAllowedName(value: string, index: number): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("invalid-allowlist", `allowedFiles[${index}] must be a path`);
  }
  let name = value;
  if (name.startsWith("/")) name = name.slice(1);
  let path = name;
  while (path.endsWith("/")) path = path.slice(0, -1);
  if (path.length === 0 || path.includes("\\")) {
    fail("invalid-allowlist", `allowedFiles[${index}] is invalid`);
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      fail("invalid-allowlist", `allowedFiles[${index}] is unsafe`);
    }
  }
  return path;
}

function directoryIsAllowed(path: string, allowed: ReadonlySet<string>): boolean {
  const prefix = `${path}/`;
  for (const name of allowed) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

function hasExecutableMagic(data: Uint8Array): string | null {
  if (
    data.length >= 4 &&
    data[0] === 0x7f &&
    data[1] === 0x45 &&
    data[2] === 0x4c &&
    data[3] === 0x46
  ) {
    return "ELF";
  }
  if (data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a) {
    return "MZ";
  }
  if (
    data.length >= 4 &&
    data[0] === 0x00 &&
    data[1] === 0x61 &&
    data[2] === 0x73 &&
    data[3] === 0x6d
  ) {
    return "WebAssembly";
  }
  return null;
}

/**
 * Parse an uncompressed USTAR archive. PAX/GNU extensions, links, devices,
 * duplicate entries, unsafe paths and executable payloads are rejected.
 */
export function untar(
  bytes: Uint8Array,
  options: UntarOptions = {}
): Map<string, Uint8Array> {
  if (!(bytes instanceof Uint8Array)) {
    fail("invalid-archive", "tar input must be a Uint8Array");
  }
  if (bytes.byteLength % BLOCK_SIZE !== 0) {
    fail("not-block-aligned", "tar length is not a multiple of 512 bytes");
  }
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_UNPACKED_BYTES;
  let allowed: Set<string> | null = null;
  if (options.allowedFiles !== undefined) {
    allowed = new Set<string>();
    options.allowedFiles.forEach((name, index) => {
      const normalized = normalizeAllowedName(name, index);
      if (allowed?.has(normalized)) {
        fail("invalid-allowlist", `allowedFiles[${index}] is duplicated`);
      }
      allowed?.add(normalized);
    });
  }

  const output = new Map<string, Uint8Array>();
  const entryTypes = new Map<string, EntryType>();
  let totalBytes = 0;
  let offset = 0;
  let sawHeader = false;
  let sawTrailer = false;

  while (offset + BLOCK_SIZE <= bytes.byteLength) {
    if (isZeroBlock(bytes, offset)) {
      if (offset + BLOCK_SIZE * 2 > bytes.byteLength) {
        fail("missing-trailer", "tar has only one end-of-archive block");
      }
      if (!isZeroBlock(bytes, offset + BLOCK_SIZE)) {
        fail("missing-trailer", "tar end-of-archive marker is incomplete");
      }
      if (!isZeroTail(bytes, offset + BLOCK_SIZE * 2)) {
        fail("trailing-data", "tar has non-zero data after its end marker");
      }
      sawTrailer = true;
      break;
    }

    sawHeader = true;
    const block = bytes.subarray(offset, offset + BLOCK_SIZE);
    verifyChecksum(block);
    if (
      readAsciiField(block, 257, 5, "magic") !== "ustar" ||
      block[262] !== 0 ||
      block[263] !== 0x30 ||
      block[264] !== 0x30
    ) {
      fail("not-ustar", "archive is not USTAR (PAX/GNU extensions rejected)");
    }

    // Validate every numeric field so malformed headers cannot slip through.
    readOctal(block, 100, 8, "mode");
    readOctal(block, 108, 8, "uid");
    readOctal(block, 116, 8, "gid");
    readOctal(block, 136, 12, "mtime");
    readOctal(block, 329, 8, "devmajor");
    readOctal(block, 337, 8, "devminor");
    const size = readOctal(block, 124, 12, "size");

    const typeflag = block[156] ?? 0;
    let type: EntryType;
    if (typeflag === 0 || typeflag === 0x30) {
      type = "file";
    } else if (typeflag === 0x35) {
      type = "dir";
      if (size !== 0) fail("malformed-header", "directory entry has data");
    } else if (typeflag === 0x31 || typeflag === 0x32) {
      fail("link-not-allowed", "tar links are not accepted");
    } else if (
      typeflag === 0x33 ||
      typeflag === 0x34 ||
      typeflag === 0x36 ||
      typeflag === 0x37
    ) {
      fail("special-file", "tar devices/special files are not accepted");
    } else if (typeflag === 0x78 || typeflag === 0x67) {
      fail("pax-not-supported", "PAX extended headers are not accepted");
    } else if (typeflag === 0x4c || typeflag === 0x4b) {
      fail("gnu-long-names-not-supported", "GNU long names are not accepted");
    } else {
      fail("unsupported-type", `unsupported tar type flag 0x${typeflag.toString(16)}`);
    }

    const linkname = readAsciiField(block, 157, 100, "linkname");
    if (linkname.length > 0) {
      fail("link-not-allowed", "tar entry carries a link target");
    }
    const name = readAsciiField(block, 0, NAME_LENGTH, "name");
    const prefix = readAsciiField(
      block,
      345,
      PREFIX_LENGTH,
      "prefix"
    );
    const path = canonicalPath(name, prefix);
    if (path === "") {
      if (type !== "dir") {
        fail("unsafe-path", "archive file entry has an empty path");
      }
      // `tar -C stage .` emits a `./` root directory entry; it carries no file
      // and is dropped instead of becoming an empty map key.
      offset += BLOCK_SIZE;
      continue;
    }
    if (entryTypes.has(path)) {
      fail("duplicate-entry", `archive contains ${path} more than once`);
    }
    entryTypes.set(path, type);
    if (allowed) {
      if (type === "file" && !allowed.has(path)) {
        fail("unlisted-file", `archive file ${path} is not in the manifest`);
      }
      if (type === "dir" && !directoryIsAllowed(path, allowed)) {
        fail("unlisted-directory", `archive directory ${path} is not expected`);
      }
    }

    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (type === "file" && size > maxFileBytes) {
      fail(
        "file-too-large",
        `${path} is ${size} bytes, limit is ${maxFileBytes}`
      );
    }
    if (dataEnd > bytes.byteLength) {
      fail("truncated", `archive is truncated inside ${path}`);
    }
    if (type === "file") {
      const data = bytes.subarray(dataStart, dataEnd);
      const magic = hasExecutableMagic(data);
      if (magic) {
        fail(
          "executable-payload",
          `${path} starts with a ${magic} executable signature`
        );
      }
      totalBytes += size;
      if (totalBytes > maxTotalBytes) {
        fail(
          "archive-too-large",
          `uncompressed files exceed ${maxTotalBytes} bytes`
        );
      }
      output.set(`/${path}`, data);
    }
    const padding = size % BLOCK_SIZE;
    const nextOffset =
      dataStart + size + (padding === 0 ? 0 : BLOCK_SIZE - padding);
    if (nextOffset > bytes.byteLength) {
      fail("truncated", `archive padding for ${path} is truncated`);
    }
    offset = nextOffset;
  }

  if (!sawHeader) {
    fail("empty-archive", "tar archive contains no entries");
  }
  if (!sawTrailer) {
    fail("missing-trailer", "tar is missing its end-of-archive marker");
  }

  // A regular file may not also be used as a directory by a later entry.
  for (const [path, type] of entryTypes) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      if (entryTypes.get(ancestor) === "file") {
        fail(
          "path-conflict",
          `${type} ${path} is nested below file ${ancestor}`
        );
      }
    }
  }
  return output;
}

/** Inflate a gzip stream while enforcing the decompressed-size ceiling. */
export async function decompressGzip(
  bytes: Uint8Array,
  options: DecompressOptions = {}
): Promise<Uint8Array> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2) {
    fail("invalid-gzip", "compressed pack must be a gzip stream");
  }
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    fail("invalid-gzip", "pack does not start with the gzip magic bytes");
  }
  if (typeof DecompressionStream !== "function") {
    fail("decompression-unavailable", "this runtime has no gzip decompressor");
  }
  const limit = options.maxBytes ?? MAX_UNPACKED_BYTES;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = source.pipeThrough(
      new DecompressionStream("gzip") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >
    );
  } catch (error) {
    throw new TarError("invalid-gzip", "could not start gzip decompression", {
      cause: error
    });
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value = result.value;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        fail(
          "archive-too-large",
          `decompressed pack exceeds ${limit} bytes`
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof TarError) throw error;
    throw new TarError("invalid-gzip", "gzip decompression failed", {
      cause: error
    });
  }
  const output = new Uint8Array(total);
  let writable = 0;
  for (const chunk of chunks) {
    output.set(chunk, writable);
    writable += chunk.byteLength;
  }
  return output;
}

/** Decompress and strictly parse a .tar.gz toolchain pack. */
export async function extractPackArchive(
  bytes: Uint8Array,
  options: UntarOptions = {}
): Promise<Map<string, Uint8Array>> {
  const tarBytes = await decompressGzip(bytes, {
    maxBytes: options.maxTotalBytes
  });
  return untar(tarBytes, options);
}
