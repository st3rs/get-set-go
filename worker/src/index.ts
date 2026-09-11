import { launch, type BrowserWorker } from '@cloudflare/playwright';
import { aiConfigured, selectAi, type AiEnv } from './ai-client';
import { runQualityPipeline } from './ai';
import { runVisualCritic } from './critic';
import { buildComponentPlan, buildDesignIR, buildGeneratedPreview, type Signal } from './design';
import { extractRichSignals } from './evidence';

interface Env extends AiEnv {
  BROWSER: BrowserWorker;
  JOBS: any;
  FRONTEND_ORIGIN?: string;
}

type UserInstructions = {
  main: string;
  steps: string[];
};

type ProgressUpdate = {
  stage: string;
  progress: number;
  message?: string;
};

type JobInput = {
  target: string;
  qualityRequested: boolean;
  userInstructions: UserInstructions;
};

type JobRecord = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string;
  progress: number;
  message?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  expiresAt?: number;
  error?: string;
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

const MAX_CRITIC_PASSES = 3;
const QUALITY_THRESHOLD = 92;
const MAX_INSTRUCTION_STEPS = 8;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const RESULT_CHUNK_CHARS = 48_000;

function cors(env: Env) {
  return {
    'Access-Control-Allow-Origin': env.FRONTEND_ORIGIN || 'https://get-set-go.pages.dev',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

function json(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...cors(env),
    },
  });
}

function blockedHost(hostname: string) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (h === '0.0.0.0' || h === 'metadata.google.internal') return true;
  return false;
}

function normalizeTarget(input: unknown) {
  if (typeof input !== 'string' || input.length < 4 || input.length > 2048) throw new Error('Invalid URL');
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public http/https URLs are allowed');
  if (blockedHost(url.hostname)) throw new Error('Private or local targets are not allowed');
  url.username = '';
  url.password = '';
  return url.toString();
}

