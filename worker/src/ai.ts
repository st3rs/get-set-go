import {
  extractMuseImageBase64,
  extractResponseText,
  museImageRequest,
  responsesRequest,
  type AiEnv,
} from './ai-client';
import {
  DESIGN_PLAN_JSON_SCHEMA,
  DesignPlanSchema,
  resolveRegistryPlan,
  tokensToCssVariables,
  type DesignPlan,
} from './guardrails';

type ImageEvidence = { label: string; dataUrl: string; detail?: 'low' | 'high' | 'auto' };
type UserInstructions = { main: string; steps: string[] };
type GeneratedAsset = { id: string; role: string; size: string; model: string; dataUrl: string };

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

function safeAssetId(raw: unknown, index: number) {
  const cleaned = String(raw || `asset-${index + 1}`)
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || `asset-${index + 1}`;
}

function replaceAssetMarkers(text: string, assets: Array<{ id: string; dataUrl: string }>) {
  let result = text;
  for (const asset of assets) result = result.split(`{{ASSET:${asset.id}}}`).join(asset.dataUrl);
  return result;
}

function maxAssetsForSite(designIR: any) {
  return designIR?.siteType === 'commerce' ? 6 : 2;
}

function isDigitalMarketplace(input: { target: string; semanticEvidence: any }) {
  const haystack = `${input.target} ${JSON.stringify(input.semanticEvidence || {})}`.toLowerCase();
  return /codecanyon|themeforest|envato|plugin|template|wordpress|script|source code|software marketplace|digital product|saas|mobile app|web app/.test(haystack);
}

function instructionText(instructions?: UserInstructions) {
  if (!instructions) return 'No user customization instructions were supplied. Reconstruct the reference as faithfully as possible.';
  const main = instructions.main?.trim();
  const steps = (instructions.steps || []).map((step) => step.trim()).filter(Boolean);
  if (!main && !steps.length) return 'No user customization instructions were supplied. Reconstruct the reference as faithfully as possible.';
  return [
    'USER CUSTOMIZATION INSTRUCTIONS:',
    main ? `Main prompt: ${main}` : 'Main prompt: none',
    ...steps.map((step, index) => `Instruction step ${index + 1}: ${step}`),
  ].join('\n');
}

function cssVariableBlock(vars: Record<string, string>) {
  return `:root {\n${Object.entries(vars).map(([key, value]) => `  ${key}: ${value};`).join('\n')}\n}`;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

async function resolveDesignPlan(
  env: AiEnv,
  input: {
    target: string;
    designIR: any;
    componentPlan: any;
    semanticEvidence: any;
    images: ImageEvidence[];
    userInstructions?: UserInstructions;
  },
) {
  const instructions = instructionText(input.userInstructions);
  const digitalMarketplace = isDigitalMarketplace(input);
  const content: any[] = [{
    type: 'input_text',
    text: `You are the Phase B Design Token Resolver and Component Spec Planner for a high-fidelity website reconstruction engine.\n\nYou are NOT the code generator. Your only output is the strict DesignPlan JSON contract supplied by the response schema.\n\nMODE:\n- This request is reconstruction mode because a visual reference URL is supplied. Set mode=reconstruction.\n- Explicit user instructions have highest priority for aspects they intentionally change.\n- For all other aspects, measured browser geometry and screenshots are the visual truth.\n\n${instructions}\n\nTARGET: ${input.target}\n\nMEASURED DESIGN IR:\n${compactJson(input.designIR, 26000)}\n\nEXISTING STRUCTURAL HINTS:\n${compactJson(input.componentPlan, 10000)}\n\nSEMANTIC + GEOMETRY EVIDENCE:\n${compactJson(input.semanticEvidence, 18000)}\n\nTOKEN RESOLUTION CONTRACT:\n- Resolve one semantic token system before defining components.\n- Normalize colors by role: background, surface, elevated surface, text, muted text, border, accent, accent foreground, danger.\n- Derive typography scale, line-height pairings and weights from measured evidence.\n- Resolve a compact spacing rhythm and reusable geometry/elevation/motion tokens.\n- In reconstruction mode, measured values may become token values even if they do not fit an 8pt creation-mode scale. Do not flatten a distinctive reference into generic SaaS defaults.\n\nSTRUCTURAL COMPONENT CONTRACT:\n- Return a flat component graph. rootIds define top-level page order. components reference child component ids.\n- Prefer strict primitives for behavior-heavy basics and parametric components for heroes, cards, grids, sidebars, tables, headers and footers.\n- Request tierPreference=escape only when visible evidence or an explicit instruction truly requires geometry/behavior outside the registry. Every escape request needs a concrete escapeReason.\n- Preserve high-character references. Brutalist, editorial, high-density fintech, marketplace and other non-SaaS languages must not be normalized into a generic dashboard.\n\nPRODUCT MEDIA:\n- Good product media is mandatory when prominent product cards depend on imagery.\n- This target is ${digitalMarketplace ? 'likely a DIGITAL PRODUCT MARKETPLACE; prefer polished fictional software/template/plugin/app preview thumbnails' : 'not specifically classified as a digital marketplace from current evidence'}.\n- Never request copied proprietary screenshots, logos or trademarks. Neutral original mock media is allowed.\n- UI labels, prices, badges and copy stay in HTML.\n\nBuild a DesignPlan that a deterministic registry router and separate code generator can execute without inventing the design system again.`,
  }];

  for (const image of input.images) {
    content.push({ type: 'input_text', text: `REFERENCE VISUAL: ${image.label}` });
    content.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  const response = await responsesRequest(env, 'architect', {
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content }],
    text: { verbosity: 'medium', format: { type: 'json_schema', name: 'guardrailed_design_plan', strict: true, schema: DESIGN_PLAN_JSON_SCHEMA } },
  });

  const output = extractResponseText(response.payload);
  if (!output) throw new Error('Design resolver returned no output');
  const plan = DesignPlanSchema.parse(JSON.parse(output));
  return {
    plan,
    registryPlan: resolveRegistryPlan(plan),
    cssVariables: tokensToCssVariables(plan.tokens),
    response,
  };
}

