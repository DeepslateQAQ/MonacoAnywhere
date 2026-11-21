/*
 * MAIN-world site bridge host.
 *
 * The ISOLATED content script sends a small, closed command set. This module
 * resolves it against the dedicated site adapter, never exposes chrome APIs,
 * and never forwards arbitrary page calls. Every inbound and outbound message
 * is shape-checked, bounded, and tied to a located slot.
 *
 * Adapter element handles stay in this world. Only scalar slot metadata and a
 * unique CSS selector cross the world boundary, so the content script can cover
 * the same box without receiving live objects from the page.
 */

import {
  isContentToMain,
  SITE_MESSAGE_LIMIT,
  SITE_PROTOCOL_MARKER,
  type ContentToMain,
  type EditorKind,
  type EditorSlotInfo,
  type LanguageOptionInfo,
  type MainToContent,
  type SiteCommand,
  type SiteResultData
} from "../shared/site-protocol.js";
import { detectEditorPage } from "../content/router.js";
import { installHydroClientGate } from "../lsp/hydro-client-gate.js";
import { createAtCoderBridge } from "../sites/atcoder.js";
import { createCodeforcesBridge } from "../sites/codeforces.js";
import {
  createHydroBridge,
  detectHydroSiteRemote
} from "../sites/hydro.js";
import {
  resolveGenericEditor,
  resolveGenericLanguageControl
} from "../sites/generic.js";
import { createLuoguBridge } from "../sites/luogu.js";
import type {
  DedicatedSiteId,
  EditorSlot,
  LanguageOption,
  SiteAdapter,
  SiteId
} from "../sites/types.js";

// The MAIN entry runs at document_start, before Hydro's legacy LSP module.
const hydroLspGate = installHydroClientGate(window);

window.addEventListener("message", (event: MessageEvent) => {
  if (!event.isTrusted || event.source !== window) return;
  const data: unknown = event.data;
  if (!isMarkedHydroDecision(data)) return;
  hydroLspGate.configure(data.mode);
});

function isMarkedHydroDecision(
  value: unknown
): value is { __ma: 1; type: "ma/hydro-lsp-decision"; mode: "site" | "local" } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.__ma === 1 &&
    record.type === "ma/hydro-lsp-decision" &&
    (record.mode === "site" || record.mode === "local")
  );
}
const MAX_SLOT_ID_LENGTH = 256;
const MAX_SELECTOR_LENGTH = 1024;
const MAX_TEXT_LENGTH = SITE_MESSAGE_LIMIT - 2048;
const MAX_OPTIONS = 256;
const MAX_OPTION_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 512;
const MAX_CONTEXT_FIELD_LENGTH = 2048;
const MAX_ERROR_LENGTH = 512;

type SiteRemote = NonNullable<SiteResultData["siteRemote"]>;

interface SlotEntry {
  readonly info: EditorSlotInfo;
  readonly handle: EditorSlot;
  unsubscribe: (() => void) | null;
  /** Temporary attribute selector used when no stable unique CSS path exists. */
  cleanupAttribute: string | null;
}

interface BridgeState {
  adapter: SiteAdapter | null;
  site: SiteId | null;
  slots: Map<string, SlotEntry>;
}

const state: BridgeState = {
  adapter: null,
  site: null,
  slots: new Map()
};

function adapterFor(site: DedicatedSiteId): SiteAdapter {
  switch (site) {
    case "luogu":
      return createLuoguBridge();
    case "atcoder":
      return createAtCoderBridge();
    case "codeforces":
      return createCodeforcesBridge();
    case "hydro":
      return createHydroBridge();
  }
  throw new Error(`No MonacoAnywhere adapter for site: ${site}`);
}

function disposeAdapter(): void {
  dropAllSlots();
  try {
    state.adapter?.destroy?.();
  } catch {
    // Teardown must not block a new adapter or page unload.
  }
  state.adapter = null;
  state.site = null;
}

function currentSiteRemote(site: SiteId): SiteRemote {
  if (site !== "hydro") return "none";
  try {
    const gated = hydroLspGate.status();
    return gated === "none" ? detectHydroSiteRemote(window).state : gated;
  } catch {
    // The deployment may expose a remote provider but hide its bridge. Treat
    // that as a state the editor must not silently compete with.
    return "unsupported";
  }
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_ERROR_LENGTH
    ? text.slice(0, MAX_ERROR_LENGTH)
    : text;
}

function postToPage(message: MainToContent): void {
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  } catch {
    return;
  }
  if (bytes > SITE_MESSAGE_LIMIT) return;
  const origin = location.origin === "null" ? "*" : location.origin;
  window.postMessage(message, origin);
}