function normalizeInstructions(mainRaw: unknown, stepsRaw: unknown): UserInstructions {
  const main = typeof mainRaw === 'string' ? mainRaw.trim().slice(0, 6000) : '';
  const steps = Array.isArray(stepsRaw)
    ? stepsRaw
        .slice(0, MAX_INSTRUCTION_STEPS)
        .filter((step): step is string => typeof step === 'string')
        .map((step) => step.trim().slice(0, 4000))
        .filter(Boolean)
    : [];

  let remaining = 16000 - main.length;
  const boundedSteps: string[] = [];
  for (const step of steps) {
    if (remaining <= 0) break;
    const bounded = step.slice(0, remaining);
    if (bounded) boundedSteps.push(bounded);
    remaining -= bounded.length;
  }
  return { main, steps: boundedSteps };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function screenshotDataUrl(page: any) {
  const shot = await page.screenshot({ type: 'jpeg', quality: 82, fullPage: false, animations: 'disabled' });
  const bytes = shot instanceof Uint8Array ? shot : new Uint8Array(shot);
  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

async function captureVisualEvidence(page: any, name: string, signal: Signal) {
  const images: Array<{ label: string; dataUrl: string; detail: 'high' | 'auto' }> = [];
  if (name !== 'desktop' && name !== 'mobile') return images;

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(160);
  images.push({ label: `${name} top viewport`, dataUrl: await screenshotDataUrl(page), detail: 'high' });

  const maxScroll = Math.max(0, signal.page.height - signal.viewport.height);
  if (maxScroll > signal.viewport.height * 1.15) {
    const middle = Math.round(maxScroll * 0.48);
    await page.evaluate((y: number) => window.scrollTo(0, y), middle);
    await page.waitForTimeout(160);
    images.push({ label: `${name} middle viewport`, dataUrl: await screenshotDataUrl(page), detail: name === 'desktop' ? 'high' : 'auto' });
  }

  if (name === 'desktop' && maxScroll > signal.viewport.height * 2.2) {
    const lower = Math.round(maxScroll * 0.88);
    await page.evaluate((y: number) => window.scrollTo(0, y), lower);
    await page.waitForTimeout(160);
    images.push({ label: 'desktop lower viewport', dataUrl: await screenshotDataUrl(page), detail: 'high' });
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  return images;
}

async function renderGeneratedEvidence(context: any, html: string) {
  const previewPage = await context.newPage();
  try {
    await previewPage.setViewportSize(VIEWPORTS.desktop);
    await previewPage.setContent(html, { waitUntil: 'domcontentloaded' });
    await previewPage.waitForTimeout(350);
    const desktop = await screenshotDataUrl(previewPage);

    await previewPage.setViewportSize(VIEWPORTS.mobile);
    await previewPage.setContent(html, { waitUntil: 'domcontentloaded' });
    await previewPage.waitForTimeout(350);
    const mobile = await screenshotDataUrl(previewPage);

    return { desktop, mobile };
  } finally {
    await previewPage.close();
  }
}

function semanticSlice(signal: Signal, elementLimit: number, landmarkLimit: number) {
  return {
    title: signal.title,
    headings: signal.headings.slice(0, 30),
    landmarks: signal.landmarks.slice(0, landmarkLimit),
    elements: (signal.elements || []).slice(0, elementLimit),
  };
}

async function analyze(
  target: string,
  env: Env,
  qualityRequested: boolean,
  userInstructions: UserInstructions,
  onProgress?: (update: ProgressUpdate) => Promise<void> | void,
) {
  const report = async (stage: string, progress: number, message?: string) => {
    if (onProgress) await onProgress({ stage, progress, message });
  };

  await report('Starting reconstruction', 2, 'Opening a browser session');
  const browser = await launch(env.BROWSER);
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36 GetSetGo/1.1',
    });
    const page = await context.newPage();
    const breakpoints: Record<string, Signal> = {};
    const images: Array<{ label: string; dataUrl: string; detail: 'high' | 'auto' }> = [];
    const configured = aiConfigured(env);
    const viewportEntries = Object.entries(VIEWPORTS);

    for (let i = 0; i < viewportEntries.length; i++) {
      const [name, viewport] = viewportEntries[i];
      await report(`Capturing ${name}`, 6 + i * 8, `Measuring the ${name} layout`);
      await page.setViewportSize(viewport);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(900);
      const signal = await extractRichSignals(page);
      breakpoints[name] = signal;
      if (qualityRequested && configured) images.push(...await captureVisualEvidence(page, name, signal));
    }

    await report('Mapping the interface', 31, 'Building responsive layout and component evidence');
    const designIR = buildDesignIR(breakpoints);
    const componentPlan = buildComponentPlan(designIR, breakpoints.desktop);
    const deterministicPreview = buildGeneratedPreview(designIR, componentPlan, breakpoints.desktop);

    let quality: any = null;
    let qualityError: string | null = null;
    let criticError: string | null = null;
    let critic: any = null;
    const criticHistory: any[] = [];

    if (qualityRequested && configured) {
      try {
        await report('Building the interface', 40, 'Resolving design rules, code and media');
        quality = await runQualityPipeline(env, {
          target,
          designIR,
          componentPlan,
          semanticEvidence: {
            desktop: semanticSlice(breakpoints.desktop, 220, 100),
            tablet: semanticSlice(breakpoints.tablet, 120, 70),
            mobile: semanticSlice(breakpoints.mobile, 160, 80),
          },
          images,
          userInstructions,
        });

        await report('Rendering the first draft', 70, 'Preparing visual comparison');
        const originalDesktop = images.find((x) => x.label === 'desktop top viewport')?.dataUrl;
        const originalMobile = images.find((x) => x.label === 'mobile top viewport')?.dataUrl;

        if (originalDesktop) {
          for (let pass = 1; pass <= MAX_CRITIC_PASSES; pass++) {
            try {
              await report(`Visual check ${pass} of ${MAX_CRITIC_PASSES}`, 72 + (pass - 1) * 8, 'Comparing the generated page with the reference');
              const rendered = await renderGeneratedEvidence(context, quality.generated.previewHtml);
              critic = await runVisualCritic(env, {
                target,
                visualSpec: quality.visualSpec,
                appTsx: quality.generated.appTsx,
                stylesCss: quality.generated.stylesCss,
                previewHtml: quality.generated.previewHtml,
                originalDesktop,
                generatedDesktop: rendered.desktop,
                originalMobile,
                generatedMobile: originalMobile ? rendered.mobile : undefined,
                userInstructions,
              });

              quality.aiCalls = (quality.aiCalls || 0) + 1;
              quality.models = { ...(quality.models || {}), critic: critic.model };
              criticHistory.push({ pass, score: critic.score, verdict: critic.verdict, issues: critic.issues });

              const passed = critic.verdict === 'pass' && Number(critic.score) >= QUALITY_THRESHOLD;
              if (passed) break;

              quality.generated = {
                ...quality.generated,
                appTsx: critic.revisedAppTsx,
                stylesCss: critic.revisedStylesCss,
                previewHtml: critic.revisedPreviewHtml,
                qualityNotes: [...(quality.generated.qualityNotes || []), ...(critic.notes || [])],
              };
            } catch (error) {
              criticError = error instanceof Error ? error.message : 'Visual critic failed';
              break;
            }
          }
        }
      } catch (error) {
        qualityError = error instanceof Error ? error.message : 'Quality pipeline failed';
      }
    }

    await report('Packaging the result', 96, 'Preparing editable code and preview');
    const criticPassed = Boolean(critic && critic.verdict === 'pass' && Number(critic.score) >= QUALITY_THRESHOLD);
    const generatedPreview = quality?.generated?.previewHtml
      ? {
          version: '1.1.0',
          mode: criticPassed ? 'guardrailed-verified-preview' : critic ? 'guardrailed-iterated-preview' : 'guardrailed-preview',
          html: quality.generated.previewHtml,
          sandboxRecommended: true,
          aiCalls: quality.aiCalls,
          note: quality.generated.summary,
        }
      : deterministicPreview;

    const selected = configured ? selectAi(env, 'architect') : null;
    const instructionCount = (userInstructions.main ? 1 : 0) + userInstructions.steps.length;

    const result = {
      version: '1.1.0',
      target,
      generatedAt: new Date().toISOString(),
      policy: {
        qualityRequested,
        qualityMode: quality ? 'guardrailed-reconstruction' : 'deterministic-fallback',
        aiConfigured: configured,
        aiCalls: quality?.aiCalls || 0,
        provider: quality?.provider || selected?.provider || null,
        model: quality?.model || selected?.model || null,
        models: quality?.models || null,
        imageModel: env.MODEL_API_KEY ? (env.MUSE_IMAGE_MODEL || 'muse-image-1.0') : null,
        imageAssetsGenerated: quality?.assets?.length || 0,
        qualityThreshold: QUALITY_THRESHOLD,
        criticPasses: criticHistory.length,
        qualityGate: criticPassed ? 'pass' : critic ? 'needs-improvement' : quality ? 'critic-unavailable' : 'not-run',
        instructionCount,
        instructionSteps: userInstructions.steps.length,
        designContract: quality ? 'tokens+component-spec+registry-routing' : null,
        rawDomReturned: false,
        screenshotEmbeddedInResponse: false,
      },
      breakpoints,
      designIR,
      componentPlan,
      designTokens: quality?.designTokens || null,
      componentSpec: quality?.componentSpec || null,
      registryPlan: quality?.registryPlan || null,
      tokenCssVariables: quality?.tokenCssVariables || null,
      generatedPreview,
      visualSpec: quality?.visualSpec || null,
      generatedAssets: quality?.assets || [],
      assetErrors: quality?.assetErrors || [],
      generatedFiles: quality?.generated ? {
        appTsx: quality.generated.appTsx,
        stylesCss: quality.generated.stylesCss,
      } : null,
      visualCritic: critic ? {
        score: critic.score,
        verdict: critic.verdict,
        issues: critic.issues,
        notes: critic.notes,
        provider: critic.provider,
        model: critic.model,
        history: criticHistory,
      } : null,
      qualityNotes: quality?.generated?.qualityNotes || [],
      qualityError,
      criticError,
    };

    await report('Complete', 100, 'Reconstruction ready');
    return result;
  } finally {
    await browser.close();
  }
}

