// Compositor. Production path: overlay captions on real app-capture footage (Remotion/
// libass in CI). Local proof path: render brand HTML slides via headless Chromium, then
// assemble image segments + narration with ffmpeg (no text filters required).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
const exec = promisify(execFile);
const W = 1280, H = 720;
// real Sessionboard wordmark, embedded as a data URI so headless Chromium loads it reliably
const LOGO = 'data:image/png;base64,' + readFileSync(new URL('../../logo/sessionboard.png', import.meta.url)).toString('base64');

function chromiumBin() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  const base = `${homedir()}/Library/Caches/ms-playwright`;
  const found = execSync(`ls -d ${base}/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`).toString().trim();
  if (!found) throw new Error('Chromium not found; set CHROMIUM_BIN or run: npx playwright install chromium');
  return found;
}

const SLIDE_CSS = `
  *{margin:0;box-sizing:border-box;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif}
  body{width:${W}px;height:${H}px;background:linear-gradient(160deg,#0B1B3A,#122a5c);color:#fff;
       padding:64px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
  .logo{position:absolute;top:44px;left:64px;background:#fff;padding:11px 16px;border-radius:12px;
        display:inline-flex;box-shadow:0 4px 20px rgba(0,0,0,.25)}
  .logo img{height:26px;display:block}
  .num{color:#5B8DEF;font-weight:800;font-size:28px;margin-bottom:16px}
  .cap{font-size:46px;font-weight:700;line-height:1.25;max-width:1000px}
  .title{font-size:64px;font-weight:800;text-align:center}
  .kick{position:absolute;bottom:56px;left:64px;color:#8FB2FF;font-size:20px}
  .dot{position:absolute;bottom:60px;right:64px;display:flex;gap:8px}
  .dot i{width:10px;height:10px;border-radius:50%;background:#2a3f6e;display:block}
  .dot i.on{background:#5B8DEF}
`;
const slideHTML = (num, total, caption) => `<html><head><style>${SLIDE_CSS}</style></head><body>
  <div class="logo"><img src="${LOGO}"></div>
  <div class="num">STEP ${num} / ${total}</div>
  <div class="cap">${caption}</div>
  <div class="dot">${Array.from({length: total}, (_, i) => `<i class="${i < num ? 'on' : ''}"></i>`).join('')}</div>
</body></html>`;
const titleHTML = (t) => `<html><head><style>${SLIDE_CSS}</style></head><body style="align-items:center">
  <div class="logo"><img src="${LOGO}"></div>
  <div style="text-align:center"><div class="num" style="text-align:center">HELP CENTER · WALKTHROUGH</div>
  <div class="title">${t}</div></div>
</body></html>`;

async function shot(html, pngPath, workDir, name) {
  const htmlPath = `${workDir}/${name}.html`;
  await writeFile(htmlPath, html);
  await exec(chromiumBin(), ['--headless', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${W},${H}`, `--screenshot=${pngPath}`, `file://${htmlPath}`]);
}
async function imgToSeg(png, dur, out) {
  await exec('ffmpeg', ['-y', '-loop', '1', '-i', png, '-t', dur.toFixed(2), '-r', '30',
    '-vf', `scale=${W}:${H}`, '-pix_fmt', 'yuv420p', out]);
}
async function concat(files, out, dir) {
  const list = `${dir}/concat.txt`;
  await writeFile(list, files.map(f => `file '${f}'`).join('\n'));
  await exec('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function render({ steps, baseVideo, audioPath, title, out, workDir }) {
  const segs = [];
  // title card (2s)
  const tpng = `${workDir}/title.png`; await shot(titleHTML(esc(title)), tpng, workDir, 'title');
  const tseg = `${workDir}/title.mp4`; await imgToSeg(tpng, 2.0, tseg); segs.push(tseg);
  // body: real footage (prod) or one slide per step (proof)
  if (baseVideo) {
    const b = `${workDir}/body.mp4`;
    await exec('ffmpeg', ['-y', '-i', baseVideo, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0B1B3A`, '-r', '30', '-an', '-pix_fmt', 'yuv420p', b]);
    segs.push(b);
  } else {
    for (let i = 0; i < steps.length; i++) {
      const png = `${workDir}/s${i}.png`; await shot(slideHTML(i + 1, steps.length, esc(steps[i].narration)), png, workDir, `s${i}`);
      const seg = `${workDir}/s${i}.mp4`; await imgToSeg(png, steps[i].duration, seg); segs.push(seg);
    }
  }
  const full = `${workDir}/full.mp4`; await concat(segs, full, workDir);
  // mux narration (delayed 2s past the title card)
  await exec('ffmpeg', ['-y', '-i', full, '-i', audioPath,
    '-filter_complex', '[1:a]adelay=2000|2000[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-shortest', '-pix_fmt', 'yuv420p', out]);
  return out;
}
