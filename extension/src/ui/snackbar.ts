import {
  SnackbarHostController,
  SnackbarHostState,
  type SnackbarData
} from "@kyralabs/m3e-elements/snackbar-layout.js";
import { TooltipController } from "@kyralabs/m3e-elements/tooltip-popup.js";

import { t } from "./i18n.js";

export interface SnackbarAction {
  label: string;
  run: () => void;
}

interface SnackbarOptions {
  kind?: "info" | "error";
  action?: SnackbarAction;
}

interface RenderedSnackbar {
  data: SnackbarData;
  item: HTMLDivElement;
  tooltip: TooltipController | null;
}

/**
 * Official M3E layout/behavior without custom-element registration: Chromium's
 * content-script isolated worlds do not expose CustomElementRegistry.
 */
export class Snackbar {
  private readonly host: HTMLDivElement;
  private readonly state = new SnackbarHostState();
  private readonly controller: SnackbarHostController;
  private current: RenderedSnackbar | null = null;
  private pending: AbortController | null = null;

  constructor(root: HTMLElement) {
    this.host = root.ownerDocument.createElement("div");
    this.host.className = "m3e-snackbar-host";
    this.host.setAttribute("role", "status");
    root.append(this.host);
    this.controller = new SnackbarHostController(this.host, { state: this.state });
    const unsubscribe = this.state.subscribe(() => this.render());
    root.ownerDocument.defaultView?.addEventListener("pagehide", () => {
      this.clear();
      unsubscribe();
      this.controller.destroy();
      this.host.remove();
    }, { once: true });
  }

  show(text: string, { kind = "info", action }: SnackbarOptions = {}): void {
    this.clear();
    if (text.length === 0) return;
    const controller = new AbortController();
    this.pending = controller;
    const actionable = action !== undefined || kind === "error";
    void this.state
      .showSnackbar({
        message: text,
        actionLabel: action?.label,
        withDismissAction: actionable,
        duration: actionable ? "indefinite" : "short",
        signal: controller.signal
      })
      .then((result) => {
        if (!controller.signal.aborted && result === "action-performed") {
          action?.run();
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) throw error;
      });
  }

  clear(): void {
    this.pending?.abort();
    this.pending = null;
  }

  private render(): void {
    const data = this.state.currentSnackbarData;
    if (this.current?.data === data) return;
    const previous = this.current;
    this.current = null;
    if (previous) {
      this.controller.exit(previous.item, () => previous.item.remove());
      previous.tooltip?.destroy();
      // An outgoing message may still be animating, but its old action is over.
      previous.item.inert = true;
      previous.item.setAttribute("aria-hidden", "true");
    }
    if (!data) return;

    const doc = this.host.ownerDocument;
    const item = doc.createElement("div");
    item.className = "m3e-snackbar-host__item";
    const snackbar = doc.createElement("div");
    snackbar.className = "m3e-snackbar";
    const text = doc.createElement("div");
    text.className = "m3e-snackbar__text";
    text.textContent = data.visuals.message;
    snackbar.append(text);
    let tooltip: TooltipController | null = null;
    if (data.visuals.actionLabel !== null || data.visuals.withDismissAction) {
      const actions = doc.createElement("div");
      actions.className = "m3e-snackbar__actions";
      if (data.visuals.actionLabel !== null) {
        const action = doc.createElement("button");
        action.type = "button";
        action.className = "m3e-button m3e-button--text m3e-snackbar__action";
        action.textContent = data.visuals.actionLabel;
        action.addEventListener("click", () => data.performAction());
        actions.append(action);
      }
      if (data.visuals.withDismissAction) {
        const dismiss = doc.createElement("button");
        dismiss.type = "button";
        dismiss.className = "m3e-icon-button m3e-snackbar__dismiss";
        dismiss.setAttribute("aria-label", t("common.dismiss"));
        const icon = doc.createElement("span");
        icon.className = "m3e-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "close";
        dismiss.append(icon);
        dismiss.addEventListener("click", () => data.dismiss());
        const tip = doc.createElement("div");
        tip.className = "m3e-tooltip";
        tip.setAttribute("popover", "manual");
        tip.setAttribute("role", "tooltip");
        tip.setAttribute("aria-hidden", "true");
        tip.textContent = t("common.dismiss");
        actions.append(dismiss, tip);
        tooltip = new TooltipController({
          tooltip: tip,
          onVisibleChange: (visible) => tooltip?.render(visible)
        });
        tooltip.setAnchor(dismiss);
      }
      snackbar.append(actions);
    }
    item.append(snackbar);
    this.host.append(item);
    this.current = { data, item, tooltip };
    this.controller.enter(item, data);
  }
}
