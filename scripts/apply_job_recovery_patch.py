from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
index_path = ROOT / 'worker' / 'src' / 'index.ts'
main_path = ROOT / 'src' / 'main.tsx'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


index = index_path.read_text(encoding='utf-8')
if 'JOB_HEARTBEAT_MS' not in index:
    index = replace_once(
        index,
        "  expiresAt?: number;\n  error?: string;\n};",
        "  expiresAt?: number;\n  error?: string;\n  attempt?: number;\n  heartbeatAt?: string;\n  leaseExpiresAt?: number;\n  deadlineAt?: number;\n  runToken?: string;\n};",
        'JobRecord recovery fields',
    )
    index = replace_once(
        index,
        "const JOB_TTL_MS = 24 * 60 * 60 * 1000;\nconst RESULT_CHUNK_CHARS = 48_000;",
        "const JOB_TTL_MS = 24 * 60 * 60 * 1000;\nconst JOB_HEARTBEAT_MS = 15_000;\nconst JOB_LEASE_MS = 90_000;\nconst JOB_HARD_TIMEOUT_MS = 8 * 60 * 1000;\nconst MAX_JOB_ATTEMPTS = 2;\nconst RESULT_CHUNK_CHARS = 48_000;",
        'job recovery constants',
    )

    new_job_runtime = r'''function isoMs(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function effectiveLeaseExpiry(job: JobRecord) {
  if (job.leaseExpiresAt) return job.leaseExpiresAt;
  const base = isoMs(job.heartbeatAt) || isoMs(job.startedAt) || isoMs(job.createdAt);
  return base ? base + JOB_LEASE_MS : 0;
}

export class GenerationJob {
  constructor(private state: any, private env: Env) {}

  private async markFailed(job: JobRecord, error: string, message: string) {
    const failed: JobRecord = {
      ...job,
      status: 'failed',
      stage: 'Failed',
      message,
      error,
      finishedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      leaseExpiresAt: undefined,
      runToken: undefined,
      expiresAt: Date.now() + JOB_TTL_MS,
    };
    await this.state.storage.put('job', failed);
    await this.state.storage.setAlarm(Date.now() + JOB_TTL_MS);
    return failed;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/start') {
      const payload = await request.json() as { jobId?: string; input?: JobInput };
      if (!payload.jobId || !payload.input) return json(this.env, { ok: false, error: 'Invalid job payload' }, 400);
      const existing = await this.state.storage.get('job') as JobRecord | undefined;
      if (existing) return json(this.env, { ok: true, job: existing }, 200);
      const now = Date.now();
      const job: JobRecord = {
        id: payload.jobId,
        status: 'queued',
        stage: 'Queued',
        progress: 0,
        message: 'Waiting for background runner',
        createdAt: new Date(now).toISOString(),
        attempt: 0,
      };
      await this.state.storage.put('job', job);
      await this.state.storage.put('input', payload.input);
      await this.state.storage.setAlarm(now + 50);
      return json(this.env, { ok: true, job }, 202);
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      let job = await this.state.storage.get('job') as JobRecord | undefined;
      if (!job) return json(this.env, { ok: false, error: 'Job not found' }, 404);

      const now = Date.now();
      if (job.status === 'running') {
        if (job.deadlineAt && now >= job.deadlineAt) {
          job = await this.markFailed(job, 'Background reconstruction exceeded the 8 minute runtime limit.', 'The background run timed out instead of hanging indefinitely');
        } else if (effectiveLeaseExpiry(job) <= now) {
          // Self-heal zombie jobs, including jobs created by deployments before
          // heartbeat fields existed. The alarm decides whether to retry or fail.
          await this.state.storage.setAlarm(now + 25);
        }
      }

      const includeResult = url.searchParams.get('includeResult') === '1';
      const result = includeResult && job.status === 'succeeded' ? await readLargeResult(this.state.storage) : undefined;
      return json(this.env, { ok: true, job, ...(includeResult ? { result } : {}) });
    }
    return json(this.env, { ok: false, error: 'Job route not found' }, 404);
  }

  async alarm() {
    let job = await this.state.storage.get('job') as JobRecord | undefined;
    if (!job) return;
    const now = Date.now();

    if ((job.status === 'succeeded' || job.status === 'failed') && job.expiresAt && now >= job.expiresAt) {
      await this.state.storage.deleteAll();
      return;
    }

    if (job.status === 'running') {
      if (job.deadlineAt && now >= job.deadlineAt) {
        await this.markFailed(job, 'Background reconstruction exceeded the 8 minute runtime limit.', 'The background run timed out instead of hanging indefinitely');
        return;
      }

      const leaseExpiry = effectiveLeaseExpiry(job);
      if (leaseExpiry > now) {
        await this.state.storage.setAlarm(leaseExpiry);
        return;
      }

      const completedAttempts = job.attempt || 1;
      if (completedAttempts >= MAX_JOB_ATTEMPTS) {
        await this.markFailed(
          job,
          `Background runner heartbeat expired after ${completedAttempts} attempt(s).`,
          'The worker stopped responding and automatic recovery was exhausted',
        );
        return;
      }

      job = {
        ...job,
        status: 'queued',
        stage: 'Recovering stalled run',
        message: 'Worker heartbeat expired. Restarting the reconstruction once.',
        runToken: undefined,
        leaseExpiresAt: undefined,
      };
      await this.state.storage.put('job', job);
    }

    if (job.status !== 'queued') return;
    const input = await this.state.storage.get('input') as JobInput | undefined;
    if (!input) {
      await this.markFailed(job, 'Job input is missing', 'The background job cannot be resumed');
      return;
    }

    const startedNow = Date.now();
    const attempt = (job.attempt || 0) + 1;
    const runToken = crypto.randomUUID();
    let current: JobRecord = {
      ...job,
      status: 'running',
      stage: attempt > 1 ? 'Restarting reconstruction' : 'Starting reconstruction',
      progress: Math.max(1, job.progress || 0),
      message: attempt > 1 ? 'Recovering from an interrupted worker run' : 'Background runner started',
      startedAt: job.startedAt || new Date(startedNow).toISOString(),
      attempt,
      runToken,
      heartbeatAt: new Date(startedNow).toISOString(),
      leaseExpiresAt: startedNow + JOB_LEASE_MS,
      deadlineAt: job.deadlineAt || startedNow + JOB_HARD_TIMEOUT_MS,
    };
    await this.state.storage.put('job', current);
    await this.state.storage.setAlarm(startedNow + JOB_LEASE_MS);

    let heartbeatWriting = false;
    const heartbeat = async () => {
      if (heartbeatWriting) return;
      heartbeatWriting = true;
      try {
        const latest = await this.state.storage.get('job') as JobRecord | undefined;
        if (!latest || latest.status !== 'running' || latest.runToken !== runToken) return;
        const beat = Date.now();
        current = {
          ...latest,
          heartbeatAt: new Date(beat).toISOString(),
          leaseExpiresAt: beat + JOB_LEASE_MS,
        };
        await this.state.storage.put('job', current);
        await this.state.storage.setAlarm(beat + JOB_LEASE_MS);
      } finally {
        heartbeatWriting = false;
      }
    };

    const heartbeatTimer = setInterval(() => { void heartbeat(); }, JOB_HEARTBEAT_MS);

    const onProgress = async (update: ProgressUpdate) => {
      const latest = await this.state.storage.get('job') as JobRecord | undefined;
      if (!latest || latest.status !== 'running' || latest.runToken !== runToken) return;
      const beat = Date.now();
      current = {
        ...latest,
        stage: update.stage,
        progress: Math.max(latest.progress || 0, Math.min(100, Math.round(update.progress))),
        message: update.message,
        heartbeatAt: new Date(beat).toISOString(),
        leaseExpiresAt: beat + JOB_LEASE_MS,
      };
      await this.state.storage.put('job', current);
      await this.state.storage.setAlarm(beat + JOB_LEASE_MS);
    };

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = current.deadlineAt || (Date.now() + JOB_HARD_TIMEOUT_MS);
      const remaining = Math.max(1_000, deadline - Date.now());
      const timeout = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => reject(new Error('Background reconstruction exceeded the 8 minute runtime limit.')), remaining);
      });
      const result = await Promise.race([
        analyze(input.target, this.env, input.qualityRequested, input.userInstructions, onProgress),
        timeout,
      ]);

      const latest = await this.state.storage.get('job') as JobRecord | undefined;
      if (!latest || latest.status !== 'running' || latest.runToken !== runToken) return;
      await writeLargeResult(this.state.storage, result);
      const done: JobRecord = {
        ...latest,
        status: 'succeeded',
        stage: 'Complete',
        progress: 100,
        message: 'Verified reconstruction ready',
        heartbeatAt: new Date().toISOString(),
        leaseExpiresAt: undefined,
        runToken: undefined,
        finishedAt: new Date().toISOString(),
        expiresAt: Date.now() + JOB_TTL_MS,
      };
      await this.state.storage.put('job', done);
      await this.state.storage.setAlarm(Date.now() + JOB_TTL_MS);
    } catch (error) {
      const latest = await this.state.storage.get('job') as JobRecord | undefined;
      if (latest && latest.status === 'running' && latest.runToken === runToken) {
        await this.markFailed(
          latest,
          error instanceof Error ? error.message : 'Background reconstruction failed',
          'The reconstruction stopped with an explicit error instead of hanging',
        );
      }
    } finally {
      clearInterval(heartbeatTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }
}

function jobStub'''

    pattern = re.compile(r"export class GenerationJob \{.*?\n\}\n\nfunction jobStub", re.S)
    index, count = pattern.subn(new_job_runtime, index, count=1)
    if count != 1:
        raise RuntimeError(f'GenerationJob replacement: expected 1 match, found {count}')

    index = replace_once(
        index,
        "        jobRunner: 'durable-object-alarm',\n        jobTtlHours: 24,",
        "        jobRunner: 'durable-object-alarm+heartbeat-lease',\n        jobTtlHours: 24,\n        jobHeartbeatSeconds: JOB_HEARTBEAT_MS / 1000,\n        jobLeaseSeconds: JOB_LEASE_MS / 1000,\n        jobHardTimeoutMinutes: JOB_HARD_TIMEOUT_MS / 60_000,\n        maxJobAttempts: MAX_JOB_ATTEMPTS,",
        'health job recovery metadata',
    )

    index_path.write_text(index, encoding='utf-8')