function respond(
  requestId: number,
  ok: boolean,
  data?: SiteResultData,
  error?: string
): void {
  const message: Extract<MainToContent, { type: "ma/site-result" }> = {
    __ma: SITE_PROTOCOL_MARKER,
    type: "ma/site-result",
    requestId,
    ok,
    ...(data === undefined ? {} : { data }),
    ...(error === undefined
      ? {}
      : { error: error.slice(0, MAX_ERROR_LENGTH) })
  };
  postToPage(message);
}

function uniqueSelectorFor(
  element: HTMLElement,
  preferred: string,
  slotId: string
): {
  selector: string;
  attribute: string | null;
} {
  const resolvesToElement = (selector: string): boolean => {
    if (selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH) {
      return false;
    }
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  };

  if (resolvesToElement(preferred)) {
    return { selector: preferred, attribute: null };
  }
  if (element.id) {
    const idSelector = `#${CSS.escape(element.id)}`;
    if (resolvesToElement(idSelector)) {
      return { selector: idSelector, attribute: null };
    }
  }

  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.length = 0;
      break;
    }
    const index = Array.prototype.indexOf.call(parent.children, node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    node = parent;
  }
  const structural = parts.join(" > ");
  if (resolvesToElement(structural)) {
    return { selector: structural, attribute: null };
  }

  const token = `ma-slot-${encodeURIComponent(slotId).replaceAll("%", "_")}`;
  element.setAttribute("data-monaco-anywhere-slot", token);
  return {
    selector: `[data-monaco-anywhere-slot="${token}"]`,
    attribute: "data-monaco-anywhere-slot"
  };
}

function dropSlot(slotId: string): void {
  const entry = state.slots.get(slotId);
  if (!entry) return;
  try {
    entry.unsubscribe?.();
  } catch {
    // A site adapter may already be mid-teardown.
  }
  entry.unsubscribe = null;
  if (entry.cleanupAttribute) {
    entry.handle.element.removeAttribute(entry.cleanupAttribute);
  }
  state.slots.delete(slotId);
}

function dropAllSlots(): void {
  for (const slotId of [...state.slots.keys()]) {
    dropSlot(slotId);
  }
}

function slotFor(slotId: string): SlotEntry {
  const entry = state.slots.get(slotId);
  if (!entry) {
    throw new Error("Unknown editor slot; locate the editor again.");
  }
  return entry;
}

function normalizeOptions(options: readonly LanguageOption[]): LanguageOptionInfo[] {
  const result: LanguageOptionInfo[] = [];
  for (const option of options.slice(0, MAX_OPTIONS)) {
    if (
      typeof option.optionId !== "string" ||
      option.optionId.length === 0 ||
      option.optionId.length > MAX_OPTION_ID_LENGTH
    ) {
      continue;
    }
    result.push({
      optionId: option.optionId,
      label:
        typeof option.label === "string"
          ? option.label.slice(0, MAX_LABEL_LENGTH)
          : "",
      disabled: option.disabled === true
    });
  }
  return result;
}

