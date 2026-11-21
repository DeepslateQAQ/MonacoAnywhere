/*
 * Bootstrap offscreen document.
 *
 * The final design owns WASM workers and native WebSocket sessions here. This
 * slice deliberately has no engine glue and no success path: it only answers a
 * closed status request with an explicit unavailable result. It never starts a
 * worker, opens a socket, or claims a backend is ready.
 */

const STATUS_REQUEST = "ma/offscreen-status-request";
const STATUS_RESPONSE = "ma/offscreen-status";

function isStatusRequest(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 2 &&
    keys.every((key) => key === "__ma" || key === "type") &&
    record.__ma === 1 &&
    record.type === STATUS_REQUEST
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isStatusRequest(message)) {
    return false;
  }
  sendResponse({
    __ma: 1,
    type: STATUS_RESPONSE,
    payload: {
      engine: "unavailable",
      buildMode: __MA_BUILD_MODE__,
      reason: "engine-session-not-implemented"
    }
  });
  return false;
});

document.documentElement.dataset.maOffscreen = "status-only";
