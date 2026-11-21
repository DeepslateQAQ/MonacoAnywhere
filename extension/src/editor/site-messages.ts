/*
 * Strict window-message boundary between the site editor iframe and the
 * ISOLATED-world content script.
 *
 * Only the parent frame may talk to this document, only the closed
 * ContentToEditor set is accepted, and every field is re-validated here
 * instead of trusting the shared shape guard. Nothing is forwarded to chrome
 * APIs, and no page-controlled URL is used.
 */

import {
  SITE_MESSAGE_LIMIT,
  isContentToEditor,
  isEditorSlotInfo,
  isMarkedMessage,
  type EditorToContent,
  type LanguageOptionInfo,
  type SiteContext,
  type SiteId
} from "../shared/site-protocol.js";
import { isRecord } from "../lsp/json.js";
import { isStandard, type Standard } from "../profiles/types.js";

const MAX_OPTION_COUNT = 512;
const MAX_OPTION_ID_LENGTH = 1_024;
const MAX_OPTION_LABEL_LENGTH = 4_096;
const MAX_SELECTOR_LENGTH = 4_096;
const MAX_KEY_PART_LENGTH = 1_024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
// The content script reserves 2 KiB inside the 1 MiB envelope for message
// metadata. Editor text above this budget is never sent.
const SITE_TEXT_LIMIT = SITE_MESSAGE_LIMIT - 2_048;

const SITE_IDS: Record<SiteId, true> = {
  luogu: true,
  atcoder: true,
  codeforces: true,
  hydro: true,
  generic: true
};

const TEXT_ENCODER = new TextEncoder();

export interface ContentMessageHandlers {
  onContext(context: SiteContext): void;
  onNativeText(text: string): void;
  onLanguageOptions(
    optionId: string | null,
    options: LanguageOptionInfo[]
  ): void;
  onLanguageChoice(standard: Standard, options: LanguageOptionInfo[]): void;
  onSiteRemote(state: SiteContext["siteRemote"]): void;
}

function isSiteId(value: unknown): value is SiteId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SITE_IDS, value)
  );
}

/** True when a piece of editor text fits the site-sync text budget. */
export function fitsSiteMessageText(text: string): boolean {
  if (text.length > SITE_TEXT_LIMIT) {
    return false;
  }
  try {
    return TEXT_ENCODER.encode(text).byteLength <= SITE_TEXT_LIMIT;
  } catch {
    return false;
  }
}

function withinSerializedLimit(value: unknown): boolean {
  try {
    const serialised = JSON.stringify(value);
    return (
      typeof serialised === "string" &&
      TEXT_ENCODER.encode(serialised).byteLength <= SITE_MESSAGE_LIMIT
    );
  } catch {
    return false;
  }
}

function isDraftKeyPart(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_KEY_PART_LENGTH &&
    !value.includes("|") &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function isOptionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_OPTION_ID_LENGTH &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function parseLanguageOption(value: unknown): LanguageOptionInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  const { optionId, label, disabled } = value;
  if (
    !isOptionId(optionId) ||
    typeof label !== "string" ||
    label.length > MAX_OPTION_LABEL_LENGTH ||
    typeof disabled !== "boolean"
  ) {
    return null;
  }
  return { optionId, label, disabled };
}

function parseLanguageOptions(value: unknown): LanguageOptionInfo[] | null {
  if (!Array.isArray(value) || value.length > MAX_OPTION_COUNT) {
    return null;
  }
  const options: LanguageOptionInfo[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const option = parseLanguageOption(entry);
    if (!option || seen.has(option.optionId)) {
      return null;
    }
    seen.add(option.optionId);
    options.push(option);
  }
  return options;
}

function parseOptionalOptionId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return isOptionId(value) ? value : undefined;
}

function parseSiteRemote(value: unknown): SiteContext["siteRemote"] | null {
  switch (value) {
    case "none":
    case "active":
    case "suspended":
    case "reload-required":
    case "unsupported":
      return value;
    default:
      return null;
  }
}

