# Async Reconstruction Jobs

## Why

Reconstruction can take several minutes because one run may include browser capture, responsive evidence extraction, design-plan resolution, media generation, code generation, rendering and multiple visual correction passes. Holding all of that work inside one HTTP request makes the UI appear frozen and makes transient provider/network failures harder to recover from.

## Production flow

```text
POST /api/jobs
  -> Pages service binding
  -> Worker POST /jobs
  -> GenerationJob Durable Object
  -> returns jobId immediately

GenerationJob alarm
  -> browser capture: desktop/tablet/mobile
  -> measured design evidence
  -> guardrailed DesignPlan
  -> codegen + bounded-concurrency media generation
  -> rendered comparison
  -> critic correction passes
  -> chunked result storage

GET /api/jobs/:id
  -> durable status + real stage/progress

GET /api/jobs/:id?includeResult=1
  -> final result after status=succeeded
```

## Job states

- `queued`
- `running`
- `succeeded`
- `failed`

Progress is written by the actual pipeline rather than inferred from elapsed time.

## Persistence

The browser stores the active `jobId` locally. Reloading the landing page resumes polling the same job instead of creating a duplicate run.

The Durable Object stores job metadata and input persistently. Large generated results are JSON-serialized and split into multiple storage keys so generated HTML, TSX, CSS and analysis evidence do not rely on one large storage value.

Completed/failed jobs expire after 24 hours and schedule a cleanup alarm.

## Reliability

- Background execution is decoupled from the user's HTTP connection.
- Existing `/analyze` remains temporarily available as a legacy fallback, but the product UI should use `/jobs`.
- Media generation is bounded-concurrency and runs alongside code generation after the shared design plan is resolved.
- Durable Object alarms are used for background execution, not `waitUntil`.
- Job status must be durable. Never use an in-memory Map as the source of truth for production jobs.

## UI contract

The frontend should display:

- current real stage
- numeric progress reported by the pipeline
- human-readable message
- running state that survives refresh
- explicit failure state
- final generated preview only after the job result is available

Do not show fabricated time-based stages or fake percentages.

## Current endpoints

- `POST /jobs { url, quality?, prompt?, steps? }`
- `GET /jobs/:id`
- `GET /jobs/:id?includeResult=1`
- `POST /analyze` legacy synchronous fallback

Pages exposes equivalent same-origin routes under `/api/jobs` and `/api/jobs/:id`.
