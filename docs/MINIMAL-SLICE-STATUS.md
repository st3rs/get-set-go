# Get Set Go minimal-slice-v1 proof status

This document deliberately separates model functionality from deployment plumbing. A successful build is not proof that a runtime feature works.

| Proof | What it proves | Required artifact | Current status |
| --- | --- | --- | --- |
| Meta Muse Image account/playground access | This Meta project/account can select `muse-image-1.0` and visibly generate the expected white-chair image in the Meta Model API playground | Captured playground screenshot with the generated image visibly rendered | PROVEN |
| Direct Meta Spark control | The raw `MODEL_API_KEY` can call `muse-spark-1.3` without Cloudflare | `artifacts/meta-model-proof/<timestamp>/spark/proof.json` plus raw response | UNPROVEN |
| Direct Meta Muse Image API-key path | The same raw key can call `muse-image-1.0` through Meta Model API, return recognized nonzero image bytes, and produce a visually openable image | `artifacts/meta-model-proof/<timestamp>/image/proof.json` plus real image file opened manually and visually confirmed | UNPROVEN |
| Direct two-model interpretation | Spark and Image results can be interpreted without conflating request, key/project, policy, geo, or request-surface failures | `artifacts/meta-model-proof/<timestamp>/summary.json` | UNPROVEN |
| Direct/local Browser capture | Browser capture works outside the production orchestration path | Saved screenshot plus capture metadata | UNPROVEN |
| Direct/local Spark structure | `muse-spark-1.3` returns JSON that parses against the minimal contract | Saved raw Spark response plus parsed JSON | UNPROVEN |
| Direct/local output injection | Generated image bytes are actually embedded in `output.html` | Saved `output.html` opened/rendered with the generated image visible | UNPROVEN |
| Local end-to-end minimal slice | Browser → Spark → Muse Image → HTML completes without Cloudflare edge timing | Complete local artifact directory | UNPROVEN |
| Cloudflare Muse Image plumbing | Worker deployment, secret binding, routing, and response parsing work | Production `/api/smoke-image` response with image bytes | UNPROVEN |
| Production minimal slice | The already-proven local slice also survives production routing/time limits | Production response plus rendered output | UNPROVEN |

## Evidence now established

The Meta Model API playground visibly generated the white-chair image with `muse-image-1.0`. This proves account/project-level model access on Meta's own developer surface. It does not yet prove that the exported `MODEL_API_KEY` belongs to the same project/team or that the direct request contract is correct.

Meta's official `meta-model-cookbook` also documents Muse Image as being driven through the Responses API, so a future 404 must be investigated as an endpoint/path/request-contract issue before concluding that the model is unavailable.

## Direct proof command

The source of truth for the API-key rows is `scripts/proof-meta-models.mjs`.

Run one command with `MODEL_API_KEY` already present in the local environment:

```bash
npm run proof:meta-models
```

The script makes two direct calls, in order:

1. `muse-spark-1.3` with a tiny text control prompt.
2. `muse-image-1.0` with `a simple product photo of a white chair`.

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

- Spark PASS + Image PASS: direct Meta API-key path is proven only after the saved image is opened and visibly renders intact. Next step is **Direct/local Browser capture**, not Cloudflare.
- Spark PASS + Image 400: inspect the complete image raw response and copy the authenticated Meta Documentation/playground request contract exactly. This is not entitlement.
- Spark PASS + Image 403: first verify that `MODEL_API_KEY` was created under the same Meta project/team as the playground proof. Do not switch providers and do not debug Cloudflare.
- Spark PASS + Image 404: inspect the exact Meta endpoint/path and authenticated request shape. Official Meta material documents Muse Image through the Responses API, so do not infer lack of model availability from 404 alone.
- Spark PASS + Image HTTP 2xx but zero bytes/no usable image: inspect `image/raw-response.json` in full before changing parser code. Check completion state, refusal/safety output, and actual JSON path.
- Spark 403: investigate key/project/account/region access first.
- Spark 401: raw key problem.
- Spark 400: control request/API contract problem.

## Provider decision

The previous automatic plan to move Muse Image to fal after a Meta 403/404 is cancelled. The playground artifact proves this project/account has Muse Image access on Meta's own surface. Keep the first-party Meta path until direct API evidence shows a specific blocker that cannot be corrected by using the matching project key or documented request contract.

## Latency controls

The authenticated playground exposes output format, reasoning strength, image search, shell, and web search controls. For Get Set Go's ordinary UI media generation, the intended production policy is PNG output, lower reasoning, and search/shell disabled unless a specific generation needs them. Do not guess the JSON field names from the UI. Copy the exact authenticated Meta API request schema before hard-coding these options.

## Rule

Do not mark an API-key row PASS without the required runtime artifact. For Muse Image API-key proof, PASS additionally requires opening the saved image and visually confirming it renders intact and matches the smoke prompt. CI/build success only means the code compiles or bundles. After direct Meta proof, proceed to Local Browser capture before any Cloudflare plumbing test.
