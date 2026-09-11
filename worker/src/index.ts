import { launch, type BrowserWorker } from '@cloudflare/playwright';
import { aiConfigured, selectAi, type AiEnv } from './ai-client';
import { runQualityPipeline } from './ai';
import { runVisualCritic } from './critic';
import { buildComponentPlan, buildDesignIR, buildGeneratedPreview, type Signal } from './design';
import { extractRichSignals } from './evidence';

interface Env extends AiEnv {
  BROWSER: BrowserWorker;
  FRONTEND_ORIGIN?: string;
}

type UserInstructions = {
  main: string;
  steps: string[];
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

const MAX_CRITIC_PASSES = 3;
const QUALITY_THRESHOLD = 92;
const MAX_INSTRUCTION_STEPS = 8;

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
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(env) },
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

async function analyze(target: string, env: Env, qualityRequested: boolean, userInstructions: UserInstructions) {
  const browser = await launch(env.BROWSER);
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36 GetSetGo/1.0',
    });
    const page = await context.newPage();
    const breakpoints: Record<string, Signal> = {};
    const images: Array<{ label: string; dataUrl: string; detail: 'high' | 'auto' }> = [];
    const configured = aiConfigured(env);

    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(900);
      const signal = await extractRichSignals(page);
      breakpoints[name] = signal;
      if (qualityRequested && configured) images.push(...await captureVisualEvidence(page, name, signal));
    }

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

        const originalDesktop = images.find((x) => x.label === 'desktop top viewport')?.dataUrl;
        const originalMobile = images.find((x) => x.label === 'mobile top viewport')?.dataUrl;

        if (originalDesktop) {
          for (let pass = 1; pass <= MAX_CRITIC_PASSES; pass++) {
            try {
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

    const criticPassed = Boolean(critic && critic.verdict === 'pass' && Number(critic.score) >= QUALITY_THRESHOLD);
    const generatedPreview = quality?.generated?.previewHtml
      ? {
          version: '1.0.0',
          mode: criticPassed ? 'guardrailed-verified-preview' : critic ? 'guardrailed-iterated-preview' : 'guardrailed-preview',
          html: quality.generated.previewHtml,
          sandboxRecommended: true,
          aiCalls: quality.aiCalls,
          note: quality.generated.summary,
        }
      : deterministicPreview;

    const selected = configured ? selectAi(env, 'architect') : null;
    const instructionCount = (userInstructions.main ? 1 : 0) + userInstructions.steps.length;

    return {
      version: '1.0.0',
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
  } finally {
    await browser.close();
  }
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
        pipeline: 'guardrailed design contracts + component registry + iterative critic v1.0',
        architecture: 'Phase B',
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
      endpoints: { health: 'GET /health', analyze: 'POST /analyze { url, quality?, prompt?, steps? }' },
    });
  },
} satisfies ExportedHandler<Env>;
