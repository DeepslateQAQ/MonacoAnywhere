/**
 * Throw when either message table is missing a key from the other.
 * The inputs are Object.keys() results, so duplicate keys cannot occur here.
 *
 * @param {readonly string[]} enKeys
 * @param {readonly string[]} zhKeys
 * @param {{ enLabel?: string, zhLabel?: string }} [labels]
 */
export function assertMatchingMessageKeySets(enKeys, zhKeys, labels = {}) {
  const en = new Set(enKeys);
  const zh = new Set(zhKeys);
  const missingInEn = zhKeys.filter((key) => !en.has(key)).sort();
  const missingInZh = enKeys.filter((key) => !zh.has(key)).sort();
  if (missingInEn.length === 0 && missingInZh.length === 0) return;

  const enLabel = labels.enLabel ?? "messages.en";
  const zhLabel = labels.zhLabel ?? "messages.zh-CN";
  const details = [];
  if (missingInEn.length) details.push(`missing in ${enLabel}: ${missingInEn.join(", ")}`);
  if (missingInZh.length) details.push(`missing in ${zhLabel}: ${missingInZh.join(", ")}`);
  throw new Error(`i18n message key sets differ: ${details.join("; ")}`);
}