function parseSiteContext(value: unknown): SiteContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const { site, originKey, accountScope, problemKey, slot, initialText } =
    value;
  if (
    !isSiteId(site) ||
    !isDraftKeyPart(originKey) ||
    !isDraftKeyPart(accountScope) ||
    !isDraftKeyPart(problemKey) ||
    !isEditorSlotInfo(slot) ||
    !isDraftKeyPart(slot.slotId) ||
    typeof slot.selector !== "string" ||
    slot.selector.trim().length === 0 ||
    slot.selector.length > MAX_SELECTOR_LENGTH ||
    CONTROL_CHARACTERS.test(slot.selector) ||
    typeof initialText !== "string" ||
    !fitsSiteMessageText(initialText)
  ) {
    return null;
  }
  const options = parseLanguageOptions(value.options);
  if (options === null) {
    return null;
  }
  const optionId = parseOptionalOptionId(value.optionId);
  if (optionId === undefined) {
    return null;
  }
  const siteRemote = parseSiteRemote(value.siteRemote);
  if (siteRemote === null) {
    return null;
  }
  return {
    site,
    originKey,
    accountScope,
    problemKey,
    slot: {
      slotId: slot.slotId,
      kind: slot.kind,
      retainedMonaco: slot.retainedMonaco,
      selector: slot.selector
    },
    initialText,
    options,
    optionId,
    siteRemote
  };
}

function parseLanguageOptionsUpdate(
  value: unknown
): { optionId: string | null; options: LanguageOptionInfo[] } | null {
  if (!isRecord(value)) {
    return null;
  }
  const optionId = parseOptionalOptionId(value.optionId);
  if (optionId === undefined) {
    return null;
  }
  const options = parseLanguageOptions(value.options);
  return options === null ? null : { optionId, options };
}

function parseLanguageChoice(
  value: unknown
): { standard: Standard; options: LanguageOptionInfo[] } | null {
  if (!isRecord(value)) {
    return null;
  }
  const standard = value.standard;
  if (typeof standard !== "string" || !isStandard(standard)) {
    return null;
  }
  const options = parseLanguageOptions(value.options);
  return options === null ? null : { standard, options };
}

/**
 * Attach the single message listener. Returns a synchronous unsubscribe.
 *
 * `ma/native-text` is size-checked on its text alone so a normal keystroke
 * does not pay for serialising the whole message; every other message is
 * bounded before its fields are read.
 */
export function listenToContent(
  handlers: ContentMessageHandlers
): () => void {
  const listener = (event: MessageEvent): void => {
    if (event.source !== window.parent) {
      return;
    }
    const data: unknown = event.data;
    if (!isMarkedMessage(data) || !isContentToEditor(data)) {
      return;
    }

    if (data.type === "ma/native-text") {
      if (fitsSiteMessageText(data.text)) {
        handlers.onNativeText(data.text);
      }
      return;
    }

    if (!withinSerializedLimit(data)) {
      return;
    }

    switch (data.type) {
      case "ma/site-context": {
        const context = parseSiteContext(data.context);
        if (context) {
          handlers.onContext(context);
        }
        return;
      }
      case "ma/language-options": {
        const update = parseLanguageOptionsUpdate(data);
        if (update) {
          handlers.onLanguageOptions(update.optionId, update.options);
        }
        return;
      }
      case "ma/language-choice": {
        const choice = parseLanguageChoice(data);
        if (choice) {
          handlers.onLanguageChoice(choice.standard, choice.options);
        }
        return;
      }
      case "ma/site-remote": {
        const state = parseSiteRemote(data.state);
        if (state !== null) {
          handlers.onSiteRemote(state);
        }
        return;
      }
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** Send one validated editor message to the embedding content script. */
export function postEditorMessage(message: EditorToContent): void {
  if (window.parent === window) {
    return;
  }
  // The parent is the OJ page that embeds this extension iframe. Its origin is
  // not known to this document, so "*" targets exactly that one window.
  window.parent.postMessage(message, "*");
}
