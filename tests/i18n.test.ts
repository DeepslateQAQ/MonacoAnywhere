import { describe, expect, it } from "vitest";

import { messages as en } from "../extension/src/ui/messages.en";
import { messages as zhCN } from "../extension/src/ui/messages.zh-CN";
import { assertMatchingMessageKeySets } from "../scripts/i18n-keys.mjs";
import { formatMessage, resolveLocale } from "../extension/src/ui/i18n";

const enKeys = Object.keys(en);
const zhKeys = Object.keys(zhCN);

describe("i18n build validation", () => {
  it("rejects a missing Simplified Chinese translation", () => {
    expect(() => assertMatchingMessageKeySets(
      enKeys,
      zhKeys.filter((key) => key !== "common.confirm"),
      { enLabel: "en.ts", zhLabel: "zh.ts" }
    )).toThrow(/missing in zh\.ts: common\.confirm/);
  });

  it("rejects a missing English translation", () => {
    expect(() => assertMatchingMessageKeySets(
      enKeys.filter((key) => key !== "common.cancel"),
      zhKeys
    )).toThrow(/missing in messages\.en: common\.cancel/);
  });
});

describe("locale and placeholder resolution", () => {
  it("uses the first supported browser language", () => {
    expect(resolveLocale(["fr-FR", "zh-CN", "en-US"])).toBe("zh-CN");
    expect(resolveLocale(["zh-Hant-TW"])).toBe("zh-CN");
    expect(resolveLocale(["en-GB"])).toBe("en");
    expect(resolveLocale(["fr-FR"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
  });

  it("interpolates repeated numeric and string values", () => {
    expect(formatMessage("{count}/{count}: {label}", {
      count: 2,
      label: "ok"
    })).toBe("2/2: ok");
  });
});
