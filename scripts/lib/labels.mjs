/** Normalization shared by extract-ui-labels.mjs (corpus) and check-labels.mjs (lookup). */
export function normalize(s) {
  return String(s)
    .replace(/\{\{[^}]*\}\}/g, ' ') // i18n interpolations
    .replace(/[…]|\.\.\.$/g, '')
    .replace(/[:*]+$/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
