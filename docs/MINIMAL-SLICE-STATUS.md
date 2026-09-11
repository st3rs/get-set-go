# Get Set Go minimal-slice-v1 proof status

This document deliberately separates model functionality from deployment plumbing. A successful build is not proof that a runtime feature works.

| Proof | What it proves | Required artifact | Current status |
| --- | --- | --- | --- |
| Direct Meta Muse Image entitlement | The raw `MODEL_API_KEY` can call `muse-image-1.0` without Cloudflare | `artifacts/meta-image-smoke/<timestamp>/proof.json` plus a real `image.webp`, `image.png`, or `image.jpg` | UNPROVEN |
| Cloudflare Muse Image plumbing | Worker deployment, secret binding, routing, and response parsing work | Production `/api/smoke-image` response with image bytes | UNPROVEN |
| Direct/local Browser capture | Browser capture works outside the production orchestration path | Saved screenshot plus capture metadata | UNPROVEN |
| Direct/local Spark structure | `muse-spark-1.3` returns JSON that parses against the minimal contract | Saved raw Spark response plus parsed JSON | UNPROVEN |
| Direct/local output injection | Generated image bytes are actually embedded in `output.html` | Saved `output.html` opened/rendered with the generated image visible | UNPROVEN |
| Local end-to-end minimal slice | Browser → Spark → Muse Image → HTML completes without Cloudflare edge timing | Complete local artifact directory | UNPROVEN |
| Production minimal slice | The already-proven local slice also survives production routing/time limits | Production response plus rendered output | UNPROVEN |

## Direct entitlement command

The source of truth for the first row is `scripts/smoke-meta-image.mjs`.

It calls `https://api.meta.ai/v1/responses` directly using only:

```json
{
  "model": "muse-image-1.0",
  "input": "a simple product photo of a white chair"
}
```

No Cloudflare Worker, Pages Function, Durable Object, browser binding, registry, critic, queue, polling, or service binding participates in this proof.

The script always saves the raw response and `proof.json`. On success it also decodes and saves the image bytes and records the first 16 magic bytes as hex. HTTP 403/404 is recorded as `model-not-entitled-or-not-available-for-this-key` without attempting to repair Cloudflare plumbing.

## Rule

Do not mark any row PASS without the required runtime artifact. CI/build success only means the code compiles or bundles.