async function clearResultChunks(storage: any) {
  const keys = await storage.list({ prefix: 'result:' });
  for (const key of keys.keys()) await storage.delete(key);
  await storage.delete('resultMeta');
}

async function writeLargeResult(storage: any, value: unknown) {
  await clearResultChunks(storage);
  const text = JSON.stringify(value);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += RESULT_CHUNK_CHARS) chunks.push(text.slice(i, i + RESULT_CHUNK_CHARS));
  for (let i = 0; i < chunks.length; i++) await storage.put(`result:${i}`, chunks[i]);
  await storage.put('resultMeta', { chunks: chunks.length, chars: text.length });
}

async function readLargeResult(storage: any) {
  const meta = await storage.get('resultMeta') as { chunks?: number } | undefined;
  if (!meta?.chunks) return null;
  let text = '';
  for (let i = 0; i < meta.chunks; i++) text += (await storage.get(`result:${i}`) as string | undefined) || '';
  return text ? JSON.parse(text) : null;
}

export class GenerationJob {
  constructor(private state: any, private env: Env) {}

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/start') {
      const payload = await request.json() as { jobId?: string; input?: JobInput };
      if (!payload.jobId || !payload.input) return json(this.env, { ok: false, error: 'Invalid job payload' }, 400);

      const existing = await this.state.storage.get('job') as JobRecord | undefined;
      if (existing) return json(this.env, { ok: true, job: existing }, 200);

