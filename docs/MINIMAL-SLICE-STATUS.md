# Get Set Go minimal-slice-v1 proof status

This document deliberately separates model functionality from deployment plumbing. A successful build is not proof that a runtime feature works.

| Proof | What it proves | Required artifact | Current status |
| --- | --- | --- | --- |
| Direct Meta Spark control | The raw `MODEL_API_KEY` can call `muse-spark-1.3` without Cloudflare | `artifacts/meta-model-proof/<timestamp>/spark/proof.json` plus raw response | UNPROVEN |
| Direct Meta Muse Image access | The same raw key can call `muse-image-1.0` on the same Meta Responses surface and return recognized image bytes | `artifacts/meta-model-proof/<timestamp>/image/proof.json` plus real image file | UNPROVEN |
| Direct two-model interpretation | Spark and Image results can be interpreted without conflating request, auth, entitlement, geo, or model-surface failures | `artifacts/meta-model-proof/<timestamp>/summary.json` | UNPROVEN |
| Cloudflare Muse Image plumbing | Worker deployment, secret binding, routing, and response parsing work | Production `/api/smoke-image` response with image bytes | UNPROVEN |
| Direct/local Browser capture | Browser capture works outside the production orchestration path | Saved screenshot plus capture metadata | UNPROVEN |
| Direct/local Spark structure | `muse-spark-1.3` returns JSON that parses against the minimal contract | Saved raw Spark response plus parsed JSON | UNPROVEN |
| Direct/local output injection | Generated image bytes are actually embedded in `output.html` | Saved `output.html` opened/rendered with the generated image visible | UNPROVEN |
| Local end-to-end minimal slice | Browser → Spark → Muse Image → HTML completes without Cloudflare edge timing | Complete local artifact directory | UNPROVEN |
| Production minimal slice | The already-proven local slice also survives production routing/time limits | Production response plus rendered output | UNPROVEN |

## Direct proof command

The source of truth for the first three rows is `scripts/proof-meta-models.mjs`.

Run one command with `MODEL_API_KEY` already present in the local environment:

```bash
npm run proof:meta-models
```

The script makes two direct calls, in order:

1. `muse-spark-1.3` with a tiny text control prompt.
2. `muse-image-1.0` with `a simple product photo of a white chair`.

Both calls go directly to:

```text
https://api.meta.ai/v1/responses
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
│  └─ image.webp | image.png | image.jpg   # only when real image bytes are returned
└─ summary.json
```

## HTTP classifier

Do not merge 403 and 404.

| HTTP | Classification | Meaning / next action |
| --- | --- | --- |
| 400 | `invalid-request-or-surface-contract` | Request shape or API contract problem. Inspect raw response before changing anything else. |
| 401 | `invalid-or-unaccepted-api-key` | Raw key is rejected. Fix the key, not Get Set Go. |
| 403 | `forbidden-auth-entitlement-policy-or-geo` | Could be auth, model entitlement, policy, or geographic restriction. Interpret against the Spark control result. |
| 404 | `model-not-served-on-this-meta-api-surface` | Treat as a serving-surface problem. Move the image call to a provider that explicitly serves Muse Image rather than requesting entitlement or repeatedly changing payload shape. |
| 429 | `rate-limited` | Retry later. It proves neither entitlement nor lack of entitlement. |
| 5xx | `meta-upstream-error` | Retry later. Do not redesign the application around a transient upstream failure. |

## Interpretation matrix

- Spark PASS + Image PASS: Meta direct two-model path is proven. Proceed to the local full slice.
- Spark PASS + Image 404: Keep Spark on Meta; move only Muse Image to a provider that explicitly serves it.
- Spark PASS + Image 403: Base key/Spark surface works; image-specific entitlement or policy is the leading explanation. Do not debug Cloudflare.
- Spark 403: investigate key/account/region access first; image entitlement is not isolated by that run.
- Spark 401: raw key problem.
- Spark 400: control request/API contract problem.

## Rule

Do not mark any row PASS without the required runtime artifact. CI/build success only means the code compiles or bundles. `/api/smoke-image` is Cloudflare plumbing evidence only and can never mark the direct Meta rows PASS.
