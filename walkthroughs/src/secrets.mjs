// Hydrate secrets from AWS SSM Parameter Store at runtime — no plaintext files, nothing
// committed. Set SSM_PREFIX (e.g. /sessionboard/walkthroughs) and store SecureString params
// there; this reads them with your AWS CLI creds. CI uses GitHub Actions secrets instead.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const MAP = {
  elevenlabs_api_key: 'ELEVENLABS_API_KEY', elevenlabs_voice_id: 'ELEVENLABS_VOICE_ID',
  cdn_bucket: 'CDN_BUCKET', cdn_base_url: 'CDN_BASE_URL',
  sb_app_url: 'SB_APP_URL', sb_auth_storage: 'SB_AUTH_STORAGE',
};

export async function hydrateSecrets() {
  const prefix = process.env.SSM_PREFIX;
  if (!prefix) return;
  try {
    const { stdout } = await exec('aws', ['ssm', 'get-parameters-by-path', '--path', prefix,
      '--with-decryption', '--recursive', '--query', 'Parameters[].{n:Name,v:Value}', '--output', 'json']);
    let n = 0;
    for (const p of JSON.parse(stdout)) {
      const key = p.n.split('/').pop();
      const env = MAP[key] || key.toUpperCase();
      if (!process.env[env]) { process.env[env] = p.v; n++; }
    }
    console.log(`✓ hydrated ${n} secret(s) from SSM ${prefix}`);
  } catch (e) {
    console.warn('SSM hydrate skipped:', String(e.message).split('\n')[0]);
  }
}