      const job: JobRecord = {
        id: payload.jobId,
        status: 'queued',
        stage: 'Queued',
        progress: 0,
        message: 'Waiting for the background runner',
        createdAt: new Date().toISOString(),
      };
      await this.state.storage.put('job', job);
      await this.state.storage.put('input', payload.input);
      await this.state.storage.setAlarm(Date.now() + 50);
      return json(this.env, { ok: true, job }, 202);
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      const job = await this.state.storage.get('job') as JobRecord | undefined;
      if (!job) return json(this.env, { ok: false, error: 'Job not found' }, 404);
      const includeResult = url.searchParams.get('includeResult') === '1';
      const result = includeResult && job.status === 'succeeded' ? await readLargeResult(this.state.storage) : undefined;
      return json(this.env, { ok: true, job, ...(includeResult ? { result } : {}) });
    }

    return json(this.env, { ok: false, error: 'Job route not found' }, 404);
  }

  async alarm() {
    const job = await this.state.storage.get('job') as JobRecord | undefined;
    if (!job) return;

    if ((job.status === 'succeeded' || job.status === 'failed') && job.expiresAt && Date.now() >= job.expiresAt) {
      await this.state.storage.deleteAll();
      return;
    }

    if (job.status !== 'queued') return;
    const input = await this.state.storage.get('input') as JobInput | undefined;
    if (!input) {
      await this.state.storage.put('job', {
        ...job,
        status: 'failed',
        stage: 'Failed',
        error: 'Job input is missing',
        finishedAt: new Date().toISOString(),
        expiresAt: Date.now() + JOB_TTL_MS,
      });
      await this.state.storage.setAlarm(Date.now() + JOB_TTL_MS);
      return;
    }

    let current: JobRecord = {
      ...job,
      status: 'running',
      stage: 'Starting reconstruction',
      progress: 1,
      startedAt: new Date().toISOString(),
    };
    await this.state.storage.put('job', current);

    const onProgress = async (update: ProgressUpdate) => {
      current = {
        ...current,
        status: 'running',
        stage: update.stage,
        progress: Math.max(current.progress, Math.min(100, Math.round(update.progress))),
        message: update.message,
      };
      await this.state.storage.put('job', current);
    };

    try {
      const result = await analyze(input.target, this.env, input.qualityRequested, input.userInstructions, onProgress);
      await writeLargeResult(this.state.storage, result);
      current = {
        ...current,
        status: 'succeeded',
        stage: 'Complete',
        progress: 100,
        message: 'Reconstruction ready',
        finishedAt: new Date().toISOString(),
        expiresAt: Date.now() + JOB_TTL_MS,
      };
      await this.state.storage.put('job', current);
    } catch (error) {
      current = {
        ...current,
        status: 'failed',
        stage: 'Failed',
        message: 'The background run stopped before completion',
        error: error instanceof Error ? error.message : 'Background reconstruction failed',
        finishedAt: new Date().toISOString(),
        expiresAt: Date.now() + JOB_TTL_MS,
      };
      await this.state.storage.put('job', current);
    } finally {
      await this.state.storage.setAlarm(Date.now() + JOB_TTL_MS);
    }
  }
}

