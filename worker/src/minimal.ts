import { launch, type BrowserWorker } from '@cloudflare/playwright';

type MinimalEnv = {
  BROWSER: BrowserWorker;
  MODEL_API_KEY?: string;
  MUSE_SPARK_MODEL?: string;
  MUSE_IMAGE_MODEL?: string;
};

type SparkPlan = {
  summary: string;
  structure: {
    pageType: string;
    sections: Array<{ kind: string; label: string; evidence: string }>;
    typography: string[];
    colors: string[];
    layoutNotes: string[];
  };
  imagePrompt: string;
  html: string;
  css: string;
};

type ImageResult = {
  base64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLengthEstimate: number;
};

const META_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
const SPARK_TIMEOUT_MS = 150_000;
const IMAGE_TIMEOUT_MS = 120_000;
const IMAGE_MARKER = '{{GENERATED_IMAGE}}';

const SPARK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    structure: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pageType: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string' },
              label: { type: 'string' },
              evidence: { type: 'string' },
            },
            required: ['kind', 'label', 'evidence'],
          },
        },
        typography: { type: 'array', items: { type: 'string' } },
        colors: { type: 'array', items: { type: 'string' } },
        layoutNotes: { type: 'array', items: { type: 'string' } },
      },
      required: ['pageType', 'sections', 'typography', 'colors', 'layoutNotes'],
    },
    imagePrompt: { type: 'string' },
    html: { type: 'string' },
    css: { type: 'string' },
  },
  required: ['summary', 'structure', 'imagePrompt', 'html', 'css'],
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  }
  return btoa(binary);
}

function detectMimeFromBase64(base64: string): ImageResult['mimeType'] {
  const prefix = atob(base64.slice(0, 32));
  const bytes = Array.from(prefix, (char) => char.charCodeAt(0));
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (prefix.slice(0, 4) === 'RIFF' && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Muse Image returned bytes with an unknown image signature');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Upstream request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requireMetaKey(env: MinimalEnv) {
  if (!env.MODEL_API_KEY) throw new Error('MODEL_API_KEY is not configured');
  return env.MODEL_API_KEY;
}

// Spark path. It never calls the image model and never carries image-generation tools.
async function sparkRequest(env: MinimalEnv, input: Array<Record<string, unknown>>) {
  const apiKey = requireMetaKey(env);
  const model = env.MUSE_SPARK_MODEL || 'muse-spark-1.3';
  const response = await fetchWithTimeout(META_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: input }],
      text: {
        format: {
          type: 'json_schema',
          name: 'minimal_rebuild',
          strict: true,
          schema: SPARK_SCHEMA,
        },
      },
    }),
  }, SPARK_TIMEOUT_MS);

  const raw = await response.text();
  if (!response.ok) throw new Error(`Spark ${model} HTTP ${response.status}: ${raw.slice(0, 1000)}`);
  const payload = JSON.parse(raw);
  const outputText = typeof payload.output_text === 'string'
    ? payload.output_text
    : (payload.output || [])
      .flatMap((item: any) => item?.content || [])
      .filter((item: any) => item?.type === 'output_text')
      .map((item: any) => item.text || '')
      .join('\n');
  if (!outputText) throw new Error('Spark returned no output_text');

  let plan: SparkPlan;
  try {
    plan = JSON.parse(outputText) as SparkPlan;
  } catch {
    throw new Error(`Spark returned non-JSON output: ${outputText.slice(0, 500)}`);
  }
  if (!plan.html || !plan.css || !plan.imagePrompt || !plan.structure) throw new Error('Spark JSON is missing required fields');
  return { model, plan, rawResponseBytes: raw.length };
}

