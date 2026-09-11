export type AiRole = 'architect' | 'codegen' | 'critic';

export type AiEnv = {
  MODEL_API_KEY?: string;
  MUSE_SPARK_MODEL?: string;
  MUSE_IMAGE_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_CODE_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

export type AiSelection = {
  provider: 'meta' | 'openrouter' | 'openai';
  model: string;
};

export type MuseImageResult = {
  base64: string;
  mimeType: 'image/webp' | 'image/png' | 'image/jpeg' | 'application/octet-stream';
  byteLengthEstimate: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function aiConfigured(env: AiEnv) {
  return Boolean(env.MODEL_API_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY);
}

export function selectAi(env: AiEnv, role: AiRole): AiSelection {
  if (env.MODEL_API_KEY) {
    return {
      provider: 'meta',
      model: env.MUSE_SPARK_MODEL || 'muse-spark-1.3',
    };
  }

  if (env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      model:
        role === 'codegen'
          ? env.OPENROUTER_CODE_MODEL || env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free'
          : env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
    };
  }

  if (env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      model: env.OPENAI_MODEL || 'gpt-5.6-sol',
    };
  }

  throw new Error('No AI provider is configured. Add MODEL_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY.');
}

export async function responsesRequest(env: AiEnv, role: AiRole, body: any, retries = 2) {
  const selected = selectAi(env, role);
  const endpoint = selected.provider === 'meta'
    ? 'https://api.meta.ai/v1/responses'
    : selected.provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/responses'
      : 'https://api.openai.com/v1/responses';
  const apiKey = selected.provider === 'meta'
    ? env.MODEL_API_KEY
    : selected.provider === 'openrouter'
      ? env.OPENROUTER_API_KEY
      : env.OPENAI_API_KEY;

  let lastError = `${selected.provider} request failed`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    };

    if (selected.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://get-set-go.pages.dev';
      headers['X-Title'] = 'Get Set Go Visual Architect';
    }

    const payload = {
      ...body,
      model: selected.model,
    };

    if (selected.provider !== 'openai' && payload.text?.verbosity) {
      payload.text = { ...payload.text };
      delete payload.text.verbosity;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return {
        payload: await response.json(),
        provider: selected.provider,
        model: selected.model,
      };
    }

    const text = await response.text();
    lastError = `${selected.provider} ${selected.model} HTTP ${response.status}: ${text.slice(0, 700)}`;

    if (response.status !== 429 || attempt === retries) break;
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2500 * Math.pow(2, attempt);
    await sleep(Math.min(waitMs, 12000));
  }

  throw new Error(lastError);
}

/**
 * Dedicated Muse Image model path.
 * Muse Image is itself the image-generating model. It must never inherit tools,
 * response schemas, reasoning settings, or text-model options from Muse Spark.
 */
export async function museImageRequest(env: AiEnv, body: any, retries = 2) {
  if (!env.MODEL_API_KEY) throw new Error('MODEL_API_KEY is required for Muse Image');

  const model = env.MUSE_IMAGE_MODEL || 'muse-image-1.0';
  let lastError = `meta ${model} request failed`;

  const { tools: _tools, text: _text, reasoning: _reasoning, ...nativeBody } = body || {};
  if (nativeBody.input == null) throw new Error('Muse Image request requires input');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch('https://api.meta.ai/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.MODEL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...nativeBody, model }),
    });

    if (response.ok) {
      return { payload: await response.json(), provider: 'meta' as const, model };
    }

    const text = await response.text();
    lastError = `meta ${model} HTTP ${response.status}: ${text.slice(0, 700)}`;
    if (response.status !== 429 || attempt === retries) break;
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2500 * Math.pow(2, attempt);
    await sleep(Math.min(waitMs, 12000));
  }

  throw new Error(lastError);
}

export function extractResponseText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function detectImageMime(base64: string): MuseImageResult['mimeType'] {
  try {
    const prefix = atob(base64.slice(0, 32));
    const bytes = Array.from(prefix, (char) => char.charCodeAt(0));
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (prefix.slice(0, 4) === 'RIFF' && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
  } catch {
    return 'application/octet-stream';
  }
  return 'application/octet-stream';
}

export function extractMuseImage(payload: any): MuseImageResult | null {
  let base64: string | null = null;
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
  if (!base64) return null;
  return {
    base64,
    mimeType: detectImageMime(base64),
    byteLengthEstimate: Math.floor((base64.length * 3) / 4),
  };
}

export function extractMuseImageBase64(payload: any) {
  return extractMuseImage(payload)?.base64 || null;
}
