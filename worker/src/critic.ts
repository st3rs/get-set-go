type CriticEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputText(payload: any) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function call(env: CriticEnv, body: any) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  let last = 'Visual critic request failed';

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) return response.json();
    const text = await response.text();
    last = `OpenAI HTTP ${response.status}: ${text.slice(0, 700)}`;
    if (response.status !== 429 || attempt === 2) break;
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    await sleep(Math.min(retryAfter > 0 ? retryAfter * 1000 : 2500 * Math.pow(2, attempt), 12000));
  }

  throw new Error(last);
}

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'number', minimum: 0, maximum: 100 },
    verdict: { type: 'string', enum: ['pass', 'fix'] },
    issues: { type: 'array', items: { type: 'string' } },
    revisedAppTsx: { type: 'string' },
    revisedStylesCss: { type: 'string' },
    revisedPreviewHtml: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'verdict', 'issues', 'revisedAppTsx', 'revisedStylesCss', 'revisedPreviewHtml', 'notes'],
};

export async function runVisualCritic(
  env: CriticEnv,
  input: {
    target: string;
    visualSpec: any;
    appTsx: string;
    stylesCss: string;
    previewHtml: string;
    originalDesktop: string;
    generatedDesktop: string;
    originalMobile?: string;
    generatedMobile?: string;
  },
) {
  const model = env.OPENAI_MODEL || 'gpt-5.6-sol';
  const content: any[] = [
    {
      type: 'input_text',
      text: `You are the final visual QA and correction pass for a website reconstruction engine.\n\nTarget: ${input.target}\n\nYour task is NOT to praise the draft. Compare the generated render against the reference and correct the implementation. Judge: macro layout, section proportions, alignment, whitespace rhythm, typography scale/weight, color relationships, borders/radii, density, visual hierarchy, and mobile behavior.\n\nA score below 92 means the reconstruction still needs a correction. If it already deserves 92+, return verdict=pass and you may return the source unchanged. Otherwise verdict=fix and return fully revised App.tsx, styles.css and standalone previewHtml. Do not add generic visual effects unsupported by the reference. Keep the preview self-contained and script-free.\n\nVisual spec:\n${JSON.stringify(input.visualSpec).slice(0, 26000)}\n\nCurrent App.tsx:\n${input.appTsx.slice(0, 26000)}\n\nCurrent styles.css:\n${input.stylesCss.slice(0, 26000)}`,
    },
    { type: 'input_text', text: 'REFERENCE desktop:' },
    { type: 'input_image', image_url: input.originalDesktop, detail: 'high' },
    { type: 'input_text', text: 'GENERATED desktop:' },
    { type: 'input_image', image_url: input.generatedDesktop, detail: 'high' },
  ];

  if (input.originalMobile && input.generatedMobile) {
    content.push({ type: 'input_text', text: 'REFERENCE mobile:' });
    content.push({ type: 'input_image', image_url: input.originalMobile, detail: 'high' });
    content.push({ type: 'input_text', text: 'GENERATED mobile:' });
    content.push({ type: 'input_image', image_url: input.generatedMobile, detail: 'high' });
  }

  const payload = await call(env, {
    model,
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content }],
    text: {
      verbosity: 'medium',
      format: {
        type: 'json_schema',
        name: 'visual_critic_result',
        strict: true,
        schema: CRITIC_SCHEMA,
      },
    },
  });

  const text = outputText(payload);
  if (!text) throw new Error('Visual critic returned no output');
  return JSON.parse(text);
}
