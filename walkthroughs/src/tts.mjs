// Narration synthesis. ElevenLabs when a key is present (with word timestamps),
// otherwise macOS `say` as a local fallback so the pipeline runs with no keys.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
const exec = promisify(execFile);

const VOICE = process.env.ELEVENLABS_VOICE_ID || 'Rachel';

// Returns { audioPath, words: [{word, start, end}] | null, duration }
export async function synthesize(text, audioPath) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (key) return elevenlabs(text, audioPath, key);
  return sayFallback(text, audioPath);
}

async function elevenlabs(text, audioPath, key) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps`,
    { method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }) });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const data = await res.json();
  await writeFile(audioPath, Buffer.from(data.audio_base64, 'base64'));
  // build word timings from character alignment
  const a = data.alignment || data.normalized_alignment;
  const words = a ? wordsFromChars(a.characters, a.character_start_times_seconds, a.character_end_times_seconds) : null;
  const duration = a ? a.character_end_times_seconds.at(-1) : await probeDuration(audioPath);
  return { audioPath, words, duration };
}

function wordsFromChars(chars, starts, ends) {
  const words = []; let cur = '', s = null, e = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) { if (cur) { words.push({ word: cur, start: s, end: e }); cur = ''; s = null; } continue; }
    if (s === null) s = starts[i];
    cur += c; e = ends[i];
  }
  if (cur) words.push({ word: cur, start: s, end: e });
  return words;
}

async function sayFallback(text, audioPath) {
  const aiff = audioPath.replace(/\.\w+$/, '.aiff');
  await exec('say', ['-v', 'Samantha', '-o', aiff, text]);           // macOS TTS
  await exec('ffmpeg', ['-y', '-i', aiff, '-ar', '44100', '-ac', '2', audioPath]);
  const duration = await probeDuration(audioPath);
  return { audioPath, words: null, duration };                        // no word timings -> line-timed captions
}

async function probeDuration(p) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]);
  return parseFloat(stdout.trim());
}
