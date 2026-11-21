/*
 * Project an editor theme's principal colour onto the M3E accent tokens.
 *
 * This changes only the UI accent family (primary/secondary/tertiary and their
 * containers). Background, typography and light/dark selection remain owned by
 * the M3E theme, so controls keep correct contrast in either UI mode.
 */

import { editorThemePrimaryColor } from "../editor/editor-themes.js";

type Rgb = readonly [number, number, number];

const ACCENT_TOKENS = [
  "--m3e-sys-color-primary",
  "--m3e-sys-color-on-primary",
  "--m3e-sys-color-primary-container",
  "--m3e-sys-color-on-primary-container",
  "--m3e-sys-color-secondary",
  "--m3e-sys-color-on-secondary",
  "--m3e-sys-color-secondary-container",
  "--m3e-sys-color-on-secondary-container",
  "--m3e-sys-color-tertiary",
  "--m3e-sys-color-on-tertiary",
  "--m3e-sys-color-tertiary-container",
  "--m3e-sys-color-on-tertiary-container",
  "--m3e-sys-color-surface-tint"
] as const;

function parseColor(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return [
        Number.parseInt(hex[0]! + hex[0], 16),
        Number.parseInt(hex[1]! + hex[1], 16),
        Number.parseInt(hex[2]! + hex[2], 16)
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16)
      ];
    }
    return null;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(
    text
  );
  if (srgb) {
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  }
  return null;
}

function hex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function mix(foreground: Rgb, background: Rgb, foregroundWeight: number): Rgb {
  const weight = Math.min(1, Math.max(0, foregroundWeight));
  return [
    foreground[0] * weight + background[0] * (1 - weight),
    foreground[1] * weight + background[1] * (1 - weight),
    foreground[2] * weight + background[2] * (1 - weight)
  ];
}

function luminance(rgb: Rgb): number {
  const channels = rgb.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  );
}

function contrasting(rgb: Rgb): string {
  return luminance(rgb) > 0.5 ? "#000000" : "#ffffff";
}

function readSurface(root: HTMLElement): Rgb {
  // The token can be a `light-dark(...)` or another unresolved colour function;
  // let the browser resolve it in the current color-scheme context.
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;background-color:var(--m3e-sys-color-surface)";
  root.append(probe);
  const resolved = parseColor(getComputedStyle(probe).backgroundColor);
  probe.remove();
  if (resolved) return resolved;
  const parsed = parseColor(
    getComputedStyle(root).getPropertyValue("--m3e-sys-color-surface")
  );
  if (parsed) return parsed;
  return getComputedStyle(root).colorScheme === "dark"
    ? [18, 18, 18]
    : [255, 255, 255];
}

/** Apply or clear the accent contributed by an editor theme. */
export function applyEditorThemeAccent(
  root: HTMLElement | null,
  themeId: string | null
): void {
  if (!root) return;
  const primary = parseColor(editorThemePrimaryColor(themeId) ?? "");
  if (!primary) {
    for (const token of ACCENT_TOKENS) root.style.removeProperty(token);
    return;
  }
  const surface = readSurface(root);
  const primaryContainer = mix(primary, surface, 0.2);
  const secondary = mix(primary, surface, 0.72);
  const secondaryContainer = mix(primary, surface, 0.2);
  const tertiary = mix(primary, surface, 0.5);
  const tertiaryContainer = mix(primary, surface, 0.24);

  const values: Record<(typeof ACCENT_TOKENS)[number], string> = {
    "--m3e-sys-color-primary": hex(primary),
    "--m3e-sys-color-on-primary": contrasting(primary),
    "--m3e-sys-color-primary-container": hex(primaryContainer),
    "--m3e-sys-color-on-primary-container": contrasting(primaryContainer),
    "--m3e-sys-color-secondary": hex(secondary),
    "--m3e-sys-color-on-secondary": contrasting(secondary),
    "--m3e-sys-color-secondary-container": hex(secondaryContainer),
    "--m3e-sys-color-on-secondary-container": contrasting(secondaryContainer),
    "--m3e-sys-color-tertiary": hex(tertiary),
    "--m3e-sys-color-on-tertiary": contrasting(tertiary),
    "--m3e-sys-color-tertiary-container": hex(tertiaryContainer),
    "--m3e-sys-color-on-tertiary-container": contrasting(tertiaryContainer),
    "--m3e-sys-color-surface-tint": hex(primary)
  };
  for (const token of ACCENT_TOKENS) {
    root.style.setProperty(token, values[token]);
  }
}
