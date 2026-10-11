/**
 * A "## Why use it" section explains the whole article's feature and stays true
 * for as long as the feature does. Release-note phrasing ("can now", "no longer")
 * describes one change and goes stale the day after it ships.
 */
const CHANGELOG = /\b(can now|now (?:get|see|has|have|shows?|lets?|supports?)|no longer|will no longer|anymore|is now|are now)\b/i;

/** The first changelog-style phrase in `text`, or null. */
export function changelogPhrase(text) {
  const m = CHANGELOG.exec(String(text || ''));
  return m ? m[0] : null;
}

/** Release kinds that describe a capability worth a "Why use it"; a fix does not. */
export const WHY_USE_IT_KINDS = new Set(['new', 'improved']);
