// Upload rendered clip to S3/CloudFront and inject the embed into the target MDX page.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// Uses the authenticated AWS CLI (no SDK install needed).
export async function uploadToCDN(file, key) {
  await exec('aws', ['s3', 'cp', file, `s3://${process.env.CDN_BUCKET}/${key}`,
    '--content-type', 'video/mp4', '--cache-control', 'public, max-age=31536000, immutable']);
  return `${process.env.CDN_BASE_URL.replace(/\/$/, '')}/${key}`;
}

// Insert/replace an embed block between markers so re-runs update in place.
export async function injectEmbed(repoRoot, targetPage, videoUrl, { poster } = {}) {
  const path = `${repoRoot}/${targetPage}`;
  let mdx = await readFile(path, 'utf8');
  const block =
`{/* walkthrough:start */}
<video controls playsInline preload="metadata"${poster ? ` poster="${poster}"` : ''} style={{width:"100%",borderRadius:"12px",border:"1px solid #e2e8f0"}}>
  <source src="${videoUrl}" type="video/mp4" />
</video>
{/* walkthrough:end */}`;
  const re = /\{\/\* walkthrough:start \*\/\}[\s\S]*?\{\/\* walkthrough:end \*\/\}/;
  if (re.test(mdx)) mdx = mdx.replace(re, block);
  else mdx = mdx.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n${block}\n`); // after frontmatter
  await writeFile(path, mdx);
  return path;
}
