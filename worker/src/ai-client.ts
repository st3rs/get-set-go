export type AiRole = 'architect' | 'codegen' | 'critic';

export type AiEnv = {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_CODE_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

export type AiSelection = {
  provider: 'openrouter' | 'openai';
  model: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function aiConfigured(env: AiEnv) {
  return Boolean(env.OPENROUTER_API_KEY || env.OPENAI_API_KEY);
}

export function selectAi(env: AiEnv, role: AiRole): AiSelection {
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

  throw new Error('No AI provider is configured. Add OPENROUTER_API_KEY or OPENAI_API_KEY.');
}

export async function responsesRequest(env: AiEnv, role: AiRole, body: any, retries = 2) {
  const selected = selectAi(env, role);
  const endpoint = selected.provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/responses'
    : 'https://api.openai.com/v1/responses';
  const apiKey = selected.provider === 'openrouter' ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;

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

    // OpenRouter's Responses API is OpenAI-compatible, but provider models may
    // ignore model-specific verbosity controls. Keep the portable JSON schema.
    if (selected.provider === 'openrouter' && payload.text?.verbosity) {
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
