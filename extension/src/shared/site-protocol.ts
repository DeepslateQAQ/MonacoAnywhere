import { isRecord } from "../lsp/json.js";

/*
 * Cross-world protocol for site adapters.
 *
 * MAIN world owns site editor instances; ISOLATED content owns the extension
 * iframe and chrome APIs. Every message is JSON, tagged with `__ma: 1`, bounded
 * in size, and validated against this closed set before dispatch.
 */
export const SITE_PROTOCOL_MARKER = 1;
export const SITE_MESSAGE_LIMIT = 1024 * 1024;

export type SiteId = "luogu" | "atcoder" | "codeforces" | "hydro" | "generic";
export type EditorKind =
  | "cm6"
  | "ace"
  | "cm5"
  | "monaco"
  | "textarea";
export type TextOrigin = "user" | "sync";
export type SiteRemoteState =
  | "none"
  | "active"
  | "suspended"
  | "reload-required"
  | "unsupported";

export interface EditorSlotInfo {
  slotId: string;
  kind: EditorKind;
  retainedMonaco: boolean;
  /** Unique selector for the element the overlay should cover. */
  selector: string;
}

export interface LanguageOptionInfo {
  optionId: string;
  label: string;
  disabled: boolean;
}

export type SiteCommand =
  | { kind: "locate" }
  | { kind: "configure-generic"; rule: unknown }
  | { kind: "read"; slotId: string }
  | { kind: "write"; slotId: string; text: string; origin: TextOrigin }
  | { kind: "language-options"; slotId: string }
  | { kind: "read-language"; slotId: string }
  | { kind: "select-language"; slotId: string; optionId: string }
  | { kind: "context"; slotId: string }
  | { kind: "site-remote-status" }
  | { kind: "site-remote-configure"; mode: "site" | "local" }
  | { kind: "subscribe"; slotId: string }
  | { kind: "unsubscribe"; slotId: string };

export interface SiteResultData {
  sites?: EditorSlotInfo[];
  text?: string;
  optionId?: string | null;
  options?: LanguageOptionInfo[];
  originKey?: string;
  accountScope?: string;
  problemKey?: string;
  siteRemote?: SiteRemoteState;
  supported?: boolean;
}

export interface SiteContext {
  site: SiteId;
  originKey: string;
  accountScope: string;
  problemKey: string;
  slot: EditorSlotInfo;
  initialText: string;
  options: LanguageOptionInfo[];
  optionId: string | null;
  siteRemote: SiteRemoteState;
}

export type MainToContent =
  | {
      __ma: 1;
      type: "ma/site-result";
      requestId: number;
      ok: boolean;
      data?: SiteResultData;
      error?: string;
    }
  | {
      __ma: 1;
      type: "ma/site-event";
      event: "native-change" | "language-change";
      slotId: string;
      text?: string;
      origin?: TextOrigin;
      optionId?: string | null;
    };

export type ContentToMain = {
  __ma: 1;
  type: "ma/site-command";
  requestId: number;
  command: SiteCommand;
};

export type EditorToContent =
  | { __ma: 1; type: "ma/editor-ready" }
  | { __ma: 1; type: "ma/editor-change"; text: string }
  | { __ma: 1; type: "ma/editor-language-request"; standard: string }
  | { __ma: 1; type: "ma/editor-language-select"; optionId: string }
  | { __ma: 1; type: "ma/modal-open" }
  | { __ma: 1; type: "ma/modal-close" }
  | { __ma: 1; type: "ma/editor-ready-session" }
  | { __ma: 1; type: "ma/editor-status"; state: string; detail?: string };

export type ContentToEditor =
  | { __ma: 1; type: "ma/site-context"; context: SiteContext }
  | { __ma: 1; type: "ma/native-text"; text: string }
  | {
      __ma: 1;
      type: "ma/language-options";
      optionId: string | null;
      options: LanguageOptionInfo[];
    }
  | {
      __ma: 1;
      type: "ma/language-choice";
      standard: string;
      options: LanguageOptionInfo[];
    }
  | { __ma: 1; type: "ma/site-remote"; state: SiteContext["siteRemote"] };

export function isMarkedMessage(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.__ma === SITE_PROTOCOL_MARKER;
}

export function isEditorToContent(value: unknown): value is EditorToContent {
  if (!isMarkedMessage(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "ma/editor-ready":
    case "ma/editor-ready-session":
      return true;
    case "ma/editor-change":
      return typeof value.text === "string" && value.text.length <= SITE_MESSAGE_LIMIT;
    case "ma/editor-language-request":
      return typeof value.standard === "string";
    case "ma/editor-language-select":
      return typeof value.optionId === "string";
    case "ma/modal-open":
    case "ma/modal-close":
      return true;
    case "ma/editor-status":
      return typeof value.state === "string";
    default:
      return false;
  }
}

export function isEditorSlotInfo(value: unknown): value is EditorSlotInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.slotId === "string" &&
    typeof value.selector === "string" &&
    typeof value.retainedMonaco === "boolean" &&
    ["cm6", "ace", "cm5", "monaco", "textarea"].includes(String(value.kind))
  );
}

export function isContentToMain(value: unknown): value is ContentToMain {
  if (!isMarkedMessage(value) || value.type !== "ma/site-command") return false;
  if (!Number.isInteger(value.requestId) || !isRecord(value.command)) return false;
  const command = value.command;
  switch (command.kind) {
    case "locate":
    case "site-remote-status":
      return true;
    case "configure-generic":
      return isRecord(command.rule);
    case "site-remote-configure":
      return command.mode === "site" || command.mode === "local";
    case "read":
    case "read-language":
    case "context":
    case "subscribe":
    case "unsubscribe":
    case "language-options":
      return typeof command.slotId === "string";
    case "write":
      return (
        typeof command.slotId === "string" &&
        typeof command.text === "string" &&
        command.text.length <= SITE_MESSAGE_LIMIT &&
        (command.origin === "user" || command.origin === "sync")
      );
    case "select-language":
      return (
        typeof command.slotId === "string" &&
        typeof command.optionId === "string"
      );
    default:
      return false;
  }
}

export function isContentToEditor(value: unknown): value is ContentToEditor {
  if (!isMarkedMessage(value) || typeof value.type !== "string") return false;
  if (value.type === "ma/native-text") return typeof value.text === "string";
  if (value.type === "ma/site-remote") {
    return ["none", "active", "suspended", "reload-required", "unsupported"].includes(
      String(value.state)
    );
  }
  if (value.type === "ma/language-options") {
    return Array.isArray(value.options);
  }
  if (value.type === "ma/language-choice") {
    return typeof value.standard === "string" && Array.isArray(value.options);
  }
  if (value.type === "ma/site-context") {
    return isRecord(value.context) && isEditorSlotInfo(value.context.slot);
  }
  return false;
}
