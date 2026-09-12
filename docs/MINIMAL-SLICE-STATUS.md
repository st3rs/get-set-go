# Get Set Go minimal-slice-v1 proof status

This document deliberately separates model functionality from deployment plumbing. A successful build is not proof that a runtime feature works.

| Proof | What it proves | Required artifact | Current status |
| --- | --- | --- | --- |
| Meta Muse Image account/playground access | This Meta project/account can select `muse-image-1.0` and visibly generate the expected white-chair image in the Meta Model API playground | Captured playground screenshot with the generated image visibly rendered | PROVEN |
| Direct Meta Spark control | The raw `MODEL_API_KEY` can call `muse-spark-1.3` without Cloudflare | `artifacts/meta-model-proof/<timestamp>/spark/proof.json` plus raw response | PROVEN |
| Direct Meta Muse Image API-key bytes | The same raw key can call `muse-image-1.0` through Meta Model API and return recognized nonzero image bytes | `artifacts/meta-model-proof/<timestamp>/image/proof.json` | PROVEN |
| Direct Meta Muse Image visual integrity | The saved API-generated image is not truncated/corrupt and visibly matches the white-chair smoke prompt | Saved `image.webp` opened manually and visually confirmed | VISUAL CHECK PENDING |
| Direct two-model interpretation | Spark and Image results can be interpreted without conflating request, key/project, policy, geo, or request-surface failures | `artifacts/meta-model-proof/<timestamp>/summary.json` | PROVEN |
| Direct/local Browser capture | Local Playwright can open a real public reference URL, settle at network idle, save the final DOM, and produce a visually valid full-page screenshot without Cloudflare browser infrastructure | `artifacts/browser-capture/<timestamp>/page.html`, `screenshot.png`, `proof.json`, plus manual visual confirmation | NEXT / UNPROVEN |
| Direct/local Spark structure | `muse-spark-1.3` returns JSON that parses against the minimal contract | Saved raw Spark response plus parsed JSON | UNPROVEN |
| Direct/local output injection | Generated image bytes are actually embedded in `output.html` | Saved `output.html` opened/rendered with the generated image visible | UNPROVEN |
| Local end-to-end minimal slice | Browser → Spark → Muse Image → HTML completes without Cloudflare edge timing | Complete local artifact directory | UNPROVEN |
| Cloudflare Muse Image plumbing | Worker deployment, secret binding, routing, and response parsing work | Production `/api/smoke-image` response with image bytes | UNPROVEN |
| Production minimal slice | The already-proven local slice also survives production routing/time limits | Production response plus rendered output | UNPROVEN |

## Runtime proof recorded on 2026-09-12

The direct proof command completed against `https://api.meta.ai/v1/responses` with Cloudflare explicitly out of the path.

Spark control:

```text
model: muse-spark-1.3
HTTP: 200
output: CONTROL_OK
raw response: 924 bytes
elapsed: 6433 ms
```

Muse Image:

```text
model: muse-image-1.0
HTTP: 200
content-type: application/json
raw response: 69382 bytes
image bytes: 50872 bytes
mime: image/webp
file: image.webp
magic: 52 49 46 46 b0 c6 00 00 57 45 42 50 56 50 38 58
elapsed: 16192 ms
```

Summary classification:

```text
spark-and-image-direct-meta-pass
```

This proves the exported `MODEL_API_KEY`, Meta Responses endpoint, `muse-spark-1.3`, and `muse-image-1.0` work together directly. No provider fallback is justified by access/entitlement concerns.

The image row is intentionally split into bytes proof and visual-integrity proof. Magic bytes and nonzero length do not prove the file is fully renderable. The saved `image.webp` must still be opened once and visually confirmed before the visual-integrity row becomes PROVEN.

## Local Browser capture proof

Source of truth: `scripts/proof-browser-capture.mjs`.

Default reference URL:

```text
https://www.raycast.com/
```

It is intentionally a public, visually rich SaaS landing page that can also serve as a real reconstruction reference later. The URL can be overridden with `BROWSER_CAPTURE_URL` without changing the script.

The script uses local Playwright Chromium only. It does not use the Cloudflare `BROWSER` binding, Workers, Pages Functions, service bindings, Durable Objects, or any browser stealth/user-agent spoofing.

It waits for `networkidle`, then writes exactly the proof artifacts needed for this gate:

```text
artifacts/browser-capture/<timestamp>/
├─ page.html       # page.content()
├─ screenshot.png  # fullPage: true
└─ proof.json      # target URL, final URL, HTTP status, HTML byte length, <img> count, timing
```

Run:

```bash
npm run proof:browser-capture
```

Programmatic artifact creation is not enough to mark this row PROVEN. `screenshot.png` must be opened and visibly confirmed to show the intended target page. A cookie wall, bot/challenge page, login wall, or blank/near-blank page is a failed capture even when HTTP status, HTML byte length, or image count look healthy.

Time box: **2 hours**. If the chosen site blocks automation or falls into bot detection, change `BROWSER_CAPTURE_URL` to another suitable public reference. Do not spend the time box tuning user agents, stealth plugins, fingerprinting, proxy tricks, or other anti-detection workarounds.

## Direct Meta proof command

The source of truth for the API-key rows is `scripts/proof-meta-models.mjs`.

```bash
npm run proof:meta-models
```

No Cloudflare Worker, Pages Function, Durable Object, browser binding, registry, critic, queue, polling, service binding, or deployment participates in this proof.

Artifacts are saved as:

```text
artifacts/meta-model-proof/<timestamp>/
├─ spark/
│  ├─ raw-response.json | raw-response.txt
│  └─ proof.json
├─ image/
│  ├─ raw-response.json | raw-response.txt
│  ├─ proof.json
│  └─ image.webp | image.png | image.jpg
└─ summary.json
```

## HTTP interpretation

- Spark PASS + Image PASS: direct Meta API-key bytes path is proven. Open the saved image once to establish visual integrity. Next step is **Direct/local Browser capture**, not Cloudflare.
- Spark PASS + Image 400: inspect the complete image raw response and copy the authenticated Meta Documentation/playground request contract exactly. This is not entitlement.
- Spark PASS + Image 403: first verify that `MODEL_API_KEY` was created under the same Meta project/team as the playground proof. Do not switch providers and do not debug Cloudflare.
- Spark PASS + Image 404: inspect the exact Meta endpoint/path and authenticated request shape. Official Meta material documents Muse Image through the Responses API, so do not infer lack of model availability from 404 alone.
- Spark PASS + Image HTTP 2xx but zero bytes/no usable image: inspect `image/raw-response.json` in full before changing parser code. Check completion state, refusal/safety output, and actual JSON path.
- Spark 403: investigate key/project/account/region access first.
- Spark 401: raw key problem.
- Spark 400: control request/API contract problem.

## Provider decision

The previous automatic plan to move Muse Image to fal after a Meta 403/404 is cancelled. Direct runtime proof now shows the project key can call both Muse Spark and Muse Image successfully through Meta's Responses API.

## Latency controls

The authenticated playground exposes output format, reasoning strength, image search, shell, and web search controls. For Get Set Go's ordinary UI media generation, the intended production policy is PNG output, lower reasoning, and search/shell disabled unless a specific generation needs them. Do not guess the JSON field names from the UI. Copy the exact authenticated Meta API request schema before hard-coding these options.

## Rule

Do not mark the visual-integrity row PROVEN until the saved API-generated image has been opened and visibly confirmed intact. For Local Browser capture, do not mark PROVEN until `screenshot.png` is opened and visibly confirmed to show the intended reference page. After that, proceed to the local Spark structure proof before any Cloudflare plumbing test.