async function handleCommand(
  requestId: number,
  command: SiteCommand
): Promise<void> {
  if (command.kind === "site-remote-configure") {
    const siteRemote = hydroLspGate.configure(command.mode);
    respond(requestId, true, { siteRemote });
    return;
  }

  if (command.kind === "configure-generic") {
    disposeAdapter();
    const resolved = resolveGenericEditor(command.rule, {
      document,
      pageWindow: window
    });
    if (resolved.status !== "ready") {
      respond(
        requestId,
        false,
        undefined,
        `generic-${resolved.reason}`
      );
      return;
    }
    const editorAdapter = resolved.adapter;
    const language = resolveGenericLanguageControl(command.rule, {
      document,
      pageWindow: window
    });
    const control = language.status === "ready" ? language.control : null;
    const slot: EditorSlot = {
      slotId: "generic:0",
      kind: editorAdapter.kind,
      retainedMonaco: false,
      selector: "",
      element: editorAdapter.element
    };
    const wrapper: SiteAdapter = {
      id: "generic",
      locateEditors: () => [slot],
      readNative: () => editorAdapter.read(),
      writeNative: (_slot, text) => editorAdapter.write(text),
      subscribeNative: (_slot, cb) =>
        editorAdapter.subscribe((text) => cb(text, "user")),
      locateLanguageControl: () =>
        control
          ? control.element instanceof HTMLSelectElement
            ? { kind: "select", element: control.element }
            : { kind: "unsupported", reason: "generic-combobox" }
          : null,
      readLanguageOption: () => control?.readOptionId() ?? null,
      selectLanguageOption: (_slot, optionId) =>
        control?.selectOption(optionId) ?? false,
      subscribeLanguage: (_slot, cb) =>
        control?.subscribe((optionId) => {
          if (optionId !== null) cb(optionId, "user");
        }) ?? (() => undefined),
      context: () => ({
        site: "generic",
        originKey: location.origin,
        problemKey: location.pathname,
        accountScope: "anon"
      }),
      originKey: () => location.origin,
      problemKey: () => location.pathname,
      accountScope: () => "anon",
      slotIds: () => [slot.slotId],
      languageOptions: () =>
        (control?.readOptions() ?? []).map((option) => ({
          optionId: option.id,
          label: option.label,
          disabled: option.disabled
        })),
      languageOptionSet: () => ({
        options: (control?.readOptions() ?? []).map((option) => ({
          optionId: option.id,
          label: option.label,
          disabled: option.disabled
        })),
        complete: control !== null
      }),
      languageProfiles: () => ({
        profiles: [],
        unsupported: [],
        unrecognized: []
      }),
      languageIssue: () =>
        control ? null : "This rule has no usable language control.",
      selectLanguageOptionAsync: async (_slot, optionId) =>
        control?.selectOption(optionId) ?? false,
      destroy: () => {
        control?.dispose();
        editorAdapter.dispose();
      }
    };
    state.adapter = wrapper;
    state.site = "generic";
    const positioned = uniqueSelectorFor(
      editorAdapter.element,
      wrapper.locateEditors()[0]?.selector ?? "",
      slot.slotId
    );
    const info: EditorSlotInfo = {
      slotId: slot.slotId,
      kind: slot.kind as EditorKind,
      retainedMonaco: false,
      selector: positioned.selector
    };
    state.slots = new Map([
      [
        slot.slotId,
        {
          info,
          handle: slot,
          unsubscribe: null,
          cleanupAttribute: positioned.attribute
        }
      ]
    ]);
    respond(requestId, true, { sites: [info] });
    return;
  }

  if (command.kind === "locate") {
    const page = detectEditorPage(new URL(location.href), document);
    if (!page) {
      if (state.adapter === null || state.adapter.id !== "generic") {
        disposeAdapter();
        respond(requestId, false, undefined, "not-an-editor-page");
        return;
      }
    } else {
      // Each locate starts from a fresh adapter instance. Adapters keep per-slot
      // native-editor state; recreating here prevents stale handles (and stale
      // editor instances) from accumulating across SPA renders and retries.
      disposeAdapter();
      const adapter: SiteAdapter = adapterFor(page.site);
      state.adapter = adapter;
      state.site = page.site;
    }
    const adapter = state.adapter;
    if (adapter === null) {
      respond(requestId, false, undefined, "adapter-unavailable");
      return;
    }

    let located: EditorSlot[];
    try {
      located = adapter.locateEditors();
    } catch (error) {
      disposeAdapter();
      respond(requestId, false, undefined, errorMessage(error));
      return;
    }

    const seen = new Set<string>();
    const slots: EditorSlotInfo[] = [];
    const nextHandles = new Map<
      string,
      { handle: EditorSlot; info: EditorSlotInfo; attribute: string | null }
    >();
    for (const handle of located) {
      if (slots.length >= 8) break;
      const slotId = handle.slotId;
      if (
        typeof slotId !== "string" ||
        slotId.length === 0 ||
        slotId.length > MAX_SLOT_ID_LENGTH ||
        seen.has(slotId)
      ) {
        continue;
      }
      seen.add(slotId);
      const { selector, attribute } = uniqueSelectorFor(
        handle.element,
        handle.selector ?? "",
        slotId
      );
      const info: EditorSlotInfo = {
        slotId,
        kind: handle.kind as EditorKind,
        retainedMonaco: handle.retainedMonaco === true,
        selector
      };
      slots.push(info);
      nextHandles.set(slotId, { handle, info, attribute });
    }

    const fresh = new Map<string, SlotEntry>();
    for (const [slotId, { handle, info, attribute }] of nextHandles) {
      fresh.set(slotId, {
        info,
        handle,
        unsubscribe: null,
        cleanupAttribute: attribute
      });
    }
    state.slots = fresh;
    respond(requestId, true, { sites: slots });
    return;
  }

  if (command.kind === "site-remote-status") {
    const site = state.site;
    if (!site) {
      respond(requestId, true, { siteRemote: hydroLspGate.status() });
      return;
    }
    respond(requestId, true, { siteRemote: currentSiteRemote(site) });
    return;
  }

  if (state.site === null || state.adapter === null) {
    respond(requestId, false, undefined, "adapter-unavailable");
    return;
  }
  const adapter = state.adapter;

  switch (command.kind) {
    case "read": {
      const entry = slotFor(command.slotId);
      const text = adapter.readNative(entry.handle);
      if (
        typeof text !== "string" ||
        new TextEncoder().encode(text).byteLength > MAX_TEXT_LENGTH
      ) {
        respond(requestId, false, undefined, "editor-text-too-large");
        return;
      }
      respond(requestId, true, { text });
      return;
    }
    case "write": {
      if (command.text.length > MAX_TEXT_LENGTH) {
        respond(requestId, false, undefined, "editor-text-too-large");
        return;
      }
      const entry = slotFor(command.slotId);
      adapter.writeNative(entry.handle, command.text, command.origin);
      respond(requestId, true, {});
      return;
    }
    case "language-options": {
      const entry = slotFor(command.slotId);
      const control = adapter.locateLanguageControl(entry.handle);
      const options = normalizeOptions(adapter.languageOptions(entry.handle));
      respond(requestId, true, {
        options,
        supported: control !== null && control.kind !== "unsupported"
      });
      return;
    }
    case "read-language": {
      const entry = slotFor(command.slotId);
      const optionId = adapter.readLanguageOption(entry.handle);
      respond(requestId, true, {
        optionId:
          typeof optionId === "string" &&
          optionId.length > 0 &&
          optionId.length <= MAX_OPTION_ID_LENGTH
            ? optionId
            : null
      });
      return;
    }
    case "select-language": {
      if (
        command.optionId.length === 0 ||
        command.optionId.length > MAX_OPTION_ID_LENGTH
      ) {
        respond(requestId, false, undefined, "invalid-option-id");
        return;
      }
      const entry = slotFor(command.slotId);
      const applied = await adapter.selectLanguageOptionAsync(
        entry.handle,
        command.optionId
      );
      if (!applied) {
        respond(requestId, false, undefined, "language-selection-not-applied");
        return;
      }
      respond(requestId, true, { optionId: command.optionId });
      return;
    }
    case "context": {
      slotFor(command.slotId);
      const originKey = adapter.originKey();
      const problemKey = adapter.problemKey();
      const accountScope = adapter.accountScope();
      for (const value of [originKey, problemKey, accountScope]) {
        if (
          typeof value !== "string" ||
          value.length > MAX_CONTEXT_FIELD_LENGTH
        ) {
          respond(requestId, false, undefined, "invalid-site-context");
          return;
        }
      }
      const site = state.site;
      if (!site) {
        respond(requestId, false, undefined, "adapter-unavailable");
        return;
      }
      respond(requestId, true, {
        originKey,
        problemKey,
        accountScope,
        siteRemote: currentSiteRemote(site)
      });
      return;
    }
    case "subscribe": {
      const slotId = command.slotId;
      const entry = slotFor(slotId);
      entry.unsubscribe?.();
      entry.unsubscribe = null;
      const unsubscribeNative = adapter.subscribeNative(entry.handle, (text, origin) => {
        if (origin === "sync") return;
        if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) return;
        postToPage({
          __ma: 1,
          type: "ma/site-event",
          event: "native-change",
          slotId,
          text,
          origin
        });
      });
      let unsubscribeLanguage: () => void;
      try {
        unsubscribeLanguage = adapter.subscribeLanguage(
          entry.handle,
          (optionId, origin) => {
            if (origin === "sync") return;
            if (
              typeof optionId !== "string" ||
              optionId.length === 0 ||
              optionId.length > MAX_OPTION_ID_LENGTH
            ) {
              return;
            }
            postToPage({
              __ma: 1,
              type: "ma/site-event",
              event: "language-change",
              slotId,
              optionId
            });
          }
        );
      } catch {
        // A missing/unusable language control must not disable native text
        // mirroring, which is the primary editing path.
        unsubscribeLanguage = () => undefined;
      }
      entry.unsubscribe = () => {
        unsubscribeNative();
        unsubscribeLanguage();
      };
      respond(requestId, true, {});
      return;
    }
    case "unsubscribe": {
      dropSlot(command.slotId);
      respond(requestId, true, {});
      return;
    }
    default:
      respond(requestId, false, undefined, "unsupported-command");
  }
}

function onWindowMessage(event: MessageEvent): void {
  if (!event.isTrusted) return;
  if (event.source !== window) return;
  const data: unknown = event.data;
  if (!isContentToMain(data)) return;
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  } catch {
    return;
  }
  if (bytes > SITE_MESSAGE_LIMIT) return;
  const message = data as ContentToMain;
  if (!Number.isSafeInteger(message.requestId) || message.requestId < 0) {
    return;
  }
  void handleCommand(message.requestId, message.command).catch((error: unknown) => {
    respond(message.requestId, false, undefined, errorMessage(error));
  });
}

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("message", onWindowMessage);
  window.addEventListener("pagehide", () => {
    disposeAdapter();
  });
}

install();
window.postMessage({ __ma: 1, type: "ma/hydro-lsp-ready" }, location.origin);