// Muse Image path. It receives only model + input. No tools, text schema, or reasoning options.
async function museImageRequest(env: MinimalEnv, prompt: string) {
  const apiKey = requireMetaKey(env);
  const model = env.MUSE_IMAGE_MODEL || 'muse-image-1.0';
  const response = await fetchWithTimeout(META_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, input: prompt }),
  }, IMAGE_TIMEOUT_MS);

  const raw = await response.text();
  if (!response.ok) throw new Error(`Muse Image ${model} HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const payload = JSON.parse(raw);

  let base64 = '';
  for (const item of payload?.output || []) {
    if (item?.type === 'image_generation_call' && typeof item.result === 'string') {
      base64 = item.result;
      break;
    }
    for (const content of item?.content || []) {
      if (content?.type === 'image_generation_call' && typeof content.result === 'string') {
        base64 = content.result;
        break;
      }
    }
    if (base64) break;
  }
  if (!base64) throw new Error(`Muse Image ${model} returned no image_generation_call.result`);

  const mimeType = detectMimeFromBase64(base64);
  return {
    model,
    image: {
      base64,
      mimeType,
      byteLengthEstimate: Math.floor((base64.length * 3) / 4),
    } satisfies ImageResult,
    rawResponseBytes: raw.length,
  };
}

function normalizeUrl(raw: unknown) {
  if (typeof raw !== 'string') throw new Error('url is required');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public http/https URLs are supported');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) {
    throw new Error('Private/local URLs are not allowed');
  }
  return url.toString();
}

async function captureReference(env: MinimalEnv, target: string) {
  const browser = await launch(env.BROWSER);
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36 GetSetGo-Minimal/1.0',
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(900);

    const captured = await page.evaluate(() => ({
      title: document.title,
      html: document.documentElement.outerHTML.slice(0, 60_000),
      text: (document.body?.innerText || '').slice(0, 16_000),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: {
        width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
      },
    }));

    const shot = await page.screenshot({ type: 'jpeg', quality: 82, fullPage: false, animations: 'disabled' });
    const bytes = shot instanceof Uint8Array ? shot : new Uint8Array(shot);
    return {
      ...captured,
      screenshotDataUrl: `data:image/jpeg;base64,${bytesToBase64(bytes)}`,
      screenshotBytes: bytes.byteLength,
    };
  } finally {
    await browser.close();
  }
}

function assembleHtml(plan: SparkPlan, imageDataUrl: string) {
  const html = plan.html.includes(IMAGE_MARKER)
    ? plan.html.split(IMAGE_MARKER).join(imageDataUrl)
    : `${plan.html}\n<img src="${imageDataUrl}" alt="Generated visual" style="max-width:100%;height:auto">`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${plan.css}</style></head><body>${html}</body></html>`;
}

export async function handleSmokeImage(env: MinimalEnv) {
  try {
    const startedAt = Date.now();
    const result = await museImageRequest(env, 'a simple product photo of a white chair on a clean neutral studio background, realistic commercial photography, no text, no logos, no watermark');
    const dataUrl = `data:${result.image.mimeType};base64,${result.image.base64}`;
    return json({
      ok: true,
      proof: 'muse-image-real-bytes',
      model: result.model,
      mimeType: result.image.mimeType,
      byteLengthEstimate: result.image.byteLengthEstimate,
      imageDataUrl: dataUrl,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return json({ ok: false, stage: 'muse-image', error: error instanceof Error ? error.message : 'Muse Image smoke test failed' }, 502);
  }
}

export async function handleMinimalRebuild(request: Request, env: MinimalEnv) {
  const startedAt = Date.now();
  try {
    const body = await request.json() as { url?: unknown };
    const target = normalizeUrl(body.url);

    const capture = await captureReference(env, target);

    const spark = await sparkRequest(env, [
      {
        type: 'input_text',
        text: `Rebuild this reference as a compact single-page HTML/CSS implementation. This is a proof-first minimal slice, not a redesign. Preserve the observed hierarchy, density, spacing, typography character and major sections. Return the required JSON only. The html field must contain exactly one ${IMAGE_MARKER} marker in a prominent media slot. The imagePrompt must describe an original replacement visual matching that slot without copying brands or proprietary media.\n\nURL: ${target}\nTITLE: ${capture.title}\nVIEWPORT: ${JSON.stringify(capture.viewport)}\nPAGE: ${JSON.stringify(capture.page)}\nVISIBLE TEXT:\n${capture.text}\n\nHTML EVIDENCE:\n${capture.html}`,
      },
      { type: 'input_image', image_url: capture.screenshotDataUrl, detail: 'high' },
    ]);

    const image = await museImageRequest(env, spark.plan.imagePrompt);
    const imageDataUrl = `data:${image.image.mimeType};base64,${image.image.base64}`;
    const finalHtml = assembleHtml(spark.plan, imageDataUrl);

    return json({
      ok: true,
      version: 'minimal-slice-v1',
      target,
      elapsedMs: Date.now() - startedAt,
      artifacts: {
        capture: {
          title: capture.title,
          viewport: capture.viewport,
          page: capture.page,
          htmlChars: capture.html.length,
          screenshotBytes: capture.screenshotBytes,
          screenshotDataUrl: capture.screenshotDataUrl,
        },
        spark: {
          model: spark.model,
          rawResponseBytes: spark.rawResponseBytes,
          structure: spark.plan.structure,
          summary: spark.plan.summary,
        },
        image: {
          model: image.model,
          mimeType: image.image.mimeType,
          byteLengthEstimate: image.image.byteLengthEstimate,
          imageDataUrl,
        },
        output: {
          html: finalHtml,
          htmlChars: finalHtml.length,
          imageInjected: finalHtml.includes(imageDataUrl),
        },
      },
    });
  } catch (error) {
    return json({
      ok: false,
      version: 'minimal-slice-v1',
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Minimal rebuild failed',
    }, 422);
  }
}
