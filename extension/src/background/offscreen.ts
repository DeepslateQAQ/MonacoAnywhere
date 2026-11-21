import type {
  OffscreenIncoming,
  OffscreenOutgoing
} from "../offscreen/protocol.js";

const OFFSCREEN_PATH = "offscreen.html";

type OffscreenListener = (message: OffscreenOutgoing) => void;

let port: chrome.runtime.Port | null = null;
let connecting: Promise<chrome.runtime.Port> | null = null;
const listeners = new Set<OffscreenListener>();

async function documentExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureDocument(): Promise<void> {
  if (await documentExists()) {
    // A service-worker restart or an extension reload can leave an offscreen
    // document whose ports belong to the previous extension context. Recreate
    // it instead of connecting to listeners that can no longer answer.
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["WORKERS" as chrome.offscreen.Reason],
    justification: "C++ language services run in dedicated workers and sockets"
  });
}

function attach(candidate: chrome.runtime.Port): chrome.runtime.Port {
  port = candidate;
  candidate.onMessage.addListener((message: OffscreenOutgoing) => {
    if (typeof message !== "object" || message === null) return;
    for (const listener of listeners) listener(message);
  });
  candidate.onDisconnect.addListener(() => {
    if (port === candidate) port = null;
  });
  return candidate;
}

export async function connectOffscreen(): Promise<chrome.runtime.Port> {
  if (port) return port;
  if (connecting) return connecting;
  connecting = (async () => {
    await ensureDocument();
    const candidate = chrome.runtime.connect({ name: "ma-offscreen" });
    return attach(candidate);
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function sendOffscreen(message: OffscreenIncoming): Promise<void> {
  const connected = await connectOffscreen();
  connected.postMessage(message);
}

export function onOffscreenMessage(listener: OffscreenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