function jobStub(env: Env, jobId: string) {
  const id = env.JOBS.idFromName(jobId);
  return env.JOBS.get(id);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    const reqUrl = new URL(request.url);

    if (reqUrl.pathname === '/health') {
      const configured = aiConfigured(env);
      const selected = configured ? selectAi(env, 'architect') : null;
      return json(env, {
        ok: true,
        service: 'get-set-go-api',
        browser: 'cloudflare-browser-run',
        pipeline: 'durable background jobs + guardrailed design engine + iterative visual QA v1.1',
        architecture: 'Phase B + async jobs',
        jobRunner: 'durable-object-alarm',
        jobTtlHours: 24,
        designContract: 'tokens+component-spec+registry-routing',
        registryTiers: ['strict', 'parametric', 'escape'],
        aiConfigured: configured,
        provider: selected?.provider || null,
        model: selected?.model || null,
        imageModel: env.MODEL_API_KEY ? (env.MUSE_IMAGE_MODEL || 'muse-image-1.0') : null,
        qualityThreshold: QUALITY_THRESHOLD,
        maxCriticPasses: MAX_CRITIC_PASSES,
        maxInstructionSteps: MAX_INSTRUCTION_STEPS,
      });
    }

    if (reqUrl.pathname === '/jobs' && request.method === 'POST') {
      try {
        const body = await request.json() as { url?: unknown; quality?: unknown; prompt?: unknown; steps?: unknown };
        const target = normalizeTarget(body.url);
        const qualityRequested = body.quality !== false;
        const userInstructions = normalizeInstructions(body.prompt, body.steps);
        const jobId = crypto.randomUUID();
        const input: JobInput = { target, qualityRequested, userInstructions };
        const stub = jobStub(env, jobId);
        const upstream = await stub.fetch(new Request('https://job/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId, input }),
        }));
        if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
        return json(env, {
          ok: true,
          jobId,
          status: 'queued',
          statusUrl: `/jobs/${jobId}`,
        }, 202);
      } catch (error) {
        return json(env, { ok: false, error: error instanceof Error ? error.message : 'Could not create job' }, 400);
      }
    }

    const jobMatch = reqUrl.pathname.match(/^\/jobs\/([0-9a-f-]{36})$/i);
    if (jobMatch && request.method === 'GET') {
      const jobId = jobMatch[1];
      const includeResult = reqUrl.searchParams.get('includeResult') === '1';
      const stub = jobStub(env, jobId);
      return stub.fetch(new Request(`https://job/status?includeResult=${includeResult ? '1' : '0'}`));
    }

    if (reqUrl.pathname === '/analyze' && request.method === 'POST') {
      try {
        const body = await request.json() as { url?: unknown; quality?: unknown; prompt?: unknown; steps?: unknown };
        const target = normalizeTarget(body.url);
        const qualityRequested = body.quality !== false;
        const userInstructions = normalizeInstructions(body.prompt, body.steps);
        return json(env, await analyze(target, env, qualityRequested, userInstructions));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Analysis failed';
        return json(env, { ok: false, error: message }, 400);
      }
    }

    return json(env, {
      ok: true,
      service: 'get-set-go-api',
      endpoints: {
        health: 'GET /health',
        createJob: 'POST /jobs { url, quality?, prompt?, steps? }',
        jobStatus: 'GET /jobs/:id?includeResult=1',
        analyzeLegacy: 'POST /analyze { url, quality?, prompt?, steps? }',
      },
    });
  },
} satisfies ExportedHandler<Env>;
