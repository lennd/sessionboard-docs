// Documentation is read by prospects and by customers deciding how much to
// trust the product. A page that volunteers "this isn't finished" costs us more
// than the reader gains, and it dates badly — the caveat outlives the gap.
// Describe what the product does; route genuine gaps to support instead.
//
// Scoped to claims about our own maturity: "not supported in Swapcard" is a
// fact about Swapcard, and "if your organization doesn't have access yet" is
// about their plan. Both are fine and must stay lintable-clean.
//
// Shared by check-style.mjs (the gate) and release-intake.mjs (which must not
// write a sentence into an article that the gate would then reject).
const READINESS = /\b(available|usable|supported|ready|reliable|reported|implemented|built|live|working|finished|functional|complete|possible|wired|hooked)\b/i;
const NEGATION = /\b(not|isn'?t|aren'?t|doesn'?t|don'?t|can'?t|cannot|won'?t)\b/i;

const UNSHIPPED = [
  [/\bcoming soon\b/i, 'coming soon'],
  [/\bwork in progress\b/i, 'work in progress'],
  [/\bunder (development|construction)\b/i, 'under development'],
  [/\bstill being (built|finished|shaped|developed|worked)\b/i, 'still being built'],
  [/\brough edges?\b/i, 'rough edges'],
  [/\bhalf[- ]?(baked|built|finished)\b/i, 'half-baked'],
  [/\bnot fully (implemented|supported|built|working|wired)\b/i, 'not fully implemented'],
  [/\bin a future release\b/i, 'in a future release'],
  [/\bon the roadmap\b/i, 'on the roadmap'],
  [/\b(TODO|TBD)\b/, 'TODO/TBD'],
];

export const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n/;

/** Labels of the unshipped-claim rules one sentence breaks (empty when it is fine). */
export function sentenceClaims(sentence) {
  const s = sentence.trim();
  const hits = [];
  if (!s) return hits;
  for (const [re, label] of UNSHIPPED) {
    if (re.test(s)) hits.push(label);
  }
  if (/\byet\b/i.test(s) && NEGATION.test(s) && READINESS.test(s)) hits.push('"not ... yet"');
  // "You can't do X at this time" promises X is coming and dates the page the
  // moment it doesn't. State the limitation plainly instead. Left alone when
  // it means "at this point in the process", which has no negation.
  if (/\bat (this time|the moment)\b/i.test(s) && (NEGATION.test(s) || /\bonly\b/i.test(s))) hits.push('"at this time"');
  if (/\bnot currently\b/i.test(s)) hits.push('"not currently"');
  return hits;
}

/** [label, sentence] for every sentence that tells the reader a Sessionboard capability is unfinished. */
export function unshippedClaims(body) {
  const prose = body
    .replace(/```[\s\S]*?```/g, ' ') // code samples
    .replace(/^import .*$/gm, ' ');
  const hits = [];
  for (const sentence of prose.split(SENTENCE_SPLIT)) {
    const s = sentence.trim();
    for (const label of sentenceClaims(s)) hits.push([label, s]);
  }
  return hits;
}
