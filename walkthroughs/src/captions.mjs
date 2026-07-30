// Build an SRT from either word-level timestamps (ElevenLabs) or per-step line timing.
function fmt(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const x = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${x}`;
}

// steps: [{ narration, audioOffset, duration, words? }]  (words already offset into the timeline)
export function buildSRT(steps) {
  const cues = [];
  for (const st of steps) {
    if (st.words?.length) {
      // group words into ~6-word cues for readability
      for (let i = 0; i < st.words.length; i += 6) {
        const chunk = st.words.slice(i, i + 6);
        cues.push({ start: st.audioOffset + chunk[0].start, end: st.audioOffset + chunk.at(-1).end,
                    text: chunk.map(w => w.word).join(' ') });
      }
    } else {
      cues.push({ start: st.audioOffset, end: st.audioOffset + st.duration, text: st.narration });
    }
  }
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join('\n');
}