main = main_path.read_text(encoding='utf-8')
if 'CLIENT_JOB_MAX_MS' not in main:
    main = replace_once(
        main,
        "  finishedAt?: string\n}",
        "  finishedAt?: string\n  attempt?: number\n  heartbeatAt?: string\n  leaseExpiresAt?: number\n  deadlineAt?: number\n}",
        'frontend JobStatus recovery fields',
    )
    main = replace_once(
        main,
        "const ACTIVE_JOB_KEY = 'get-set-go-active-job'",
        "const ACTIVE_JOB_KEY = 'get-set-go-active-job'\nconst CLIENT_JOB_MAX_MS = 10 * 60 * 1000\nconst CLIENT_HEARTBEAT_WARN_MS = 105 * 1000\nconst CLIENT_HEARTBEAT_FAIL_MS = 3 * 60 * 1000\n\nclass TerminalJobError extends Error {}\n\nfunction clearActiveJob() {\n  try { localStorage.removeItem(ACTIVE_JOB_KEY) } catch {}\n}",
        'frontend recovery constants',
    )

    old_poll = r'''  async function pollJob(jobId: string, isCancelled: () => boolean = () => false) {
    let transientFailures = 0

    while (!isCancelled()) {
      try {
        const statusData = await readJson(await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' }))
        const job = statusData.job
        if (!job) throw new Error('Background job returned no status')

        transientFailures = 0
        setJobProgress(job)
        setStatus(job.message ? `${job.stage} · ${job.message}` : job.stage)

        if (job.status === 'failed') {
          try { localStorage.removeItem(ACTIVE_JOB_KEY) } catch {}
          throw new Error(job.error || 'Background reconstruction failed')
        }

        if (job.status === 'succeeded') {
          const finalData = await readJson(await fetch(`/api/jobs/${jobId}?includeResult=1`, { cache: 'no-store' }))
          if (!finalData.result) throw new Error('The job completed but its result could not be loaded')
          try { localStorage.removeItem(ACTIVE_JOB_KEY) } catch {}
          setJobProgress(finalData.job || job)
          finishWithResult(finalData.result)
          return
        }
      } catch (error) {
        transientFailures += 1
        if (transientFailures >= 5) throw error
        setStatus('Background job is still running · reconnecting…')
      }

      await sleep(1500)
    }
  }'''

    new_poll = r'''  async function pollJob(jobId: string, isCancelled: () => boolean = () => false) {
    let transientFailures = 0
    const clientStartedAt = Date.now()

    while (!isCancelled()) {
      try {
        const statusData = await readJson(await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' }))
        const job = statusData.job
        if (!job) throw new Error('Background job returned no status')

        transientFailures = 0
        setJobProgress(job)

        const createdAt = job.createdAt ? Date.parse(job.createdAt) : clientStartedAt
        const hardDeadline = job.deadlineAt || ((Number.isFinite(createdAt) ? createdAt : clientStartedAt) + CLIENT_JOB_MAX_MS)
        if (Date.now() > hardDeadline + 60_000) {
          clearActiveJob()
          throw new TerminalJobError('Background job exceeded its runtime limit and was stopped. Please start a fresh run.')
        }

        if (job.status === 'running' && job.heartbeatAt) {
          const heartbeatAge = Date.now() - Date.parse(job.heartbeatAt)
          if (Number.isFinite(heartbeatAge) && heartbeatAge > CLIENT_HEARTBEAT_FAIL_MS) {
            clearActiveJob()
            throw new TerminalJobError('Background runner stopped responding. The stuck job was cleared instead of polling forever.')
          }
          if (Number.isFinite(heartbeatAge) && heartbeatAge > CLIENT_HEARTBEAT_WARN_MS) {
            setStatus('Runner heartbeat delayed · automatic recovery is starting…')
          } else {
            setStatus(job.message ? `${job.stage} · ${job.message}` : job.stage)
          }
        } else {
          setStatus(job.message ? `${job.stage} · ${job.message}` : job.stage)
        }

        if (job.status === 'failed') {
          clearActiveJob()
          throw new TerminalJobError(job.error || 'Background reconstruction failed')
        }

        if (job.status === 'succeeded') {
          const finalData = await readJson(await fetch(`/api/jobs/${jobId}?includeResult=1`, { cache: 'no-store' }))
          if (!finalData.result) {
            clearActiveJob()
            throw new TerminalJobError('The job completed but its result could not be loaded')
          }
          clearActiveJob()
          setJobProgress(finalData.job || job)
          finishWithResult(finalData.result)
          return
        }
      } catch (error) {
        if (error instanceof TerminalJobError) throw error
        transientFailures += 1
        if (transientFailures >= 5) {
          clearActiveJob()
          throw error
        }
        setStatus('Background service connection interrupted · reconnecting…')
      }

      await sleep(1500)
    }
  }'''

    main = replace_once(main, old_poll, new_poll, 'frontend pollJob')
    main_path.write_text(main, encoding='utf-8')

print('job recovery patch applied')
