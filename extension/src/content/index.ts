/*
 * Bootstrap ISOLATED-world content script.
 *
 * It intentionally does not locate, hide, replace, or write any site editor.
 * It does not load adapters and does not open an LSP session. It only adds a
 * dismissible status banner so the current limitations are visible. The real
 * site router and mount layer arrive after the WASM engine gate.
 */

const BANNER_HOST_ID = "monacoanywhere-bootstrap-banner";
const SETTINGS_KEY = "settings:v1";

const prefersChinese = navigator.language.toLowerCase().startsWith("zh");

async function readSetupIncomplete(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const value: unknown = stored[SETTINGS_KEY];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return true;
    }
    const record = value as Record<string, unknown>;
    const backend = record.backend;
    return (
      (backend !== "wasm" && backend !== "native") ||
      record.onboardingComplete !== true
    );
  } catch {
    return true;
  }
}

function addBanner(needsSetup: boolean): void {
  if (document.getElementById(BANNER_HOST_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = BANNER_HOST_ID;
  host.style.position = "fixed";
  host.style.right = "16px";
  host.style.bottom = "16px";
  host.style.zIndex = "2147483647";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .banner {
      box-sizing: border-box;
      display: grid;
      gap: 8px;
      max-width: min(380px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      background: rgba(28, 27, 31, 0.96);
      color: #f4eff4;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    }
    .title { font-weight: 650; letter-spacing: 0.01em; }
    .text { color: #d7d0db; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button {
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    button.primary {
      border-color: transparent;
      background: #d0bcff;
      color: #201a2b;
      font-weight: 650;
    }
    button:focus-visible {
      outline: 2px solid #efb8c8;
      outline-offset: 2px;
    }
    button:disabled { cursor: progress; opacity: 0.7; }
  `;

  const banner = document.createElement("div");
  banner.className = "banner";
  banner.setAttribute("role", "status");

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = `MonacoAnywhere ${__MA_BUILD_VERSION__} · ${__MA_BUILD_MODE__}`;

  const text = document.createElement("div");
  text.className = "text";
  text.textContent = prefersChinese
    ? "骨架构建：站点编辑器接管与 C++ 语言服务尚未接入。当前页面未被修改。"
    : "Skeleton build: site editor takeover and C++ language services are not implemented yet. This page has not been modified.";

  const actions = document.createElement("div");
  actions.className = "actions";

  if (needsSetup) {
    const setup = document.createElement("button");
    setup.type = "button";
    setup.className = "primary";
    setup.textContent = prefersChinese ? "完成设置" : "Finish setup";
    setup.addEventListener("click", () => {
      setup.disabled = true;
      chrome.runtime.sendMessage(
        { __ma: 1, type: "ma/open-onboarding" },
        () => {
          if (chrome.runtime.lastError) {
            setup.disabled = false;
            text.textContent = prefersChinese
              ? "无法打开设置页，请从扩展弹出窗口重试。"
              : "Could not open setup. Retry from the extension popup.";
            return;
          }
          setup.disabled = false;
        }
      );
    });
    actions.append(setup);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = prefersChinese ? "关闭" : "Dismiss";
  close.setAttribute("aria-label", prefersChinese ? "关闭状态提示" : "Dismiss status message");
  close.addEventListener("click", () => {
    host.remove();
  });
  actions.append(close);

  banner.append(title, text, actions);
  shadow.append(style, banner);
  document.body.append(host);
}

if (window.top === window) {
  void readSetupIncomplete().then((incomplete) => {
    if (document.body) {
      addBanner(incomplete);
    }
  });
}