async function generateAssets(
  env: AiEnv,
  designPlan: DesignPlan,
  input: { target: string; designIR: any; semanticEvidence: any },
  provider: string,
) {
  const generatedAssets: GeneratedAsset[] = [];
  const assetErrors: string[] = [];
  if (provider !== 'meta' || !env.MODEL_API_KEY) return { generatedAssets, assetErrors };

  const digitalMarketplace = isDigitalMarketplace(input);
  const requests = designPlan.assetRequests.filter((asset) => asset.required).slice(0, maxAssetsForSite(input.designIR));

  const results = await mapLimit(requests, 3, async (asset, index) => {
    const id = safeAssetId(asset.id, index);
    const isProduct = /product|catalog|card|merch|item|thumbnail|listing/i.test(`${asset.role} ${id}`);
    try {
      const imageResponse = await museImageRequest(env, {
        input: isProduct && digitalMarketplace
          ? `Create one polished digital-product marketplace preview thumbnail for a premium product card. Role: ${asset.role}. ${asset.prompt}\n\nThe listed product is digital. Create a commercially credible fictional software/template/plugin/app preview using clean interface compositions, browser/device mockups or layered UI panels. Match crop, perspective, palette, density, backdrop and visual weight. No legible text, prices, labels, logos, trademarks, watermarks or copied screenshots.`
          : isProduct
            ? `Create a single realistic commercial product photograph for a premium web product card. Role: ${asset.role}. ${asset.prompt}\n\nThe product may be fictional, but it must look physically believable and professionally photographed. Match angle, crop, lighting, materials, backdrop, palette and negative space. No text, prices, labels, logos, trademarks, watermarks, UI, collage, frame or border.`
            : `Create one original visual asset for a web interface reconstruction. Role: ${asset.role}. ${asset.prompt}\n\nNo brand logos, trademarks, legible UI text, watermarks or copied proprietary imagery. Match composition, palette and visual weight while remaining original.`,
        tools: [{ type: 'image_generation', size: asset.size }],
      });
      const base64 = extractMuseImageBase64(imageResponse.payload);
      if (!base64) throw new Error('Muse Image returned no image result');
      return { asset: { id, role: asset.role, size: asset.size, model: imageResponse.model, dataUrl: `data:image/png;base64,${base64}` } as GeneratedAsset };
    } catch (error) {
      return { error: `${id}: ${error instanceof Error ? error.message : 'Image generation failed'}` };
    }
  });

  for (const result of results) {
    if (result.asset) generatedAssets.push(result.asset);
    if (result.error) assetErrors.push(result.error);
  }
  return { generatedAssets, assetErrors };
}

