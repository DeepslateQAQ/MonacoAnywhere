/*
 * Answer the MAIN-world Hydro initializer gate before site editors are created.
 * This companion only reads extension preferences. No page data reaches Chrome
 * APIs, and an unavailable setting leaves the original site service enabled.
 */
import { getSettings } from "../background/state.js";
import { siteOriginKey } from "../sites/types.js";

if (window.top === window) {
  const decision = getSettings().then(
    (settings): "site" | "local" => {
      const choice = settings.siteBackends[siteOriginKey("hydro", location)];
      return choice === "wasm" || choice === "native" ? "local" : "site";
    },
    (): "site" => "site"
  );
  const sendDecision = (): void => {
    void decision.then((mode) => {
      window.postMessage(
        { __ma: 1, type: "ma/hydro-lsp-decision", mode },
        location.origin
      );
    });
  };
  window.addEventListener("message", (event: MessageEvent) => {
    if (!event.isTrusted || event.source !== window) return;
    const data: unknown = event.data;
    if (
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data) &&
      (data as Record<string, unknown>).__ma === 1 &&
      (data as Record<string, unknown>).type === "ma/hydro-lsp-ready"
    ) {
      sendDecision();
    }
  });
  sendDecision();
}
