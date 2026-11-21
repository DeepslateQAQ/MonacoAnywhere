import { DataError } from "./errors.js";

const encoder = new TextEncoder();

/** Lowercase hexadecimal SHA-256. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new DataError(
      "crypto-unavailable",
      "SHA-256 is unavailable in this environment; refusing to accept unverified data"
    );
  }
  const digest = await subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Reject deliberately fake digests that the build gate also rejects: the
 * all-zero digest and a single hex digit repeated 64 times.
 */
export function isRealSha256Hex(value: unknown): value is string {
  return (
    isSha256Hex(value) &&
    !/^0{64}$/.test(value) &&
    !/^(.)\1{63}$/.test(value)
  );
}

/** Compare two digests without leaking which prefix differs. */
export function equalHexDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
