/*
 * Bootstrap MAIN-world entry.
 *
 * This is the only page-world surface added by the extension in this slice. It
 * accepts a tiny, closed message shape and replies with static build status. It
 * cannot execute scripts, read page state, call chrome APIs, or forward
 * arbitrary commands. Editor bridges and page-provided Monaco providers are
 * implemented later, after the engine gate, and must extend the closed enum
 * deliberately rather than adding a generic forwarding channel.
 */

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const INSTALL_FLAG = "__monacoAnywhereMainBridgeV1";
const HELLO_TYPE = "ma/bridge-hello";

interface HelloPayload {
  requestId?: string;
}

function readHelloPayload(value: unknown): HelloPayload | null {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return {};
  }
  if (keys.length !== 1 || keys[0] !== "requestId") {
    return null;
  }
  const requestId = record.requestId;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(requestId)) {
    return null;
  }
  return { requestId };
}

function handleMessage(event: MessageEvent): void {
  if (event.source !== window) {
    return;
  }
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return;
  }
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length < 2 ||
    keys.length > 3 ||
    !keys.every((key) => key === "__ma" || key === "type" || key === "payload") ||
    record.__ma !== 1 ||
    record.type !== HELLO_TYPE
  ) {
    return;
  }

  const payload = readHelloPayload(record.payload);
  if (payload === null) {
    return;
  }

  let serialised: string;
  try {
    serialised = JSON.stringify(data);
  } catch {
    return;
  }
  if (new TextEncoder().encode(serialised).byteLength > MAX_MESSAGE_BYTES) {
    return;
  }

  if (record.type === HELLO_TYPE) {
    const reply = {
      __ma: 1,
      type: "ma/bridge-status",
      payload: {
        protocol: PROTOCOL_VERSION,
        version: __MA_BUILD_VERSION__,
        buildMode: __MA_BUILD_MODE__,
        status: "unavailable",
        reason: "language-service-not-implemented",
        ...(payload.requestId === undefined ? {} : { requestId: payload.requestId })
      }
    };
    window.postMessage(reply, "*");
  }
}

const globalRecord = window as unknown as Record<string, unknown>;
if (globalRecord[INSTALL_FLAG] !== true) {
  Object.defineProperty(window, INSTALL_FLAG, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  window.addEventListener("message", handleMessage);
}
