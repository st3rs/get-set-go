import { launch, type BrowserWorker } from '@cloudflare/playwright';

interface Env {
  BROWSER: BrowserWorker;
  FRONTEND_ORIGIN?: string;
}

type Signal = {
  title: string;
  url: string;
  viewport: { width: number; height: number };
  page: { width: number; height: number };
  visibleElementCount: number;
  tokens: Record<string, Array<{ value: string; count: number }>>;
  headings: Array<any>;
  landmarks: Array<any>;
};

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

    const sample = visible.slice(0, 600).map((el) => {
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

    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 24).map((el) => {
      const node = el as HTMLElement;
      const r = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return {
        tag: node.tagName,
        text: (node.innerText || '').trim().slice(0, 180),
        box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
      };
    });

    const landmarks = Array.from(document.querySelectorAll('header,nav,main,section,aside,footer'))
      .slice(0, 80)
      .map((el) => {
        const node = el as HTMLElement;
        const r = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          ariaLabel: node.getAttribute('aria-label'),
          id: node.id || null,
          classHint: String(node.className || '').slice(0, 100),
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
        fontSizes: top(sample.map((x) => x.fontSize), 12),
        fontWeights: top(sample.map((x) => x.fontWeight), 10),
        textColors: top(sample.map((x) => x.color), 12),
        backgrounds: top(sample.map((x) => x.backgroundColor), 12),
        radii: top(sample.map((x) => x.borderRadius), 10),
        gaps: top(sample.map((x) => x.gap), 10),
      },
      headings,
      landmarks,
    };
  });
}

function firstValues(list: Array<{ value: string; count: number }> = [], max = 8) {
  return list.slice(0, max).map((x) => x.value);
}

function inferSiteType(signal: Signal) {
  const title = signal.title.toLowerCase();
  const headingText = signal.headings.map((h) => String(h.text || '')).join(' ').toLowerCase();
  const text = `${title} ${headingText}`;
  if (/shop|store|cart|checkout|product/.test(text)) return 'commerce';
  if (/dashboard|analytics|workspace|admin/.test(text)) return 'dashboard';
  if (/blog|news|article|stories/.test(text)) return 'content';
  if (/pricing|product|platform|software|system|developer|team/.test(text)) return 'saas';
  return 'landing';
}

function buildRegions(signal: Signal) {
  const seen = new Set<string>();
  return signal.landmarks
    .filter((x) => x.box.width > 0 && x.box.height > 0)
    .map((x, index) => {
      const raw = x.ariaLabel || x.id || x.classHint || `${x.tag}-${index + 1}`;
      const id = String(raw).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `${x.tag}-${index + 1}`;
      const unique = seen.has(id) ? `${id}-${index + 1}` : id;
      seen.add(unique);
      return { id: unique, type: x.tag, box: x.box };
    })
    .slice(0, 32);
}

function buildDesignIR(breakpoints: Record<string, Signal>) {
  const desktop = breakpoints.desktop;
  const tablet = breakpoints.tablet;
  const mobile = breakpoints.mobile;
  const regions = buildRegions(desktop);
  const regionTypes = [...new Set(regions.map((r) => r.type))];
  const components = [
    regionTypes.includes('nav') ? 'Navigation' : null,
    regionTypes.includes('header') ? 'Header' : null,
    desktop.headings.some((h) => h.tag === 'H1') ? 'HeroOrPrimaryHeading' : null,
    regionTypes.includes('section') ? 'SectionGroup' : null,
    regionTypes.includes('aside') ? 'Aside' : null,
    regionTypes.includes('footer') ? 'Footer' : null,
  ].filter(Boolean);

  const desktopWidth = desktop.viewport.width || 1;
  const contentBoxes = regions.filter((r) => r.type === 'main' || r.type === 'section');
  const widest = contentBoxes.reduce((max, r) => Math.max(max, r.box.width), 0);
  const maxContentWidth = widest > 0 ? widest : desktop.page.width;

  const mobileStructuralDelta = Math.abs((desktop.landmarks?.length || 0) - (mobile.landmarks?.length || 0));
  const tabletStructuralDelta = Math.abs((desktop.landmarks?.length || 0) - (tablet.landmarks?.length || 0));

  return {
    version: '0.2.0',
    generatedBy: 'deterministic-browser-analysis',
    siteType: inferSiteType(desktop),
    layout: {
      viewportWidth: desktopWidth,
      pageHeight: desktop.page.height,
      maxContentWidth,
      maxContentRatio: Number((maxContentWidth / desktopWidth).toFixed(3)),
      regionCount: regions.length,
      density: desktop.visibleElementCount > 3000 ? 'high' : desktop.visibleElementCount > 1200 ? 'medium' : 'low',
    },
    tokens: {
      fontFamilies: firstValues(desktop.tokens.fonts, 6),
      fontSizes: firstValues(desktop.tokens.fontSizes, 10),
      fontWeights: firstValues(desktop.tokens.fontWeights, 8),
      textColors: firstValues(desktop.tokens.textColors, 10),
      backgrounds: firstValues(desktop.tokens.backgrounds, 10),
      radii: firstValues(desktop.tokens.radii, 8),
      gaps: firstValues(desktop.tokens.gaps, 8),
    },
    typography: {
      headings: desktop.headings.slice(0, 12).map((h) => ({
        level: h.tag,
        text: h.text,
        fontSize: h.fontSize,
        fontWeight: h.fontWeight,
        lineHeight: h.lineHeight,
        box: h.box,
      })),
    },
    regions,
    components,
    responsive: {
      desktop: { viewport: desktop.viewport, page: desktop.page, visibleElements: desktop.visibleElementCount },
      tablet: { viewport: tablet.viewport, page: tablet.page, visibleElements: tablet.visibleElementCount, structuralDelta: tabletStructuralDelta },
      mobile: { viewport: mobile.viewport, page: mobile.page, visibleElements: mobile.visibleElementCount, structuralDelta: mobileStructuralDelta },
      likelyResponsiveReflow: mobile.page.height !== desktop.page.height || mobileStructuralDelta > 0,
    },
    uncertainty: [
      'No visual-model interpretation used',
      'Interactive states, animation timing, pseudo-elements and canvas/WebGL visuals are not semantically interpreted yet',
      'Component names are inferred from structural HTML landmarks, not source framework components',
    ],
  };
}

async function analyze(target: string, env: Env) {
  const browser = await launch(env.BROWSER);
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36 GetSetGo/0.2',
    });
    const page = await context.newPage();
    const breakpoints: Record<string, Signal> = {};

    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(350);
      breakpoints[name] = await extractSignals(page);
    }

    const designIR = buildDesignIR(breakpoints);

    return {
      version: '0.2.0',
      target,
      generatedAt: new Date().toISOString(),
      policy: { vision: 'off-by-default', rawDomReturned: false, screenshotEmbedded: false, aiCalls: 0 },
      breakpoints,
      designIR,
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
      return json(env, { ok: true, service: 'get-set-go-api', browser: 'cloudflare-browser-run', designIR: 'deterministic-v0.2' });
    }

    if (reqUrl.pathname === '/analyze' && request.method === 'POST') {
      try {
        const body = await request.json() as { url?: unknown };
        const target = normalizeTarget(body.url);
        const result = await analyze(target, env);
        return json(env, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Analysis failed';
        return json(env, { ok: false, error: message }, 400);
      }
    }

    return json(env, {
      ok: true,
      service: 'get-set-go-api',
      endpoints: { health: 'GET /health', analyze: 'POST /analyze { url }' },
    });
  },
} satisfies ExportedHandler<Env>;
