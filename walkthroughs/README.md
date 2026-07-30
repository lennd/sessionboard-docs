# Sessionboard walkthrough video pipeline

Auto-generated, voice-narrated, captioned micro-walkthroughs for the docs — driven by the **real app** so they update with the product instead of rotting.

## How it works

```
spec (JSON, Claude-authored)  →  capture  →  narrate  →  caption  →  render  →  upload  →  embed
  {action, narration}[]          Playwright   ElevenLabs   SRT        ffmpeg/     S3+CDN     MDX <video>
                                  (real app)   (voice)      (synced)   Remotion
```

- **Capture** — Playwright drives the authenticated app through the flow (reusing the E2E harness + SandboxSeeder for deterministic data) and records `.webm`, with a synthetic cursor + per-step element highlights.
- **Narrate** — ElevenLabs TTS (word-level timestamps). Local `say` fallback for offline/dev renders.
- **Caption** — SRT built from the TTS timestamps (or per-line timing on the fallback).
- **Render** — ffmpeg for quick micro-loops; Remotion for polished narrated builds (captions, zoom-to-cursor, brand intro/outro).
- **Upload** — S3 + CloudFront (`content-cdn`).
- **Embed** — injects a `<video>`/embed block into the target MDX page between markers.

## Two clip tiers

| Tier | Length | Audio | Use | Renderer |
|---|---|---|---|---|
| **micro loop** | 5–15s | silent, looping | one action ("clone a session") | ffmpeg |
| **narrated walkthrough** | 30–90s | voice + captions | a section overview | Remotion |

## Prerequisites (what you plug in)

Set these as env vars / CI secrets:

| Var | For |
|---|---|
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | narration (omit → local `say` fallback) |
| `SB_APP_URL`, `SB_AUTH_STORAGE` | authenticated sandbox base URL + Playwright storage-state (from the E2E harness) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CDN_BUCKET`, `CDN_BASE_URL` | S3/CloudFront upload |

Local tooling: Node 20.17+, ffmpeg, Playwright (`npx playwright install chromium`). Remotion tier: `cd remotion && npm install`.

### How to provide secrets (no plaintext files)

Do **not** commit a `.env`. Store secrets in **AWS SSM Parameter Store** as SecureStrings under one prefix, and the pipeline hydrates them at runtime via your AWS CLI creds:

```bash
aws ssm put-parameter --type SecureString --name /sessionboard/walkthroughs/elevenlabs_api_key --value 'sk_...'
aws ssm put-parameter --type SecureString --name /sessionboard/walkthroughs/elevenlabs_voice_id --value '<voice_id>'
aws ssm put-parameter --type String       --name /sessionboard/walkthroughs/cdn_bucket --value '<content-cdn-bucket>'
aws ssm put-parameter --type String       --name /sessionboard/walkthroughs/cdn_base_url --value 'https://<cloudfront-domain>'
# then:
export SSM_PREFIX=/sessionboard/walkthroughs
node src/generate.mjs specs/create-a-session.json
```

AWS itself needs no setup here — the CLI is already authenticated (account 682250320539, us-west-1). CI uses GitHub Actions secrets instead of SSM.

### How to provide real-app capture

`capture.mjs` needs to reach an authenticated, seeded sandbox. Generate a Playwright **storage-state** from the E2E harness (a logged-in sandbox session) and point the pipeline at it:

```bash
export SB_APP_URL='https://<seeded-sandbox>.sessionboard.com'
export SB_AUTH_STORAGE=/absolute/path/to/storageState.json   # keep OUT of git; short-lived sandbox token
node src/generate.mjs specs/create-a-session.json            # records the real UI
```

Add `--remotion` for the polished tier (real footage + animated captions + zoom + brand cards).

## Usage

```bash
npm install
node src/generate.mjs specs/create-a-session.json          # full pipeline
node src/generate.mjs specs/create-a-session.json --proof   # local proof: `say` + screenshots + ffmpeg, no keys
```

## Dev-process hook

`.github/workflows/walkthroughs.yml` re-runs a section's spec when its feature dir changes on a PR, renders against an ephemeral seeded sandbox, and posts the clip for review. On merge it renders final, uploads, and updates the MDX embed. The spec doubles as an E2E smoke test — if the flow breaks, CI fails.
