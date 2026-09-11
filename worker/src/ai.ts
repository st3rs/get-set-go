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
type AssetRequest = { id: string; role: string; size: '1024x1024' | '1024x1536' | '1536x1024'; prompt: string; required: boolean; source: 'reference' | 'resolver' };

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

function isDigitalMarketplace(input: { target: string; semanticEvidence: any }) {
  const haystack = `${input.target} ${JSON.stringify(input.semanticEvidence || {})}`.toLowerCase();
  return /codecanyon|themeforest|envato|plugin|template|wordpress|script|source code|software marketplace|digital product|saas marketplace|mobile app marketplace|web app marketplace/.test(haystack);
}

function maxAssetsForSite(input: { target: string; designIR: any; semanticEvidence: any }) {
  if (isDigitalMarketplace(input)) return 6;
  if (input.designIR?.siteType === 'commerce') return 6;
  return 3;
}

function imageSizeForBox(box: any): AssetRequest['size'] {
  const width = Math.max(1, Number(box?.width || 1));
  const height = Math.max(1, Number(box?.height || 1));
  const ratio = width / height;
  if (ratio >= 1.22) return '1536x1024';
  if (ratio <= 0.82) return '1024x1536';
  return '1024x1024';
}

function referenceBackedAssetRequests(input: { target: string; designIR: any; semanticEvidence: any }): AssetRequest[] {
  const desktop = input.semanticEvidence?.desktop?.elements || [];
  const digitalMarketplace = isDigitalMarketplace(input);
  const media = desktop
    .filter((el: any) => {
      const kind = String(el?.meta?.mediaKind || '');
      const tag = String(el?.tag || '').toLowerCase();
      const width = Number(el?.box?.width || 0);
      const height = Number(el?.box?.height || 0);
      const isMedia = Boolean(kind) || /^(img|picture|video|canvas|svg)$/.test(tag);
      return isMedia && width >= 96 && height >= 64;
    })
    .map((el: any) => ({ ...el, area: Number(el.box.width || 0) * Number(el.box.height || 0) }))
    .sort((a: any, b: any) => b.area - a.area);

  const max = maxAssetsForSite(input);
  const selected: any[] = [];
  for (const el of media) {
    const ratio = Number(el.box.width || 1) / Math.max(1, Number(el.box.height || 1));
    const duplicate = selected.some((prev) => {
      const prevRatio = Number(prev.box.width || 1) / Math.max(1, Number(prev.box.height || 1));
      const closeRatio = Math.abs(prevRatio - ratio) < 0.08;
      const closeSize = Math.abs(Number(prev.box.width || 0) - Number(el.box.width || 0)) < 40
        && Math.abs(Number(prev.box.height || 0) - Number(el.box.height || 0)) < 40;
      return closeRatio && closeSize;
    });
    if (!duplicate || digitalMarketplace) selected.push(el);
    if (selected.length >= max) break;
  }

  // Marketplace references depend on rich card thumbnails. If DOM evidence under-samples
  // those images, force a minimum set instead of letting the resolver silently choose zero.
  const minimum = digitalMarketplace ? Math.min(4, max) : input.designIR?.siteType === 'commerce' ? Math.min(3, max) : 0;
  while (selected.length < minimum) {
    selected.push({
      box: { width: 640, height: 360, x: 0, y: 0 },
      text: '',
      meta: { mediaKind: 'inferred-product-thumbnail' },
    });
  }

  return selected.slice(0, max).map((el, index) => {
    const width = Number(el?.box?.width || 640);
    const height = Number(el?.box?.height || 360);
    const ratio = Number((width / Math.max(1, height)).toFixed(2));
    const role = digitalMarketplace ? `digital-product-thumbnail-${index + 1}` : `reference-media-${index + 1}`;
    const prompt = digitalMarketplace
      ? `Create an original polished digital-product marketplace thumbnail that occupies a ${width}x${height} reference footprint (aspect ratio about ${ratio}:1). It should look like a credible software, plugin, template, developer-tool, SaaS, mobile-app or web-app product preview, using layered UI panels, browser/device framing, interface composition or technical visual art as appropriate. Match the reference page's visual density and crop. No copied screenshots, logos, trademarks, prices, labels, watermarks or legible product names.`
      : `Create an original replacement visual for a prominent reference media slot measuring about ${width}x${height} (aspect ratio about ${ratio}:1). Match the reference page's visual weight, crop, density and general palette while remaining original. No logos, trademarks, watermarks or copied proprietary media.`;
    return {
      id: `reference-media-${index + 1}`,
      role,
      size: imageSizeForBox(el.box),
      prompt,
      required: true,
      source: 'reference' as const,
    };
  });
}

