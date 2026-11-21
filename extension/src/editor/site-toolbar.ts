/*
 * Site-mode toolbar: the real C++ standard selector and nothing else. Backend,
 * remote state, and site-service switching live in the extension popup.
 *
 * Nothing here writes to the site or the language session. A standard change
 * is a request; a multi-option response is an explicit user choice.
 */

import {
  STANDARDS,
  isStandard,
  standardLabel,
  type Standard
} from "../profiles/types.js";
import type { LanguageOptionInfo, SiteContext } from "../shared/site-protocol.js";
import { t } from "../ui/i18n.js";
import { el, openDialog } from "../ui/primitives.js";
import type { SiteProfileLookup } from "./site-profile.js";

export interface SiteToolbarNodes {
  standardSelect: HTMLSelectElement;
}

export interface SiteToolbarState {
  context: SiteContext | null;
  profile: SiteProfileLookup;
  available: ReadonlyMap<Standard, readonly LanguageOptionInfo[]>;
  /** A local blank workspace has no site, but its standard selector is active. */
  standalone?: boolean;
}

export type LanguageChoiceOutcome =
  | { readonly kind: "selected"; readonly option: LanguageOptionInfo }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unavailable" };

/** Populate the fixed seven-standard selector once. */
export function buildStandardOptions(select: HTMLSelectElement): void {
  select.replaceChildren(
    el("option", { value: "", disabled: true }, [t("editor.site.standardPlaceholder")])
  );
  for (const standard of STANDARDS) {
    select.append(
      el("option", { value: standard }, [standardLabel(standard)])
    );
  }
}

export function renderSiteToolbar(
  nodes: SiteToolbarNodes,
  state: SiteToolbarState
): void {
  const selected =
    state.profile.kind === "profile"
      ? state.profile.profile.standard
      : null;

  const placeholder = Array.from(nodes.standardSelect.options).find(
    (option) => option.value === ""
  );
  if (placeholder) {
    placeholder.textContent = t("editor.site.standardPlaceholder");
  }
  for (const option of Array.from(nodes.standardSelect.options)) {
    const standard = option.value;
    if (standard === "") continue;
    option.disabled =
      !isStandard(standard) || !state.available.has(standard);
  }
  if (selected) {
    nodes.standardSelect.value = selected;
  } else {
    nodes.standardSelect.value = "";
  }
  nodes.standardSelect.disabled =
    (state.context === null && state.standalone !== true) ||
    state.available.size === 0;
  nodes.standardSelect.setAttribute(
    "aria-label",
    t("editor.site.standardLabel")
  );
}

/**
 * Ask the user to pick one of the site's compiler options. The dialog is
 * modal and read-only apart from the radio selection; disabled site options
 * stay visible but cannot be chosen.
 */
export async function chooseLanguageOption(
  standard: Standard,
  options: readonly LanguageOptionInfo[]
): Promise<LanguageChoiceOutcome> {
  const firstEnabled = options.find((option) => !option.disabled);
  if (!firstEnabled) {
    return { kind: "unavailable" };
  }

  const fieldset = el("fieldset", { class: "m3e-radio-group" }, [
    el("legend", {}, [t("editor.site.choiceLegend")])
  ]);
  for (const option of options) {
    fieldset.append(
      el(
        "label",
        {
          class: "ma-choice m3e-radio-button",
          style: {
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            padding: "8px 0"
          }
        },
        [
          el("input", {
            class: "m3e-radio-button__input",
            type: "radio",
            name: "ma-site-language-choice",
            value: option.optionId,
            checked: option.optionId === firstEnabled.optionId,
            disabled: option.disabled
          }),
          el("span", {
            class: "m3e-radio-button__icon",
            "aria-hidden": "true"
          }),
          el("span", {
            class: "m3e-radio-button__state",
            "aria-hidden": "true"
          }),
          el("span", { class: "m3e-radio-button__label" }, [
            option.label.trim() || option.optionId
          ])
        ]
      )
    );
  }

  const body = el("div", { style: { display: "grid", gap: "12px" } }, [
    el("p", {}, [
      t("editor.site.choiceBody", { standard: standardLabel(standard) })
    ]),
    fieldset
  ]);
  const accepted = await openDialog(
    t("editor.site.choiceTitle"),
    body,
    { confirm: t("editor.site.choiceConfirm") }
  );
  if (!accepted) {
    return { kind: "cancelled" };
  }

  const checked = body.querySelector<HTMLInputElement>(
    'input[name="ma-site-language-choice"]:checked'
  );
  if (!checked || checked.disabled) {
    return { kind: "unavailable" };
  }
  const option = options.find(
    (candidate) => candidate.optionId === checked.value
  );
  return option && !option.disabled
    ? { kind: "selected", option }
    : { kind: "unavailable" };
}
