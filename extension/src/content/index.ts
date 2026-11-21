/*
 * ISOLATED-world content router and overlay orchestrator.
 *
 * Flow: detect a dedicated editor surface from the URL -> ask the MAIN-world
 * adapter to locate a slot -> mount the extension iframe over that slot ->
 * exchange the strict site protocol -> mirror native edits and language
 * changes. The original editor is hidden only after a slot is located and the
 * iframe is mounted; every teardown path restores it.
 *
 * SPA navigation is observed by polling the URL, because page calls to
 * history.pushState are not visible to an isolated world. A route change tears
 * the overlay down before it is mounted again for the new route.
 */

import {
  getSettings,
  subscribeSettings,
  updateSettings,
  type Settings
} from "../background/state.js";
import {
  isEditorSlotInfo,
  isMarkedMessage,
  SITE_MESSAGE_LIMIT,
  type ContentToEditor,
  type EditorSlotInfo,
  type SiteCommand,
  type SiteContext,
  type SiteResultData
} from "../shared/site-protocol.js";
import { isEditorToContent } from "../shared/site-protocol.js";
import {
  LanguageSync,
  normalizeCurrentOptionId,
  normalizeLanguageOptions,
  type LanguageSyncChannel
} from "./language-sync.js";
import {
  mountOverlay,
  selectorHasBox,
  type OverlayMount
} from "./mount.js";
import {
  detectEditorPage,
  detectSite,
  isSettingsOriginKey,
  routeKey,
  type EditorPage
} from "./router.js";
import {
  createRuleFromPickerSelection,
  defaultPickerStrings,
  installGenericPickerShortcut,
  openGenericPicker,
  type GenericPickerSelection
} from "./picker.js";
import {
  parseRule,
  ruleMatchesLocation,
  type GenericRule
} from "./rules.js";
import { siteOriginKey } from "../sites/types.js";
import { applyEditorThemeAccent } from "../ui/editor-accent.js";
import { Snackbar } from "../ui/snackbar.js";
import themeCss from "../ui/theme.css?inline";

const BANNER_HOST_ID = "monacoanywhere-content-status";
const GENERIC_RULES_KEY = "genericRules:v1";
const ROUTE_POLL_MS = 500;
const CONTEXT_POLL_MS = 1_500;
const LOCATE_RETRY_MS = 350;
const LOCATE_MAX_ATTEMPTS = 20;
const BRIDGE_TIMEOUT_LIMIT = 4;
const REQUEST_TIMEOUT_MS = 2_500;
const SELECT_TIMEOUT_MS = 5_000;
const IFRAME_READY_TIMEOUT_MS = 12_000;
const MAX_SLOT_ID_LENGTH = 256;
const MAX_OPTION_ID_LENGTH = 512;
const MAX_CONTEXT_FIELD_LENGTH = 2_048;
const MAX_CONTEXT_KEY_LENGTH = 1_024;
const MAX_TEXT_LENGTH = SITE_MESSAGE_LIMIT - 2_048;
const MAX_PENDING_EDITOR_MESSAGES = 32;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const prefersChinese = navigator.language.toLowerCase().startsWith("zh");

function copy(english: string, chinese: string): string {
  return prefersChinese ? chinese : english;
}

const COPY = {
  pageTitle: copy(
    "MonacoAnywhere editor",
    "MonacoAnywhere 编辑器"
  ),
  setupIncomplete: copy(
    "Setup isn't complete yet. Editing and submitting still work; finish setup to enable C++ language services.",
    "设置尚未完成。编辑与提交不受影响，完成设置即可启用 C++ 语言服务。"
  ),
  setupFailed: copy(
    "Couldn't open setup. Try opening it from the extension popup.",
    "无法打开设置页，请从扩展弹出窗口重试。"
  ),
  siteRemoteActive: copy(
    "This site provides its own language service. Choose WASM or Local clangd to switch this page to MonacoAnywhere.",
    "该站点自带远程语言服务。选择 WASM 或本机 clangd，即可在当前页面禁用 Hydro LSP 并改用 MonacoAnywhere。"
  ),
  siteRemoteUnsupported: copy(
    "Couldn't safely pause this page's Hydro LSP. Keeping the site editor to avoid conflicts.",
    "无法安全暂停此页面的 Hydro LSP。已保留站点原编辑器，以避免服务冲突。"
  ),
  siteRemoteReload: copy(
    "Save your code, then reload the page to switch backends.",
    "请先保存代码，再刷新页面以启用所选后端。"
  ),
  siteBackendRequired: copy(
    "Choose WASM or Local clangd to use MonacoAnywhere on this Hydro page, or keep the site editor.",
    "请选择 WASM 或本机 clangd 以在此 Hydro 页面使用 MonacoAnywhere，或继续使用站点编辑器。"
  ),
  reload: copy(
    "Reload after saving",
    "保存后刷新"
  ),
  noSlot: copy(
    "Couldn't find the site editor on this page. Leaving the page unchanged.",
    "未在当前页面找到站点编辑器，页面未作改动。"
  ),
  selectorFailed: copy(
    "Found the site editor, but couldn't match its container uniquely. Leaving the page unchanged.",
    "已找到站点编辑器，但无法唯一定位其区域，页面未作改动。"
  ),
  bridgeUnreachable: copy(
    "Couldn't connect to the page adapter. Retry or reload the page.",
    "无法连接页面适配器，请重试或刷新页面。"
  ),
  adapterUnavailable: copy(
    "No MonacoAnywhere adapter is available for this page.",
    "当前页面没有可用的 MonacoAnywhere 适配器。"
  ),
  iframeTimeout: copy(
    "MonacoAnywhere editor timed out while loading. Restored the site editor.",
    "MonacoAnywhere 编辑器加载超时，已恢复站点原编辑器。"
  ),
  invalidContext: copy(
    "Couldn't identify this editor for local drafts. Leaving the site editor unchanged.",
    "无法识别此编辑器的草稿标识，已保留站点原编辑器。"
  ),
  textTooLarge: copy(
    "The code in the site editor is too large to mirror safely. Leaving the site editor unchanged.",
    "站点编辑器中的代码过大，已保留站点原编辑器。"
  ),
  settingsError: copy(
    "Couldn't read extension settings. Editing still works.",
    "无法读取扩展设置，编辑不受影响。"
  ),
  syncWriteError: copy(
    "Couldn't sync edits to the site editor: {detail}",
    "无法将更改同步到站点编辑器：{detail}"
  ),
  noStandard: copy(
    "This site doesn't have a {standard} option.",
    "该站点没有 {standard} 选项，未更改语言。"
  ),
  languageError: copy(
    "Language control error: {detail}",
    "语言控件出错：{detail}"
  ),
  languageUnsupported: copy(
    "Couldn't control the site's language selector. Switch languages directly on the page instead.",
    "无法操作站点语言控件，请在页面上手动切换语言。"
  ),
  subscribeFailed: copy(
    "External changes in the site editor won't sync automatically: {detail}",
    "站点编辑器的外部变动将无法自动同步：{detail}"
  ),
  editorPostFailed: copy(
    "Couldn't send a message to the MonacoAnywhere editor.",
    "无法向 MonacoAnywhere 编辑器发送消息。"
  ),
  finishSetup: copy(
    "Finish setup",
    "完成设置"
  ),
  chooseBackend: copy(
    "Choose backend",
    "选择后端"
  ),
  useWasm: "WASM clangd",
  useNative: copy(
    "Local clangd",
    "本机 clangd"
  ),
  useSite: copy(
    "Keep site service",
    "保留站点服务"
  ),
  retry: copy(
    "Retry",
    "重试"
  ),
  dismiss: copy(
    "Dismiss",
    "关闭"
  ),
  dismissAria: copy(
    "Dismiss status message",
    "关闭状态提示"
  ),
  title: "MonacoAnywhere",
} as const;