function mergeAssetRequests(
  input: { target: string; designIR: any; semanticEvidence: any },
  designPlan: DesignPlan,
): AssetRequest[] {
  const max = maxAssetsForSite(input);
  const forced = referenceBackedAssetRequests(input);
  const resolver = designPlan.assetRequests
    .filter((asset) => asset.required)
    .map((asset, index) => ({
      id: safeAssetId(asset.id, index + forced.length),
      role: asset.role,
      size: asset.size,
      prompt: asset.prompt,
      required: true,
      source: 'resolver' as const,
    }));

  const merged: AssetRequest[] = [];
  const seen = new Set<string>();
  for (const request of [...forced, ...resolver]) {
    const key = request.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(request);
    if (merged.length >= max) break;
  }
  return merged;
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
    text: `You are the Phase B Design Token Resolver and Component Spec Planner for a high-fidelity website reconstruction engine.\n\nYou are NOT the code generator. Your only output is the strict DesignPlan JSON contract supplied by the response schema.\n\nMODE:\n- This request is reconstruction mode because a visual reference URL is supplied. Set mode=reconstruction.\n- Explicit user instructions have highest priority for aspects they intentionally change.\n- For all other aspects, measured browser geometry and screenshots are the visual truth.\n\n${instructions}\n\nTARGET: ${input.target}\n\nMEASURED DESIGN IR:\n${compactJson(input.designIR, 26000)}\n\nEXISTING STRUCTURAL HINTS:\n${compactJson(input.componentPlan, 10000)}\n\nSEMANTIC + GEOMETRY EVIDENCE:\n${compactJson(input.semanticEvidence, 18000)}\n\nTOKEN RESOLUTION CONTRACT:\n- Resolve one semantic token system before defining components.\n- Normalize colors by role and derive typography, spacing, geometry, elevation and motion from measured evidence.\n- In reconstruction mode, measured values may become token values even when they do not fit a creation-mode scale.\n\nSTRUCTURAL COMPONENT CONTRACT:\n- Return a flat component graph. rootIds define top-level page order. components reference child component ids.\n- Preserve high-character references. Do not normalize editorial, brutalist, dense fintech, marketplace or other distinctive languages into generic SaaS.\n\nPRODUCT MEDIA:\n- Product media is mandatory when prominent cards depend on imagery.\n- This target is ${digitalMarketplace ? 'a DIGITAL PRODUCT MARKETPLACE; use polished fictional software/template/plugin/app preview thumbnails' : 'not specifically classified as a digital marketplace from current evidence'}.\n- The runtime also derives mandatory media requests directly from browser evidence, so assetRequests here are supplemental rather than the sole trigger.\n- Never request copied proprietary screenshots, logos or trademarks. UI labels, prices, badges and copy stay in HTML.\n\nBuild a DesignPlan that a deterministic router and code generator can execute without inventing the design system again.`,
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

async function generateAssets(env: AiEnv, requests: AssetRequest[], digitalMarketplace: boolean) {
  const generatedAssets: GeneratedAsset[] = [];
  const assetErrors: string[] = [];
  if (!env.MODEL_API_KEY) {
    return {
      generatedAssets,
      assetErrors: requests.length ? ['Muse Image unavailable: MODEL_API_KEY is not configured'] : [],
      attempted: 0,
    };
  }

  const results = await mapLimit(requests, 3, async (asset, index) => {
    const id = safeAssetId(asset.id, index);
    const isProduct = digitalMarketplace || /product|catalog|card|merch|item|thumbnail|listing/i.test(`${asset.role} ${id}`);
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
  return { generatedAssets, assetErrors, attempted: requests.length };
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
  const digitalMarketplace = isDigitalMarketplace(input);
  const requestedAssets = mergeAssetRequests(input, designPlan);

  // Image generation is no longer controlled solely by the LLM resolver. Reference-backed
  // media requests are deterministic and image generation can run even if text fallback changes.
  const assetPromise = generateAssets(env, requestedAssets, digitalMarketplace);

  const codegenContent: any[] = [{
    type: 'input_text',
    text: `You are the target React code generator for a guardrailed design engine. The design decisions have ALREADY been made.\n\n${instructions}\n\nTARGET: ${input.target}\n\nDESIGN PLAN:\n${compactJson(designPlan, 36000)}\n\nCOMPONENT ROUTING:\n${compactJson(registryPlan, 26000)}\n\nSEMANTIC CSS VARIABLES:\n${cssVariableBlock(cssVariables)}\n\nMANDATORY GENERATED ASSET MANIFEST:\n${compactJson(requestedAssets, 16000)}\n\nCODEGEN RULES:\n- Return production-quality React TSX and CSS plus a self-contained previewHtml.\n- For EVERY item in MANDATORY GENERATED ASSET MANIFEST, place its exact {{ASSET:id}} marker into a prominent media slot with the requested aspect ratio. Do not omit the marker.\n- Product card copy, prices, badges and CTA remain HTML.\n- Preserve reference geometry and distinctive visual character.\n- Explicit user instructions remain intentional overrides.\n- previewHtml must be standalone and script-free.`,
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

  const mediaRequired = digitalMarketplace || input.designIR?.siteType === 'commerce';
  if (mediaRequired && requestedAssets.length > 0 && assetResult.generatedAssets.length === 0) {
    throw new Error(`Required Muse Image generation produced 0/${requestedAssets.length} assets. ${assetResult.assetErrors.slice(0, 3).join(' | ') || 'No image result was returned.'}`);
  }

  const codegenText = extractResponseText(codegenResponse.payload);
  if (!codegenText) throw new Error('Code generation returned no output');
  const generated = JSON.parse(codegenText);

  if (assetResult.generatedAssets.length) {
    const replacements = assetResult.generatedAssets.map(({ id, dataUrl }) => ({ id, dataUrl }));
    generated.appTsx = replaceAssetMarkers(generated.appTsx, replacements);
    generated.stylesCss = replaceAssetMarkers(generated.stylesCss, replacements);
    generated.previewHtml = replaceAssetMarkers(generated.previewHtml, replacements);
  }

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
      image: assetResult.generatedAssets[0]?.model || (requestedAssets.length && env.MODEL_API_KEY ? env.MUSE_IMAGE_MODEL || 'muse-image-1.0' : null),
    },
    aiCalls: 2 + assetResult.attempted,
    imageAssetAttempts: assetResult.attempted,
    imageAssetRequested: requestedAssets.length,
    imageAssetSucceeded: assetResult.generatedAssets.length,
    imageAssetPlan: requestedAssets.map(({ prompt: _prompt, ...asset }) => asset),
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
