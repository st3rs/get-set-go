type OpenAIEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

type ImageEvidence = {
  label: string;
  dataUrl: string;
  detail?: 'low' | 'high' | 'auto';
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function responsesCall(env: OpenAIEnv, body: any, retries = 2) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  let lastError = 'OpenAI request failed';
  for (let attempt = 0; attempt <= retries; attempt++) {
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
    lastError = `OpenAI HTTP ${response.status}: ${text.slice(0, 700)}`;

    if (response.status !== 429 || attempt === retries) break;
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2500 * Math.pow(2, attempt);
    await sleep(Math.min(waitMs, 12000));
  }

  throw new Error(lastError);
}

const ARCHITECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    designIntent: { type: 'string' },
    layoutRules: { type: 'array', items: { type: 'string' } },
    typographyRules: { type: 'array', items: { type: 'string' } },
    colorRules: { type: 'array', items: { type: 'string' } },
    componentRules: { type: 'array', items: { type: 'string' } },
    responsiveRules: { type: 'array', items: { type: 'string' } },
    mustMatch: { type: 'array', items: { type: 'string' } },
    avoid: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'designIntent', 'layoutRules', 'typographyRules', 'colorRules', 'componentRules', 'responsiveRules', 'mustMatch', 'avoid'],
};

const CODEGEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    appTsx: { type: 'string' },
    stylesCss: { type: 'string' },
    previewHtml: { type: 'string' },
    qualityNotes: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'appTsx', 'stylesCss', 'previewHtml', 'qualityNotes'],
};

function compactJson(value: unknown, maxChars = 24000) {
  const text = JSON.stringify(value);
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '…';
}

export async function runQualityPipeline(
  env: OpenAIEnv,
  input: {
    target: string;
    designIR: any;
    componentPlan: any;
    semanticEvidence: any;
    images: ImageEvidence[];
  },
) {
  const model = env.OPENAI_MODEL || 'gpt-5.6-sol';

  const architectContent: any[] = [
    {
      type: 'input_text',
      text: `You are the visual architect for a production-grade interface reconstruction engine.\n\nQUALITY BAR: The generated interface should be competitive with top visual website reconstruction tools. Optimize for visual fidelity, hierarchy, composition, typography, spacing, rhythm, section proportions, responsive intent, and implementation quality. Do not optimize merely for low token cost.\n\nUse screenshots as the primary visual truth and the deterministic Design IR as measured evidence. Resolve conflicts in favor of what is visibly rendered. Do not blindly reproduce third-party trademarks, logos, or proprietary media; preserve the visual role with neutral replacements when needed.\n\nTarget: ${input.target}\n\nDesign IR:\n${compactJson(input.designIR)}\n\nComponent plan:\n${compactJson(input.componentPlan)}\n\nSemantic evidence:\n${compactJson(input.semanticEvidence, 12000)}\n\nProduce precise implementation rules. Avoid generic SaaS-template advice.`,
    },
  ];

  for (const image of input.images) {
    architectContent.push({ type: 'input_text', text: `Visual evidence: ${image.label}` });
    architectContent.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  const architectPayload = await responsesCall(env, {
    model,
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content: architectContent }],
    text: {
      verbosity: 'medium',
      format: {
        type: 'json_schema',
        name: 'visual_architect_spec',
        strict: true,
        schema: ARCHITECT_SCHEMA,
      },
    },
  });

  const architectText = extractOutputText(architectPayload);
  if (!architectText) throw new Error('Visual architect returned no output');
  const visualSpec = JSON.parse(architectText);

  const codegenContent: any[] = [
    {
      type: 'input_text',
      text: `You are the senior frontend implementation pass. Build a high-fidelity reconstruction from the supplied visual specification and evidence.\n\nTarget: ${input.target}\n\nVisual specification:\n${compactJson(visualSpec, 30000)}\n\nDesign IR:\n${compactJson(input.designIR, 18000)}\n\nComponent plan:\n${compactJson(input.componentPlan, 12000)}\n\nRequirements:\n- Return production-quality React TSX and CSS, not pseudo-code.\n- Also return a completely self-contained previewHtml with inline CSS and no external scripts.\n- Match composition, spacing, typography scale, density, borders, radii, and responsive layout as closely as evidence allows.\n- Use semantic HTML and responsive CSS.\n- Do not use generic gradients or decorative effects unless clearly supported by the reference.\n- Do not include remote third-party scripts, tracking, forms that submit externally, or copied proprietary assets.\n- Prefer visual fidelity over minimizing code length.\n- previewHtml must render standalone inside a sandboxed iframe.`,
    },
  ];

  for (const image of input.images) {
    codegenContent.push({ type: 'input_text', text: `Reference image: ${image.label}` });
    codegenContent.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  const codegenPayload = await responsesCall(env, {
    model,
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content: codegenContent }],
    text: {
      verbosity: 'medium',
      format: {
        type: 'json_schema',
        name: 'visual_codegen_output',
        strict: true,
        schema: CODEGEN_SCHEMA,
      },
    },
  });

  const codegenText = extractOutputText(codegenPayload);
  if (!codegenText) throw new Error('Code generation returned no output');
  const generated = JSON.parse(codegenText);

  return {
    mode: 'quality-first',
    model,
    aiCalls: 2,
    visualSpec,
    generated,
  };
}