function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    values[key] === undefined ? match : values[key]!
  );
}

function bridgeDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

function readStringField(
  data: SiteResultData,
  key: "originKey" | "accountScope" | "problemKey"
): string | null {
  const value = data[key];
  if (
    typeof value !== "string" ||
    value.length > MAX_CONTEXT_FIELD_LENGTH
  ) {
    return null;
  }
  return value;
}

function readSiteRemote(
  data: SiteResultData
): SiteContext["siteRemote"] {
  switch (data.siteRemote) {
    case "none":
    case "active":
    case "suspended":
    case "reload-required":
    case "unsupported":
      return data.siteRemote;
    default:
      return "unsupported";
  }
}

/**
 * The editor iframe independently validates context keys as draft-key parts:
 * non-empty, bounded, without separators or control characters. Reject here so
 * a bad adapter value surfaces as a banner instead of a silently ignored
 * context that leaves the overlay blank.
 */
function isSiteKeyPart(value: string | null): value is string {
  return (
    value !== null &&
    value.trim().length > 0 &&
    value.length <= MAX_CONTEXT_KEY_LENGTH &&
    !value.includes("|") &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function fitsSiteText(text: string): boolean {
  return (
    text.length <= MAX_TEXT_LENGTH &&
    new TextEncoder().encode(text).byteLength <= MAX_TEXT_LENGTH
  );
}

function readExtensionOrigin(): string {
  const url = chrome.runtime.getURL("");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "chrome-extension:"
      ? `${parsed.protocol}//${parsed.host}`
      : parsed.origin;
  } catch {
    return url.replace(/\/$/, "");
  }
}

interface BannerModel {
  readonly setupIncomplete: boolean;
  readonly siteRemoteWarning: string | null;
  readonly siteOrigin: string | null;
  readonly error: string | null;
  readonly canRetry: boolean;
  readonly reloadRequired: boolean;
}

interface BannerActions {
  openSetup(onFailure: () => void): void;
  retry(): void;
  chooseSite(kind: "wasm" | "native" | "site"): void;
  reload(): void;
}

class StatusBanner {
  private readonly host = document.createElement("div");
  readonly root = document.createElement("div");
  private card: HTMLDivElement | null = null;
  private currentSignature = "";
  private dismissedSignature = "";
  private renderedSignature = "";
  private readonly actions: BannerActions;

  constructor(actions: BannerActions) {
    this.actions = actions;
    this.host.id = BANNER_HOST_ID;
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${themeCss}
      :host { all: initial; }
      :where(.ma-ui).ma-content-notifications {
        position: fixed;
        inset-inline-end: 16px;
        inset-block-start: 16px;
        z-index: 2147483647;
        display: grid;
        gap: 16px;
        max-inline-size: min(420px, calc(100vw - 32px));
        pointer-events: none;
      }
      :where(.ma-ui) .ma-content-banner {
        display: grid;
        gap: 12px;
        padding: 16px;
        pointer-events: auto;
      }
      :where(.ma-ui) .ma-content-banner__text { overflow-wrap: anywhere; }
      :where(.ma-ui) .ma-content-banner__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      :where(.ma-ui) .m3e-snackbar-host:empty { display: none; }
    `;
    this.root.className = "ma-ui ma-content-notifications";
    shadow.append(style, this.root);
  }

  mount(): void {
    if (!this.host.isConnected) {
      (document.body ?? document.documentElement).append(this.host);
    }
  }

  setTheme(settings: Pick<Settings, "theme" | "editorTheme">): void {
    if (settings.theme === "system") {
      delete this.root.dataset.theme;
    } else {
      this.root.dataset.theme = settings.theme;
    }
    applyEditorThemeAccent(this.root, settings.editorTheme);
  }

  update(model: BannerModel): void {
    const hasContent =
      model.setupIncomplete ||
      model.siteRemoteWarning !== null ||
      model.error !== null;
    if (!hasContent) {
      this.dismissedSignature = "";
      this.hide();
      return;
    }
    const signature = JSON.stringify(model);
    this.currentSignature = signature;
    if (signature === this.dismissedSignature) {
      this.hide();
      return;
    }
    if (signature === this.renderedSignature && this.card !== null) {
      return;
    }
    this.render(model);
    this.renderedSignature = signature;
  }

  hide(): void {
    this.card?.remove();
    this.card = null;
    this.renderedSignature = "";
  }

  private dismiss(): void {
    this.dismissedSignature = this.currentSignature;
    this.hide();
  }

  private render(model: BannerModel): void {
    this.hide();
    this.mount();
    const banner = document.createElement("div");
    banner.className = "m3e-card m3e-card--elevated ma-content-banner";
    banner.setAttribute("role", "status");

    const title = document.createElement("h3");
    title.textContent = COPY.title;

    const messages = document.createElement("div");
    messages.className = "ma-content-banner__text";
    const lines = [
      model.error,
      model.siteRemoteWarning,
      model.setupIncomplete ? COPY.setupIncomplete : null
    ].filter((line): line is string => typeof line === "string" && line !== "");
    messages.textContent = lines.join(" ");

    const actions = document.createElement("div");
    actions.className = "ma-content-banner__actions";

    if (model.setupIncomplete) {
      const setup = document.createElement("button");
      setup.type = "button";
      setup.className = "m3e-button m3e-button--filled m3e-button--size-s";
      setup.textContent = COPY.finishSetup;
      setup.addEventListener("click", () => {
        setup.disabled = true;
        this.actions.openSetup(() => {
          setup.disabled = false;
        });
      });
      actions.append(setup);
    } else if (model.reloadRequired) {
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "m3e-button m3e-button--filled m3e-button--size-s";
      reload.textContent = COPY.reload;
      reload.addEventListener("click", () => this.actions.reload());
      actions.append(reload);
    } else if (model.siteRemoteWarning !== null) {
      const disabledForUnsupported =
        model.siteRemoteWarning === COPY.siteRemoteUnsupported;
      for (const [kind, label] of [
        ["wasm", COPY.useWasm],
        ["native", COPY.useNative],
        ["site", COPY.useSite]
      ] as const) {
        if (disabledForUnsupported && kind !== "site") continue;
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = `m3e-button m3e-button--size-s m3e-button--${kind === "site" ? "outlined" : "filled"}`;
        choose.textContent = label;
        choose.addEventListener("click", () => {
          choose.disabled = true;
          this.actions.chooseSite(kind);
        });
        actions.append(choose);
      }
    }

    if (model.canRetry) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "m3e-button m3e-button--outlined m3e-button--size-s";
      retry.textContent = COPY.retry;
      retry.addEventListener("click", () => {
        retry.disabled = true;
        this.actions.retry();
      });
      actions.append(retry);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "m3e-button m3e-button--text m3e-button--size-s";
    close.textContent = COPY.dismiss;
    close.setAttribute("aria-label", COPY.dismissAria);
    close.addEventListener("click", () => this.dismiss());
    actions.append(close);

    banner.append(title, messages, actions);
    this.root.prepend(banner);
    this.card = banner;
  }
}

class BridgeTimeoutError extends Error {
  constructor() {
    super("The page adapter did not respond in time.");
    this.name = "BridgeTimeoutError";
  }
}

interface PendingRequest {
  resolve(data: SiteResultData): void;
  reject(error: Error): void;
  timer: number;
}

type BridgeEvent =
  | {
      event: "native-change";
      slotId: string;
      text: string;
      origin: "user" | "sync";
    }
  | {
      event: "language-change";
      slotId: string;
      optionId: string | null;
    };

/** Strict JSON command channel to the MAIN-world adapter host. */
class PageBridge {
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;
  private readonly onEvent: (event: BridgeEvent) => void;

  constructor(onEvent: (event: BridgeEvent) => void) {
    this.onEvent = onEvent;
    window.addEventListener("message", this.onMessage);
  }

  request(
    command: SiteCommand,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<SiteResultData> {
    if (this.disposed) {
      return Promise.reject(new Error("The page adapter channel is closed."));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId = (this.nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
    const message = {
      __ma: 1 as const,
      type: "ma/site-command" as const,
      requestId,
      command
    };
    let serialised: string;
    try {
      serialised = JSON.stringify(message);
    } catch {
      return Promise.reject(new Error("The site command is not serializable."));
    }
    if (new TextEncoder().encode(serialised).byteLength > SITE_MESSAGE_LIMIT) {
      return Promise.reject(new Error("The site command is too large."));
    }

    const { promise, resolve, reject } = Promise.withResolvers<SiteResultData>();
    const timer = window.setTimeout(() => {
      this.pending.delete(requestId);
      reject(new BridgeTimeoutError());
    }, timeoutMs);
    this.pending.set(requestId, { resolve, reject, timer });
    const origin = location.origin === "null" ? "*" : location.origin;
    window.postMessage(message, origin);
    return promise;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("message", this.onMessage);
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timer);
      request.reject(new Error("The page adapter channel was closed."));
    }
    this.pending.clear();
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (!event.isTrusted) return;
    if (event.source !== window) return;
    const data: unknown = event.data;
    if (!isMarkedMessage(data) || typeof data.type !== "string") return;

    if (data.type === "ma/site-result") {
      const requestId =
        typeof data.requestId === "number" ? data.requestId : Number.NaN;
      if (!Number.isSafeInteger(requestId)) return;
      const request = this.pending.get(requestId);
      if (!request) return;
      this.pending.delete(requestId);
      window.clearTimeout(request.timer);
      if (data.ok !== true) {
        const text =
          typeof data.error === "string" && data.error.length > 0
            ? data.error.slice(0, 512)
            : "The site command failed.";
        request.reject(new Error(text));
        return;
      }
      const result = data.data;
      if (
        result !== undefined &&
        (typeof result !== "object" || result === null || Array.isArray(result))
      ) {
        request.reject(new Error("The site adapter returned a malformed result."));
        return;
      }
      request.resolve((result as SiteResultData | undefined) ?? {});
      return;
    }

    if (data.type === "ma/site-event") {
      const slotId = data.slotId;
      if (
        typeof slotId !== "string" ||
        slotId.length === 0 ||
        slotId.length > MAX_SLOT_ID_LENGTH
      ) {
        return;
      }
      if (data.event === "native-change") {
        if (
          typeof data.text !== "string" ||
          data.text.length > MAX_TEXT_LENGTH
        ) {
          return;
        }
        const origin = data.origin === "sync" ? "sync" : "user";
        this.onEvent({
          event: "native-change",
          slotId,
          text: data.text,
          origin
        });
        return;
      }
      if (data.event === "language-change") {
        const optionId =
          typeof data.optionId === "string" &&
          data.optionId.length > 0 &&
          data.optionId.length <= MAX_OPTION_ID_LENGTH
            ? data.optionId
            : null;
        this.onEvent({ event: "language-change", slotId, optionId });
      }
    }
  };
}

class ContentController {
  private readonly bridge = new PageBridge((event) => this.handleSiteEvent(event));
  private readonly banner = new StatusBanner({
    openSetup: (onFailure) => this.openSetup(onFailure),
    retry: () => this.retryMount(),
    reload: () => location.reload(),
    chooseSite: (kind) => {
      void this.chooseSiteBackend(kind);
    }
  });
  private readonly snackbar = new Snackbar(this.banner.root);
  private readonly extensionOrigin = readExtensionOrigin();

  private page: EditorPage | null = null;
  private mount: OverlayMount | null = null;
  private slot: EditorSlotInfo | null = null;
  private context: SiteContext | null = null;
  private language: LanguageSync | null = null;
  private editorReady = false;
  private lastReadyAt = 0;
  private pendingEditorMessages: ContentToEditor[] = [];

  private settings: Settings | null = null;
  private settingsError: string | null = null;
  private error: string | null = null;
  private canRetry = false;

  private generation = 0;
  private locating = false;
  private locateAttempts = 0;
  private bridgeTimeouts = 0;
  private locateTimer: number | null = null;
  private readyTimer: number | null = null;

  private lastIframeText: string | null = null;
  private pendingWriteText: string | null = null;
  private writeInFlight = false;
  private writeLoopToken = 0;

  private contextPollInFlight = false;
  private contextPollFailures = 0;

  private unsubscribeSettings: (() => void) | null = null;
  private genericRules: GenericRule[] = [];
  private activeGenericRule: string | null = null;
  private retainedChoiceOrigin: string | null = null;
  private pageSiteRemote: SiteContext["siteRemote"] | null = null;
  private removePickerShortcut: (() => void) | null = null;
  private pickerOpen = false;

  private readonly onRuntimeMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean => {
    if (sender.id !== chrome.runtime.id) return false;
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    ) {
      return false;
    }
    const record = message as Record<string, unknown>;
    if (record.__ma !== 1 || record.type !== "ma/site-status-query") {
      return false;
    }
    const url = new URL(location.href);
    const page = detectEditorPage(url, document);
    const site = page?.site ?? detectSite(url, document);
    sendResponse({
      __ma: 1,
      site,
      originKey:
        page?.originKey ??
        (site === "hydro" ? siteOriginKey("hydro", location) : null),
      remote: this.context?.siteRemote ?? this.pageSiteRemote
    });
    return false;
  };

  start(): void {
    if (window.top !== window) return;
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    this.unsubscribeSettings = subscribeSettings((settings) =>
      this.applySettings(settings)
    );
    void getSettings()
      .then((settings) => this.applySettings(settings))
      .catch((error: unknown) => {
        this.settingsError = `${COPY.settingsError} ${bridgeDetail(error)}`;
        this.updateBanner();
      });

    this.removePickerShortcut = installGenericPickerShortcut(() => {
      void this.pickGenericEditor();
    });
    void this.loadGenericRules();

    window.addEventListener("message", this.onEditorMessage);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
    window.addEventListener("popstate", this.onHistory);
    window.addEventListener("hashchange", this.onHistory);
    window.setInterval(() => this.checkRoute(false), ROUTE_POLL_MS);
    window.setInterval(() => void this.pollContext(), CONTEXT_POLL_MS);
    this.checkRoute(true);
  }

  private async loadGenericRules(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(GENERIC_RULES_KEY);
      const value = stored[GENERIC_RULES_KEY];
      const rules: GenericRule[] = [];
      if (Array.isArray(value)) {
        for (const entry of value) {
          try {
            rules.push(parseRule(entry));
          } catch {
            // Ignore one malformed rule instead of losing the rest.
          }
        }
      }
      this.genericRules = rules;
      this.checkRoute(false);
    } catch {
      this.genericRules = [];
    }
  }

  private async pickGenericEditor(): Promise<void> {
    if (this.pickerOpen) return;
    this.pickerOpen = true;
    this.banner.hide();
    try {
      const controller = openGenericPicker({
        locale: navigator.language,
        strings: defaultPickerStrings(navigator.language),
        theme: this.settings?.theme,
        editorTheme: this.settings?.editorTheme
      });
      const outcome = await controller.result;
      if (outcome.status !== "selected") return;
      const selection: GenericPickerSelection = outcome.selection;
      if (!selection.editorSelectorUnique) {
        this.showNotice(
          navigator.language.startsWith("zh")
            ? "该编辑器选择器不唯一，规则未保存。"
            : "The editor selector is not unique, so the rule was not saved."
        );
        return;
      }
      const rule = createRuleFromPickerSelection(selection);
      const stored = await chrome.storage.local.get(GENERIC_RULES_KEY);
      const existing: unknown[] = Array.isArray(stored[GENERIC_RULES_KEY])
        ? (stored[GENERIC_RULES_KEY] as unknown[])
        : [];
      const kept = existing.filter((entry) => {
        try {
          const parsed = parseRule(entry);
          return !(
            parsed.origin === rule.origin &&
            parsed.pathPattern === rule.pathPattern &&
            parsed.editorSelector === rule.editorSelector
          );
        } catch {
          return false;
        }
      });
      kept.push(rule);
      await chrome.storage.local.set({ [GENERIC_RULES_KEY]: kept });
      this.genericRules = kept
        .map((entry) => {
          try {
            return parseRule(entry);
          } catch {
            return null;
          }
        })
        .filter((entry): entry is GenericRule => entry !== null);
      this.stopMount();
      this.page = null;
      this.activeGenericRule = null;
      this.checkRoute(true);
    } catch (error) {
      this.showNotice(
        navigator.language.startsWith("zh")
          ? `编辑器拾取失败：${bridgeDetail(error)}`
          : `Editor picker failed: ${bridgeDetail(error)}`
      );
    } finally {
      this.pickerOpen = false;
      this.updateBanner();
    }
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private readonly onHistory = (): void => {
    this.checkRoute(false);
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    this.stopMount();
    this.page = null;
    this.banner.hide();
    if (!event.persisted) {
      this.bridge.dispose();
      this.unsubscribeSettings?.();
      this.unsubscribeSettings = null;
      this.removePickerShortcut?.();
      this.removePickerShortcut = null;
    }
  };

  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      this.page = null;
      this.checkRoute(true);
    }
  };

  private readonly onEditorMessage = (event: MessageEvent): void => {
    const mount = this.mount;
    if (!mount) return;
    if (!event.isTrusted) return;
    if (event.source !== mount.iframe.contentWindow) return;
    if (event.origin !== this.extensionOrigin) return;
    const data = event.data;
    if (!isEditorToContent(data)) return;
    const message = data;

    switch (message.type) {
      case "ma/editor-ready": {
        const now = performance.now();
        if (this.editorReady) {
          // Repeated ready frames from the same load are ignored. A later
          // ready means the iframe document reloaded and lost its context, so
          // remount rather than leaving an empty editor behind.
          if (now - this.lastReadyAt < 1_000) return;
          const page = this.page;
          if (page) {
            this.stopMount();
            this.page = page;
            this.updateBanner();
            void this.beginMount(page, this.generation);
          }
          return;
        }
        this.editorReady = true;
        this.lastReadyAt = now;
        this.clearReadyTimer();
        this.flushEditorMessages();
        return;
      }
      case "ma/editor-change": {
        if (!this.context) return;
        if (message.text.length > MAX_TEXT_LENGTH) {
          this.showNotice(
            format(COPY.syncWriteError, { detail: "editor text too large" })
          );
          return;
        }
        if (message.text === this.lastIframeText && !this.writeInFlight) return;
        void this.queueSiteWrite(message.text);
        return;
      }
      case "ma/editor-language-request": {
        const standard = message.standard;
        if (typeof standard !== "string" || standard.length > 64) return;
        void this.language?.handleStandard(standard);
        return;
      }
      case "ma/editor-language-select": {
        const optionId = message.optionId;
        if (typeof optionId !== "string" || optionId.length > MAX_OPTION_ID_LENGTH) {
          return;
        }
        void this.language?.handleOptionChoice(optionId);
        return;
      }
      case "ma/editor-ready-session":
      case "ma/editor-status":
        return;
      case "ma/modal-open":
        this.mount?.setModal(true);
        return;
      case "ma/modal-close":
        this.mount?.setModal(false);
        return;
    }
  };

  private applySettings(settings: Settings): void {
    const previous = this.settings;
    const page = this.page;
    const choiceChanged =
      page?.site === "hydro" &&
      previous?.siteBackends[page.originKey] !== settings.siteBackends[page.originKey];
    const retryUnmounted = page !== null && (this.mount === null || choiceChanged);
    if (choiceChanged) this.stopMount();
    this.settings = settings;
    this.settingsError = null;
    this.banner.setTheme(settings);
    this.updateBanner();
    if (retryUnmounted) {
      // The first route check can run before settings load; a retained Monaco
      // page then has no backend choice yet. Retry once the choice exists.
      this.page = null;
      this.checkRoute(false);
    }
  }

  private checkRoute(initial: boolean): void {
    const url = new URL(location.href);
    const page = detectEditorPage(url, document);
    if (!page) {
      if (detectSite(url, document) === "generic") {
        const rule = this.genericRules.find((candidate) =>
          ruleMatchesLocation(candidate, {
            origin: url.origin,
            pathname: url.pathname
          })
        );
        if (rule) {
          const key = `${rule.origin}|${rule.pathPattern}|${rule.editorSelector}`;
          if (this.activeGenericRule === key && this.page !== null) return;
          this.stopMount();
          this.activeGenericRule = key;
          const pseudo = {
            site: "generic",
            originKey: url.origin,
            routeKey: routeKey(url)
          } as unknown as EditorPage;
          this.page = pseudo;
          this.error = null;
          this.canRetry = false;
          this.updateBanner();
          const generation = this.generation;
          void this.beginGenericMount(rule, pseudo, generation);
          return;
        }
      }
      this.activeGenericRule = null;
      this.retainedChoiceOrigin = null;
      this.pageSiteRemote = null;
      if (this.page !== null || this.mount !== null) {
        this.stopMount();
        this.page = null;
        // Ask MAIN to drop its adapter as well; this request intentionally
        // fails with "not-an-editor-page" and is best-effort cleanup.
        void this.bridge
          .request({ kind: "locate" }, 800)
          .catch(() => undefined);
      }
      this.banner.hide();
      return;
    }
    if (
      !initial &&
      this.page !== null &&
      this.page.routeKey === page.routeKey &&
      this.page.site === page.site
    ) {
      return;
    }

    this.stopMount();
    this.activeGenericRule = null;
    this.page = page;
    this.error = null;
    this.canRetry = false;
    this.updateBanner();
    const generation = this.generation;
    void this.beginMount(page, generation);
  }

  private async beginGenericMount(
    rule: GenericRule,
    page: EditorPage,
    generation: number
  ): Promise<void> {
    if (!this.isCurrent(generation) || this.page !== page) return;
    try {
      await this.bridge.request({ kind: "configure-generic", rule });
      if (!this.isCurrent(generation) || this.page !== page) return;
      await this.beginMount(page, generation);
    } catch (error) {
      if (!this.isCurrent(generation) || this.page !== page) return;
      this.error = `${COPY.noSlot} (${bridgeDetail(error)})`;
      this.canRetry = true;
      this.updateBanner();
    }
  }

  private stopMount(): void {
    this.generation += 1;
    this.clearLocateTimer();
    this.clearReadyTimer();
    this.locating = false;
    this.locateAttempts = 0;
    this.bridgeTimeouts = 0;
    this.contextPollFailures = 0;

    const slotId = this.slot?.slotId;
    if (slotId) {
      void this.bridge
        .request({ kind: "unsubscribe", slotId }, 800)
        .catch(() => undefined);
    }
    this.language?.dispose();
    this.language = null;
    this.mount?.destroy();
    this.mount = null;
    this.slot = null;
    this.context = null;
    this.editorReady = false;
    this.lastReadyAt = 0;
    this.pendingEditorMessages = [];
    this.lastIframeText = null;
    this.pendingWriteText = null;
    this.writeLoopToken += 1;
    this.writeInFlight = false;
    this.error = null;
    this.canRetry = false;
    this.snackbar.clear();
  }

  private async beginMount(
    page: EditorPage,
    generation: number
  ): Promise<void> {
    if (
      !this.isCurrent(generation) ||
      this.page !== page ||
      this.mount ||
      this.locating
    ) {
      return;
    }
    this.locating = true;
    this.locateAttempts += 1;
    try {
      if (page.site === "hydro") {
        if (this.settings === null) {
          this.scheduleLocateRetry(page, generation);
          return;
        }
        const choice = this.settings.siteBackends[page.originKey];
        const configured = await this.bridge.request({
          kind: "site-remote-configure",
          mode: choice === "wasm" || choice === "native" ? "local" : "site"
        });
        if (!this.isCurrent(generation) || this.page !== page) return;
        this.pageSiteRemote = readSiteRemote(configured);
        if (this.pageSiteRemote === "reload-required") {
          this.retainedChoiceOrigin = page.originKey;
          this.error = null;
          this.canRetry = false;
          this.updateBanner();
          return;
        }
        if (choice === "site") {
          this.retainedChoiceOrigin = null;
          this.error = null;
          this.updateBanner();
          return;
        }
      }
      const data = await this.bridge.request({ kind: "locate" });      if (!this.isCurrent(generation) || this.page !== page || this.mount) {
        return;
      }
      this.bridgeTimeouts = 0;
      const slots = Array.isArray(data.sites)
        ? data.sites.filter(
            (slot): slot is EditorSlotInfo => isEditorSlotInfo(slot)
          )
        : [];
      // Never start local services while an unmanaged site LSP is still active.
      // The document-start gate must confirm suspension before a Hydro takeover.
      if (page.site === "hydro") {
        try {
          const remoteData = await this.bridge.request({
            kind: "site-remote-status"
          });
          if (!this.isCurrent(generation) || this.page !== page) return;
          this.pageSiteRemote = readSiteRemote(remoteData);
        } catch {
          this.pageSiteRemote = "unsupported";
        }
      } else {
        this.pageSiteRemote = "none";
      }
      const retainedChoice = this.settings?.siteBackends[page.originKey];
      const remote = this.pageSiteRemote;
      if (
        page.site === "hydro" &&
        slots.some((slot) => slot.retainedMonaco) &&
        retainedChoice !== "wasm" &&
        retainedChoice !== "native"
      ) {
        // A pending gate can report "none" before Hydro loads its LSP. That is
        // not proof that the site has no service, so the retained editor is
        // never covered without an explicit local choice.
        this.retainedChoiceOrigin = page.originKey;
        this.error = null;
        this.canRetry = false;
        this.updateBanner();
        return;
      }
      if (
        remote === "unsupported" ||
        remote === "reload-required" ||
        (remote === "active" && (retainedChoice === "wasm" || retainedChoice === "native"))
      ) {
        this.retainedChoiceOrigin = page.originKey;
        this.error = null;
        this.canRetry = false;
        this.updateBanner();
        return;
      }
      const replacements = slots.filter(
        (candidate) =>
          !candidate.retainedMonaco ||
          remote === "none" ||
          (remote === "suspended" &&
            (retainedChoice === "wasm" || retainedChoice === "native"))
      );
      if (replacements.length === 0) {
        if (slots.length > 0) {
          this.retainedChoiceOrigin =
            remote === "active" && retainedChoice === undefined
              ? page.originKey
              : null;
          this.error = null;
          this.canRetry = false;
          this.updateBanner();
          return;
        }
        this.scheduleLocateRetry(page, generation);
        return;
      }
      this.retainedChoiceOrigin = null;
      const visible = replacements.find((candidate) =>
        selectorHasBox(candidate.selector)
      );      if (!visible) {
        this.scheduleLocateRetry(page, generation, COPY.selectorFailed);
        return;
      }
      const overlay = mountOverlay({
        slot: visible,
        src: chrome.runtime.getURL("editor.html?site=1"),
        title: COPY.pageTitle
      });      if (!overlay) {
        this.scheduleLocateRetry(page, generation, COPY.selectorFailed);
        return;
      }
      const slot = visible;
      this.mount = overlay;
      this.slot = slot;
      this.locateAttempts = 0;
      this.readyTimer = window.setTimeout(() => {
        if (!this.isCurrent(generation) || this.editorReady) return;
        this.stopMount();
        this.error = COPY.iframeTimeout;
        this.canRetry = true;
        this.updateBanner();
      }, IFRAME_READY_TIMEOUT_MS);

      await this.prepareContext(page, slot, generation);
    } catch (error) {      if (!this.isCurrent(generation) || this.page !== page) return;
      const detail = bridgeDetail(error);
      if (this.mount) {
        // The overlay was already hiding the site editor; never leave a blank
        // box when context preparation fails. Stop here instead of retrying
        // into a second blank flash; the banner offers an explicit retry.
        this.stopMount();
        this.error =
          error instanceof BridgeTimeoutError
            ? COPY.bridgeUnreachable
            : detail === "invalid site context"
              ? COPY.invalidContext
              : detail === "site editor text is too large"
                ? COPY.textTooLarge
                : `${COPY.noSlot} (${detail})`;
        this.canRetry = true;
        this.updateBanner();
        return;
      }
      if (error instanceof BridgeTimeoutError) {
        this.bridgeTimeouts += 1;
        if (this.bridgeTimeouts >= BRIDGE_TIMEOUT_LIMIT) {
          this.error = COPY.bridgeUnreachable;
          this.canRetry = true;
          this.updateBanner();
          return;
        }
        this.scheduleLocateRetry(page, generation);
        return;
      }
      if (detail === "adapter-unavailable" || detail === "not-an-editor-page") {
        this.error =
          detail === "adapter-unavailable"
            ? COPY.adapterUnavailable
            : `${COPY.noSlot} (${detail})`;
        this.canRetry = true;
        this.updateBanner();
        return;
      }
      this.error = `${COPY.noSlot} (${detail})`;
      this.canRetry = true;
      this.updateBanner();
    } finally {
      if (this.isCurrent(generation)) {
        this.locating = false;
      }
    }
  }

  private scheduleLocateRetry(
    page: EditorPage,
    generation: number,
    fallbackError?: string
  ): void {
    if (!this.isCurrent(generation) || this.page !== page) return;
    if (this.locateAttempts >= LOCATE_MAX_ATTEMPTS) {
      this.error = fallbackError ?? COPY.noSlot;
      this.canRetry = true;
      this.updateBanner();
      return;
    }
    this.clearLocateTimer();
    this.locateTimer = window.setTimeout(() => {
      this.locateTimer = null;
      if (this.isCurrent(generation) && this.page === page && !this.mount) {
        void this.beginMount(page, generation);
      }
    }, LOCATE_RETRY_MS);
  }

  private async prepareContext(
    page: EditorPage,
    slot: EditorSlotInfo,
    generation: number
  ): Promise<void> {
    const [contextData, textData, optionsData, currentData] = await Promise.all([
      this.bridge.request({ kind: "context", slotId: slot.slotId }),
      this.bridge.request({ kind: "read", slotId: slot.slotId }),
      this.bridge.request({ kind: "language-options", slotId: slot.slotId }),
      this.bridge.request({ kind: "read-language", slotId: slot.slotId })
    ]);
    if (!this.isCurrent(generation) || !this.mount || this.slot !== slot) {
      return;
    }

    const originKey = readStringField(contextData, "originKey");
    const accountScope = readStringField(contextData, "accountScope");
    const problemKey = readStringField(contextData, "problemKey");
    const text = textData.text;
    if (!isSiteKeyPart(originKey) || !isSettingsOriginKey(originKey)) {
      throw new Error("invalid site context");
    }
    if (
      !isSiteKeyPart(accountScope) ||
      !isSiteKeyPart(problemKey) ||
      !isSiteKeyPart(slot.slotId) ||
      slot.selector.length === 0 ||
      slot.selector.length > 4_096 ||
      CONTROL_CHARACTERS.test(slot.selector)
    ) {
      throw new Error("invalid site context");
    }
    if (typeof text !== "string" || !fitsSiteText(text)) {
      throw new Error("site editor text is too large");
    }

    const context: SiteContext = {
      site: page.site,
      originKey,
      accountScope,
      problemKey,
      slot,
      initialText: text,
      options: normalizeLanguageOptions(optionsData),
      optionId: normalizeCurrentOptionId(currentData),
      siteRemote: readSiteRemote(contextData)
    };
    const contextMessage: ContentToEditor = {
      __ma: 1,
      type: "ma/site-context",
      context
    };
    if (
      new TextEncoder().encode(JSON.stringify(contextMessage)).byteLength >
      SITE_MESSAGE_LIMIT
    ) {
      throw new Error("site editor text is too large");
    }
    this.context = context;
    this.lastIframeText = text;

    const channel: LanguageSyncChannel = {
      request: (command) =>
        this.bridge.request(
          command,
          command.kind === "select-language"
            ? SELECT_TIMEOUT_MS
            : REQUEST_TIMEOUT_MS
        ),
      send: (message) => this.sendToEditor(message),
      onError: (message) =>
        this.showNotice(format(COPY.languageError, { detail: message })),
      onStandardUnavailable: (standard) =>
        this.showNotice(
          format(COPY.noStandard, { standard: standard.replace("c++", "C++") }),
          "info"
        )
    };
    this.language = new LanguageSync(slot.slotId, page.site, channel);

    if (optionsData.supported === false) {
      this.showNotice(COPY.languageUnsupported);
    }

    this.sendToEditor(contextMessage);
    if (context.siteRemote !== "none") {
      this.sendToEditor({
        __ma: 1,
        type: "ma/site-remote",
        state: context.siteRemote
      });
    }

    try {
      await this.bridge.request({ kind: "subscribe", slotId: slot.slotId });
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.showNotice(
          format(COPY.subscribeFailed, { detail: bridgeDetail(error) })
        );
      }
    }
    if (this.isCurrent(generation)) {
      this.updateBanner();
    }
  }

  private retryMount(): void {
    const page = this.page;
    if (!page) return;
    this.stopMount();
    this.error = null;
    this.canRetry = false;
    this.updateBanner();
    const generation = this.generation;
    void this.beginMount(page, generation);
  }

  private async queueSiteWrite(text: string): Promise<void> {
    if (!this.mount || !this.slot) return;
    this.pendingWriteText = text;
    if (this.writeInFlight) return;
    this.writeInFlight = true;
    const generation = this.generation;
    const token = ++this.writeLoopToken;
    try {
      while (
        this.pendingWriteText !== null &&
        this.isCurrent(generation) &&
        this.slot !== null
      ) {
        const next = this.pendingWriteText;
        this.pendingWriteText = null;
        try {
          await this.bridge.request(
            {
              kind: "write",
              slotId: this.slot.slotId,
              text: next,
              origin: "user"
            },
            SELECT_TIMEOUT_MS
          );
          if (!this.isCurrent(generation) || this.writeLoopToken !== token) return;
          this.lastIframeText = next;
        } catch (error) {
          if (this.isCurrent(generation)) {
            this.showNotice(
              format(COPY.syncWriteError, { detail: bridgeDetail(error) })
            );
          }
          return;
        }
      }
    } finally {
      if (this.writeLoopToken === token) {
        this.writeInFlight = false;
      }
    }
  }

  private handleSiteEvent(event: BridgeEvent): void {
    if (!this.slot || event.slotId !== this.slot.slotId) return;
    if (event.event === "native-change") {
      if (event.origin === "sync") return;
      if (event.text === this.lastIframeText) return;
      if (event.text === this.pendingWriteText) {
        // The site already shows text the editor is still sending us; remember
        // it so the write completion echo is suppressed too.
        this.lastIframeText = event.text;
        return;
      }
      this.lastIframeText = event.text;
      this.sendToEditor({ __ma: 1, type: "ma/native-text", text: event.text });
      return;
    }
    this.language?.handleNativeChange(event.optionId);
  }

  private async pollContext(): Promise<void> {
    const page = this.page;
    const slot = this.slot;
    const context = this.context;
    const language = this.language;
    if (
      !page ||
      !slot ||
      !context ||
      !language ||
      !this.mount ||
      this.contextPollInFlight ||
      document.visibilityState === "hidden"
    ) {
      return;
    }
    if (!this.mount.target.isConnected || !this.mount.iframe.isConnected) {
      // The site replaced its editor DOM (or removed the overlay) without a URL
      // change. Restore what is left and locate the current editor again.
      this.stopMount();
      this.page = page;
      this.updateBanner();
      void this.beginMount(page, this.generation);
      return;
    }
    this.contextPollInFlight = true;
    const generation = this.generation;
    try {
      const data = await this.bridge.request({
        kind: "context",
        slotId: slot.slotId
      });
      if (
        !this.isCurrent(generation) ||
        this.page !== page ||
        this.slot !== slot
      ) {
        return;
      }
      const currentContext = this.context;
      if (!currentContext) return;
      this.contextPollFailures = 0;
      const originKey = readStringField(data, "originKey");
      const accountScope = readStringField(data, "accountScope");
      const problemKey = readStringField(data, "problemKey");
      if (
        originKey === null ||
        accountScope === null ||
        problemKey === null ||
        problemKey.length === 0
      ) {
        return;
      }
      const siteRemote = readSiteRemote(data);

      if (
        originKey !== currentContext.originKey ||
        problemKey !== currentContext.problemKey ||
        accountScope !== currentContext.accountScope
      ) {
        // A new task/problem/account changes the draft key and may change the
        // initial text. A fresh mount is cheaper to reason about than mutating
        // a live session (and it re-reads the site editor).
        this.stopMount();
        this.page = page;
        this.updateBanner();
        const nextGeneration = this.generation;
        void this.beginMount(page, nextGeneration);
        return;
      }

      if (siteRemote !== currentContext.siteRemote) {
        this.context = {
          ...(this.context ?? currentContext),
          siteRemote
        };
        this.sendToEditor({
          __ma: 1,
          type: "ma/site-remote",
          state: siteRemote
        });
      }
      this.updateBanner();
      await language.refresh(false);
    } catch {
      if (!this.isCurrent(generation)) return;
      this.contextPollFailures += 1;
      if (this.contextPollFailures === 3) {
        this.showNotice(COPY.bridgeUnreachable);
      }
      if (this.contextPollFailures >= 5) {
        // The adapter has stopped answering. Never keep the site editor
        // hidden behind an overlay that can no longer receive edits.
        this.stopMount();
        this.page = page;
        this.error = COPY.bridgeUnreachable;
        this.canRetry = true;
        this.updateBanner();
      }
    } finally {
      this.contextPollInFlight = false;
    }
  }

  private sendToEditor(message: ContentToEditor): void {
    if (!this.mount) return;
    if (!this.editorReady) {
      if (this.pendingEditorMessages.length < MAX_PENDING_EDITOR_MESSAGES) {
        this.pendingEditorMessages.push(message);
      }
      return;
    }
    if (!this.mount.post(message)) {
      this.showNotice(COPY.editorPostFailed);
    }
  }

  private flushEditorMessages(): void {
    const messages = this.pendingEditorMessages;
    this.pendingEditorMessages = [];
    for (const message of messages) {
      if (!this.mount?.post(message)) {
        this.showNotice(COPY.editorPostFailed);
        break;
      }
    }
  }

  private async chooseSiteBackend(
    kind: "wasm" | "native" | "site"
  ): Promise<void> {
    const originKey = this.retainedChoiceOrigin ?? this.context?.originKey;
    if (!originKey) return;
    try {
      await updateSettings({
        siteBackends: { [originKey]: kind }
      });
      this.retainedChoiceOrigin = null;
      this.stopMount();
      this.page = null;
      this.checkRoute(true);
    } catch (error: unknown) {
      this.error = bridgeDetail(error);
      this.canRetry = true;
      this.updateBanner();
    }
  }

  private openSetup(onFailure: () => void): void {
    chrome.runtime.sendMessage(
      { __ma: 1, type: "ma/open-onboarding" },
      (reply: unknown) => {
        const runtimeError = chrome.runtime.lastError;
        const ok =
          runtimeError === undefined &&
          typeof reply === "object" &&
          reply !== null &&
          (reply as Record<string, unknown>).ok === true;
        if (!ok) {
          onFailure();
          this.showNotice(COPY.setupFailed);
        }
      }
    );
  }

  private showNotice(message: string, kind: "info" | "error" = "error"): void {
    this.banner.mount();
    this.snackbar.show(message, { kind });
  }

  private updateBanner(): void {
    if (this.pickerOpen) {
      this.banner.hide();
      return;
    }
    const settings = this.settings;
    const setupIncomplete =
      settings !== null &&
      (settings.backend === null || !settings.onboardingComplete);

    let siteRemoteWarning: string | null = null;
    const context = this.context;
    const remote = context?.siteRemote ?? this.pageSiteRemote;
    const originKey =
      context?.originKey ?? this.retainedChoiceOrigin ?? this.page?.originKey;
    const choice = originKey ? settings?.siteBackends[originKey] : undefined;
    const reloadRequired =
      remote === "reload-required" ||
      (remote === "active" && (choice === "wasm" || choice === "native"));
    if (reloadRequired) {
      siteRemoteWarning = COPY.siteRemoteReload;
    } else if (remote === "unsupported" && choice !== "site") {
      siteRemoteWarning = COPY.siteRemoteUnsupported;
    } else if (remote === "active" && choice === undefined) {
      siteRemoteWarning = COPY.siteRemoteActive;
    }
    if (
      siteRemoteWarning === null &&
      this.retainedChoiceOrigin !== null &&
      choice !== "wasm" &&
      choice !== "native" &&
      choice !== "site"
    ) {
      // The gate can report "none" before a Hydro deployment exposes its LSP.
      // A retained editor still needs an explicit backend choice.
      siteRemoteWarning = COPY.siteBackendRequired;
    }

    const error = this.error ?? this.settingsError;
    this.banner.update({
      setupIncomplete,
      siteRemoteWarning,
      siteOrigin:
        siteRemoteWarning === null
          ? null
          : context?.originKey ??
            this.retainedChoiceOrigin ??
            this.page?.originKey ??
            null,
      error,
      canRetry: this.canRetry && this.page !== null && error !== null,
      reloadRequired
    });
  }

  private clearLocateTimer(): void {
    if (this.locateTimer !== null) {
      window.clearTimeout(this.locateTimer);
      this.locateTimer = null;
    }
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== null) {
      window.clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }
}

const controller = new ContentController();
controller.start();
