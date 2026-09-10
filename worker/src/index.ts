import { launch, type BrowserWorker } from '@cloudflare/playwright';
import { runQualityPipeline } from './ai';
import { buildComponentPlan, buildDesignIR, buildGeneratedPreview, type Signal } from './design';

interface Env {
  BROWSER: BrowserWorker;
  FRONTEND_ORIGIN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

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

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function screenshotDataUrl(page: any) {
  const shot = await page.screenshot({ type: 'jpeg', quality: 78, fullPage: false, animations: 'disabled' });
  const bytes = shot instanceof Uint8Array ? shot : new Uint8Array(shot);
  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

async function extractSignals(page: any): Promise<Signal> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    const visible = all.filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    });

    const top = (values: string[], limit = 10) => {
      const counts = new Map<string, number>();
      for (const raw of values) {
        const value = String(raw || '').trim();
        if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)' || value === '0px') continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
    };

    const sample = visible.slice(0, 900).map((el) => {
      const s = getComputedStyle(el);
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        color: s.color,
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
        gap: s.gap,
      };
    });

    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 36).map((el) => {
      const node = el as HTMLElement;
      const r = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return {
        tag: node.tagName,
        text: (node.innerText || '').trim().slice(0, 220),
        box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
      };
    });

    const landmarks = Array.from(document.querySelectorAll('header,nav,main,section,aside,footer'))
      .slice(0, 120)
      .map((el) => {
        const node = el as HTMLElement;
        const r = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          ariaLabel: node.getAttribute('aria-label'),
          id: node.id || null,
          classHint: String(node.className || '').slice(0, 120),
          box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        };
      });

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      visibleElementCount: visible.length,
      tokens: {
        fonts: top(sample.map((x) => x.fontFamily), 8),
        fontSizes: top(sample.map((x) => x.fontSize), 14),
        fontWeights: top(sample.map((x) => x.fontWeight), 10),
        textColors: top(sample.map((x) => x.color), 14),
        backgrounds: top(sample.map((x) => x.backgroundColor), 14),
        radii: top(sample.map((x) => x.borderRadius), 12),
        gaps: top(sample.map((x) => x.gap), 12),
      },
      headings,
      landmarks,
    };
  });
}

async function captureVisualEvidence(page: any, name: string, signal: Signal) {
  const images: Array<{ label: string; dataUrl: string; detail: 'high' | 'auto' }> = [];
  if (name !== 'desktop' && name !== 'mobile') return images;

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(120);
  images.push({ label: `${name} top viewport`, dataUrl: await screenshotDataUrl(page), detail: 'high' });

  const maxScroll = Math.max(0, signal.page.height - signal.viewport.height);
  if (maxScroll > signal.viewport.height * 1.4) {
    const middle = Math.round(maxScroll * 0.48);
    await page.evaluate((y: number) => window.scrollTo(0, y), middle);
    await page.waitForTimeout(120);
    images.push({ label: `${name} middle viewport`, dataUrl: await screenshotDataUrl(page), detail: name === 'desktop' ? 'high' : 'auto' });
  }

  if (name === 'desktop' && maxScroll > signal.viewport.height * 3) {
    const lower = Math.round(maxScroll * 0.88);
    await page.evaluate((y: number) => window.scrollTo(0, y), lower);
    await page.waitForTimeout(120);
    images.push({ label: 'desktop lower viewport', dataUrl: await screenshotDataUrl(page), detail: 'auto' });
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  return images;
}

async function analyze(target: string, env: Env, qualityRequested: boolean) {
  const browser = await launch(env.BROWSER);
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36 GetSetGo/0.4',
    });
    const page = await context.newPage();
    const breakpoints: Record<string, Signal> = {};
    const images: Array<{ label: string; dataUrl: string; detail: 'high' | 'auto' }> = [];

    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(700);
      const signal = await extractSignals(page);
      breakpoints[name] = signal;
      if (qualityRequested && env.OPENAI_API_KEY) images.push(...await captureVisualEvidence(page, name, signal));
    }

    const designIR = buildDesignIR(breakpoints);
    const componentPlan = buildComponentPlan(designIR, breakpoints.desktop);
    const deterministicPreview = buildGeneratedPreview(designIR, componentPlan, breakpoints.desktop);

    let quality: any = null;
    let qualityError: string | null = null;

    if (qualityRequested && env.OPENAI_API_KEY) {
      try {
        quality = await runQualityPipeline(env, {
          target,
          designIR,
          componentPlan,
          semanticEvidence: {
            desktop: { title: breakpoints.desktop.title, headings: breakpoints.desktop.headings, landmarks: breakpoints.desktop.landmarks },
            tablet: { headings: breakpoints.tablet.headings.slice(0, 18), landmarks: breakpoints.tablet.landmarks.slice(0, 50) },
            mobile: { headings: breakpoints.mobile.headings.slice(0, 18), landmarks: breakpoints.mobile.landmarks.slice(0, 50) },
          },
          images,
        });
      } catch (error) {
        qualityError = error instanceof Error ? error.message : 'Quality pipeline failed';
      }
    }

    const generatedPreview = quality?.generated?.previewHtml
      ? {
          version: '0.4.0',
          mode: 'ai-quality-preview',
          html: quality.generated.previewHtml,
          sandboxRecommended: true,
          aiCalls: quality.aiCalls,
          note: quality.generated.summary,
        }
      : deterministicPreview;

    return {
      version: '0.4.0',
      target,
      generatedAt: new Date().toISOString(),
      policy: {
        qualityRequested,
        qualityMode: quality ? 'ai-quality-first' : 'deterministic-fallback',
        aiConfigured: Boolean(env.OPENAI_API_KEY),
        aiCalls: quality?.aiCalls || 0,
        model: quality?.model || (env.OPENAI_MODEL || 'gpt-5.6-sol'),
        rawDomReturned: false,
        screenshotEmbeddedInResponse: false,
      },
      breakpoints,
      designIR,
      componentPlan,
      generatedPreview,
      visualSpec: quality?.visualSpec || null,
      generatedFiles: quality?.generated ? {
        appTsx: quality.generated.appTsx,
        stylesCss: quality.generated.stylesCss,
      } : null,
      qualityNotes: quality?.generated?.qualityNotes || [],
      qualityError,
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
      return json(env, {
        ok: true,
        service: 'get-set-go-api',
        browser: 'cloudflare-browser-run',
        pipeline: 'quality-first visual architect v0.4',
        aiConfigured: Boolean(env.OPENAI_API_KEY),
        model: env.OPENAI_MODEL || 'gpt-5.6-sol',
      });
    }

    if (reqUrl.pathname === '/analyze' && request.method === 'POST') {
      try {
        const body = await request.json() as { url?: unknown; quality?: unknown };
        const target = normalizeTarget(body.url);
        const qualityRequested = body.quality !== false;
        return json(env, await analyze(target, env, qualityRequested));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Analysis failed';
        return json(env, { ok: false, error: message }, 400);
      }
    }

    return json(env, {
      ok: true,
      service: 'get-set-go-api',
      endpoints: { health: 'GET /health', analyze: 'POST /analyze { url, quality? }' },
    });
  },
} satisfies ExportedHandler<Env>;