export async function runQualityPipeline(
  env: AiEnv,
  input: {
    target: string;
    designIR: any;
    componentPlan: any;
    semanticEvidence: any;
    images: ImageEvidence[];
    userInstructions?: UserInstructions;
  },
) {
  const instructions = instructionText(input.userInstructions);
  const resolved = await resolveDesignPlan(env, input);
  const designPlan: DesignPlan = resolved.plan;
  const registryPlan = resolved.registryPlan;
  const cssVariables = resolved.cssVariables;
  const requestedAssets = designPlan.assetRequests
    .filter((asset) => asset.required)
    .slice(0, maxAssetsForSite(input.designIR))
    .map((asset, index) => ({ id: safeAssetId(asset.id, index), role: asset.role, size: asset.size, prompt: asset.prompt }));

  // Asset generation and code generation run concurrently after the shared DesignPlan is resolved.
  const assetPromise = generateAssets(env, designPlan, input, resolved.response.provider);

  const codegenContent: any[] = [{
    type: 'input_text',
    text: `You are the target React code generator for a guardrailed design engine. The design decisions have ALREADY been made. Do not invent a second design system.\n\n${instructions}\n\nTARGET: ${input.target}\n\nDESIGN PLAN (single source of truth):\n${compactJson(designPlan, 36000)}\n\nDETERMINISTIC COMPONENT REGISTRY ROUTING:\n${compactJson(registryPlan, 26000)}\n\nSEMANTIC CSS VARIABLES:\n${cssVariableBlock(cssVariables)}\n\nGENERATED ASSET MANIFEST:\n${compactJson(requestedAssets, 12000)}\n\nCODEGEN RULES:\n- Return production-quality React TSX and CSS plus a completely self-contained previewHtml with inline CSS and no external scripts.\n- Component hierarchy, order, responsive behavior, states and styling intent must follow DesignPlan.\n- Use the registry component name from the routing plan as the local React component contract.\n- STRICT tier preserves semantic/accessibility behavior and does not introduce arbitrary styling.\n- PARAMETRIC tier styling comes from semantic CSS variables and plan parameters.\n- ESCAPE tier may use scoped custom layout values only for components routed to escape; colors and typography still use semantic variables.\n- Declare resolved semantic values once in :root. Outside :root, avoid raw hex/rgb/hsl colors.\n- Do not normalize distinctive editorial, brutalist, dense fintech or marketplace geometry into generic rounded SaaS cards.\n- Explicit user instructions remain intentional overrides. Preserve reference fidelity elsewhere.\n- Do not add gradients, glass effects, giant radii or decorative motion unless requested or supported by evidence.\n- For every item in GENERATED ASSET MANIFEST, use its exact {{ASSET:id}} marker where that image belongs. Asset generation happens in parallel with this codegen pass.\n- Product card copy, prices, badges and CTA remain HTML.\n- previewHtml must be standalone, script-free and visually representative of App.tsx + styles.css.`,
  }];

  for (const image of input.images) {
    codegenContent.push({ type: 'input_text', text: `Reference image for fidelity check: ${image.label}` });
    codegenContent.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  const codegenPromise = responsesRequest(env, 'codegen', {
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content: codegenContent }],
    text: { verbosity: 'medium', format: { type: 'json_schema', name: 'guardrailed_codegen_output', strict: true, schema: CODEGEN_SCHEMA } },
  });

  const [assetResult, codegenResponse] = await Promise.all([assetPromise, codegenPromise]);
  const codegenText = extractResponseText(codegenResponse.payload);
  if (!codegenText) throw new Error('Code generation returned no output');
  const generated = JSON.parse(codegenText);

  if (assetResult.generatedAssets.length) {
    const replacements = assetResult.generatedAssets.map(({ id, dataUrl }) => ({ id, dataUrl }));
    generated.appTsx = replaceAssetMarkers(generated.appTsx, replacements);
    generated.stylesCss = replaceAssetMarkers(generated.stylesCss, replacements);
    generated.previewHtml = replaceAssetMarkers(generated.previewHtml, replacements);
  }

  // Never leave a failed asset marker as an invalid URL in the result.
  const failedIds = requestedAssets.filter((requested) => !assetResult.generatedAssets.some((asset) => asset.id === requested.id));
  for (const failed of failedIds) {
    const marker = `{{ASSET:${failed.id}}}`;
    generated.appTsx = generated.appTsx.split(marker).join('');
    generated.stylesCss = generated.stylesCss.split(marker).join('');
    generated.previewHtml = generated.previewHtml.split(marker).join('');
  }

  return {
    mode: 'guardrailed-reconstruction',
    provider: resolved.response.provider,
    model: codegenResponse.model,
    models: {
      resolver: resolved.response.model,
      codegen: codegenResponse.model,
      image: assetResult.generatedAssets[0]?.model || null,
    },
    aiCalls: 2 + assetResult.generatedAssets.length,
    visualSpec: designPlan,
    designTokens: designPlan.tokens,
    componentSpec: { rootIds: designPlan.rootIds, components: designPlan.components },
    registryPlan,
    tokenCssVariables: cssVariables,
    assets: assetResult.generatedAssets.map(({ dataUrl: _dataUrl, ...asset }) => asset),
    assetErrors: assetResult.assetErrors,
    generated,
  };
}
