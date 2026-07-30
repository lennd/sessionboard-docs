#!/usr/bin/env node
// Orchestrator: spec -> narrate -> caption -> (capture|slides) -> render -> (upload) -> embed.
import { readFile, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { synthesize } from './tts.mjs';
import { buildSRT } from './captions.mjs';
import { render } from './render.mjs';
import { hydrateSecrets } from './secrets.mjs';
const exec = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..', '..');          // sessionboard-docs/
const GAP = 0.35, TITLE = 2.0;

const [, , specPath, ...flags] = process.argv;
const proof = flags.includes('--proof');
const useRemotion = flags.includes('--remotion');   // polished tier (needs remotion/ deps installed)
if (!specPath) { console.error('usage: generate.mjs <spec.json> [--proof] [--remotion]'); process.exit(1); }

await hydrateSecrets();   // pulls ELEVENLABS_*, SB_*, CDN_* from SSM if SSM_PREFIX is set

const spec = JSON.parse(await readFile(specPath, 'utf8'));
const work = resolve(__dir, '..', '.work', spec.id);
await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true });
console.log(`▶ ${spec.title} (${spec.steps.length} steps)${proof ? ' [proof: say + slides]' : ''}`);

// 1. narrate each step
let offset = TITLE; const parts = [];
for (let i = 0; i < spec.steps.length; i++) {
  const st = spec.steps[i];
  const audio = `${work}/step${i}.mp3`;
  const { duration, words } = await synthesize(st.narration, audio);
  st.duration = duration; st.audioOffset = offset; st.audio = audio;
  st.words = words?.map(w => ({ ...w, start: w.start, end: w.end })) || null;
  parts.push(audio); offset += duration + GAP;
  console.log(`  ${i + 1}. ${duration.toFixed(1)}s  "${st.narration.slice(0, 50)}..."`);
}

// 2. narration track = steps joined by silence gaps
await exec('ffmpeg', ['-y', '-f', 'lavfi', '-t', String(GAP), '-i', 'anullsrc=r=44100:cl=stereo', `${work}/sil.mp3`]);
const list = parts.flatMap((p, i) => i ? [`${work}/sil.mp3`, p] : [p]);
await writeFile(`${work}/a.txt`, list.map(f => `file '${f}'`).join('\n'));
const narration = `${work}/narration.m4a`;
await exec('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', `${work}/a.txt`, '-c:a', 'aac', narration]);

// 3. captions
const srt = `${work}/captions.srt`;
await writeFile(srt, buildSRT(spec.steps));

// 4. visuals: real app capture (prod) or branded slides (proof)
let baseVideo = null;
if (!proof) { const { capture } = await import('./capture.mjs'); baseVideo = await capture(spec, spec.steps, work); }

// 5. render — ffmpeg (fast/proof + micro-loops) or Remotion (polished tier)
const outDir = resolve(ROOT, 'media', 'walkthroughs'); await mkdir(outDir, { recursive: true });
const out = `${outDir}/${spec.id}.mp4`;
if (useRemotion) {
  await renderRemotion({ spec, baseVideo, narration, srt, work, out });
} else {
  await render({ steps: spec.steps, baseVideo, audioPath: narration, srtPath: srt, title: spec.title, out, workDir: work });
}
console.log(`✓ rendered ${out}`);

async function renderRemotion({ spec, baseVideo, narration, srt, work, out }) {
  const rdir = resolve(__dir, '..', 'remotion');
  const pub = `${rdir}/public`; await mkdir(pub, { recursive: true });
  await cp(narration, `${pub}/narration.m4a`);
  await cp(resolve(ROOT, 'logo', 'sessionboard.png'), `${pub}/sessionboard.png`);
  if (baseVideo) await cp(baseVideo, `${pub}/capture.webm`);
  const captions = (await readFile(srt, 'utf8')).trim().split(/\n\n+/).map(block => {
    const [, time, ...txt] = block.split('\n');
    const [a, b] = time.split(' --> ').map(t => { const [h, m, s] = t.replace(',', '.').split(':'); return (+h * 3600 + +m * 60 + +parseFloat(s)) * 1000; });
    return { text: txt.join(' '), startMs: a, endMs: b };
  });
  const fps = 30;
  const steps = spec.steps.map(s => ({ caption: s.narration, image: null, durationInFrames: Math.round(s.duration * fps) }));
  const totalFrames = Math.round(2 * fps) + steps.reduce((a, s) => a + s.durationInFrames, 0) + fps;
  const props = { title: spec.title, audioSrc: 'narration.m4a', captureSrc: baseVideo ? 'capture.webm' : null, captions, steps };
  await writeFile(`${work}/props.json`, JSON.stringify(props));
  await exec('npx', ['remotion', 'render', 'src/index.ts', 'Walkthrough', out,
    `--props=${work}/props.json`, `--frames=0-${totalFrames - 1}`], { cwd: rdir });
}

// 6. upload + embed
let videoUrl = `/media/walkthroughs/${spec.id}.mp4`;
if (process.env.CDN_BUCKET) {
  const { uploadToCDN } = await import('./upload-inject.mjs');
  videoUrl = await uploadToCDN(out, `walkthroughs/${spec.id}.mp4`);
  console.log(`✓ uploaded ${videoUrl}`);
}
const { injectEmbed } = await import('./upload-inject.mjs');
await injectEmbed(ROOT, spec.targetPage, videoUrl);
console.log(`✓ embedded in ${spec.targetPage}`);
