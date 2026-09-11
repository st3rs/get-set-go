import {
  extractMuseImage,
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
type GeneratedAsset = {
  id: string;
  role: string;
  size: string;
  model: string;
  mimeType: string;
  byteLengthEstimate: number;
  dataUrl: string;
};
type AssetRequest = {
  id: string;
  role: string;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  prompt: string;
  required: boolean;
  source: 'reference' | 'resolver';
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

function safeAssetId(raw: unknown, index: number) {
  const cleaned = String(raw || `asset-${index + 1}`)
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || `asset-${index + 1}`;
}

function marker(id: string) {
  return `{{ASSET:${id}}}`;
}

function markerPresent(text: string, id: string) {
  return String(text || '').includes(marker(id));
}

function replaceAssetMarkers(text: string, assets: Array<{ id: string; dataUrl: string }>) {
  let result = text;
  for (const asset of assets) result = result.split(marker(asset.id)).join(asset.dataUrl);
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

function minimumRequiredAssets(input: { target: string; designIR: any; semanticEvidence: any }, requested: number) {
  if (!requested) return 0;
  if (isDigitalMarketplace(input)) return Math.min(4, requested);
  if (input.designIR?.siteType === 'commerce') return Math.min(3, requested);
  return 0;
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
      ? `Create an original polished digital-product marketplace thumbnail for a ${width}x${height} reference footprint, aspect ratio about ${ratio}:1. Make it a credible fictional software, plugin, template, developer-tool, SaaS, mobile-app or web-app product preview using layered UI panels, browser/device framing, interface composition or technical visual art. Match the reference page's visual density and crop. No copied screenshots, logos, trademarks, prices, labels, watermarks or legible product names.`
      : `Create an original replacement visual for a prominent reference media slot measuring about ${width}x${height}, aspect ratio about ${ratio}:1. Match the reference page's visual weight, crop, density and general palette while remaining original. No logos, trademarks, watermarks or copied proprietary media.`;
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
    if (seen.has(request.id)) continue;
    seen.add(request.id);
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
    text: `You are the Design Token Resolver and Structural Planner for reconstruction mode. You are NOT the code generator. Output only the strict DesignPlan JSON contract.\n\n${instructions}\n\nTARGET: ${input.target}\n\nMEASURED DESIGN IR:\n${compactJson(input.designIR, 30000)}\n\nSTRUCTURAL HINTS:\n${compactJson(input.componentPlan, 12000)}\n\nSEMANTIC + GEOMETRY EVIDENCE:\n${compactJson(input.semanticEvidence, 24000)}\n\nRULES:\n- Explicit user instructions override only the aspects they intentionally change.\n- Measured geometry and screenshots are truth everywhere else.\n- Resolve semantic design tokens from evidence rather than generic defaults.\n- Preserve distinctive editorial, brutalist, dense fintech and marketplace character.\n- This target is ${digitalMarketplace ? 'a DIGITAL PRODUCT MARKETPLACE; product preview media is mandatory' : 'not specifically classified as a digital marketplace'}.\n- Runtime creates mandatory media requests directly from browser evidence. Your assetRequests are supplemental.\n- Never request copied proprietary screenshots, logos or trademarks.`,
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

function imagePrompt(asset: AssetRequest, digitalMarketplace: boolean) {
  const productLike = digitalMarketplace || /product|catalog|card|merch|item|thumbnail|listing/i.test(`${asset.role} ${asset.id}`);
  if (productLike && digitalMarketplace) {
    return `Create one polished digital-product marketplace preview thumbnail. Role: ${asset.role}. ${asset.prompt}\n\nThis is a fictional digital product preview, not a physical box. Use a clean software/interface composition, browser/device mockup, layered UI panels or technical visual art. No legible text, prices, labels, logos, trademarks, watermarks or copied screenshots. Aim for the requested ${asset.size} orientation and crop.`;
  }
  if (productLike) {
    return `Create one realistic commercial product photograph. Role: ${asset.role}. ${asset.prompt}\n\nThe product may be fictional but must look physically believable and professionally photographed. No text, prices, labels, logos, trademarks, watermarks, UI, collage, frame or border. Aim for the requested ${asset.size} orientation and crop.`;
  }
  return `Create one original visual asset for a web interface reconstruction. Role: ${asset.role}. ${asset.prompt}\n\nNo brand logos, trademarks, legible UI text, watermarks or copied proprietary imagery. Aim for the requested ${asset.size} orientation and crop.`;
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
    try {
      // Native Muse Image call. No Spark tools, response schema, or image-generation tool wrapper.
      const imageResponse = await museImageRequest(env, { input: imagePrompt(asset, digitalMarketplace) });
      const image = extractMuseImage(imageResponse.payload);
      if (!image) throw new Error('Muse Image returned no image_generation_call result');
      if (image.mimeType === 'application/octet-stream') throw new Error('Muse Image returned bytes with an unrecognized image format');
      return {
        asset: {
          id,
          role: asset.role,
          size: asset.size,
          model: imageResponse.model,
          mimeType: image.mimeType,
          byteLengthEstimate: image.byteLengthEstimate,
          dataUrl: `data:${image.mimeType};base64,${image.base64}`,
        } as GeneratedAsset,
      };
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

export async function runMuseImageSmoke(env: AiEnv) {
  const response = await museImageRequest(env, {
    input: 'Create a simple original abstract software product thumbnail with layered interface panels, dark graphite background, one emerald accent, no text, no logos, no watermark.',
  });
  const image = extractMuseImage(response.payload);
  if (!image) throw new Error('Muse Image smoke test returned no image_generation_call result');
  if (image.mimeType === 'application/octet-stream') throw new Error('Muse Image smoke test returned an unrecognized image format');
  return {
    ok: true,
    provider: response.provider,
    model: response.model,
    mimeType: image.mimeType,
    byteLengthEstimate: image.byteLengthEstimate,
    hasImageBytes: image.base64.length > 1000,
  };
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
  const requiredMinimum = minimumRequiredAssets(input, requestedAssets.length);

  const assetPromise = generateAssets(env, requestedAssets, digitalMarketplace);

  const codegenContent: any[] = [{
    type: 'input_text',
    text: `You are the target React code generator for reconstruction mode. Do not redesign the reference.\n\n${instructions}\n\nTARGET: ${input.target}\n\nDESIGN PLAN:\n${compactJson(designPlan, 36000)}\n\nCOMPONENT ROUTING:\n${compactJson(registryPlan, 26000)}\n\nSEMANTIC CSS VARIABLES:\n${cssVariableBlock(cssVariables)}\n\nMANDATORY GENERATED ASSET MANIFEST:\n${compactJson(requestedAssets, 16000)}\n\nRULES:\n- Return production-quality React TSX, CSS, and a self-contained previewHtml.\n- Preserve measured geometry and distinctive visual character.\n- For EVERY item in MANDATORY GENERATED ASSET MANIFEST, put its exact {{ASSET:id}} marker into a visible media slot in previewHtml and App.tsx.\n- Never replace a required asset with a blank rectangle, emoji, gradient, or icon.\n- Product copy, prices, badges and CTA remain HTML.\n- Explicit instructions override only intentional changes.\n- previewHtml must be standalone and script-free.`,
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

  if (requiredMinimum > 0 && assetResult.generatedAssets.length < requiredMinimum) {
    throw new Error(`Muse Image acceptance gate FAILED: generated ${assetResult.generatedAssets.length}/${requestedAssets.length}; minimum required is ${requiredMinimum}. ${assetResult.assetErrors.slice(0, 4).join(' | ') || 'No usable image bytes returned.'}`);
  }

  const codegenText = extractResponseText(codegenResponse.payload);
  if (!codegenText) throw new Error('Code generation returned no output');
  const generated = JSON.parse(codegenText);

  const successfulIds = new Set(assetResult.generatedAssets.map((asset) => asset.id));
  const injectedIds = assetResult.generatedAssets
    .filter((asset) => markerPresent(generated.previewHtml, asset.id) && markerPresent(generated.appTsx, asset.id))
    .map((asset) => asset.id);

  if (requiredMinimum > 0 && injectedIds.length < requiredMinimum) {
    const missing = [...successfulIds].filter((id) => !injectedIds.includes(id));
    throw new Error(`Media injection acceptance gate FAILED: only ${injectedIds.length}/${assetResult.generatedAssets.length} successful Muse Image assets were referenced by both previewHtml and App.tsx; minimum required is ${requiredMinimum}. Missing markers: ${missing.slice(0, 6).join(', ') || 'unknown'}`);
  }

  if (assetResult.generatedAssets.length) {
    const replacements = assetResult.generatedAssets.map(({ id, dataUrl }) => ({ id, dataUrl }));
    generated.appTsx = replaceAssetMarkers(generated.appTsx, replacements);
    generated.stylesCss = replaceAssetMarkers(generated.stylesCss, replacements);
    generated.previewHtml = replaceAssetMarkers(generated.previewHtml, replacements);
  }

  const failedIds = requestedAssets.filter((requested) => !successfulIds.has(requested.id));
  for (const failed of failedIds) {
    generated.appTsx = generated.appTsx.split(marker(failed.id)).join('');
    generated.stylesCss = generated.stylesCss.split(marker(failed.id)).join('');
    generated.previewHtml = generated.previewHtml.split(marker(failed.id)).join('');
  }

  return {
    mode: 'reconstruction-recovery',
    provider: resolved.response.provider,
    model: codegenResponse.model,
    models: {
      resolver: resolved.response.model,
      codegen: codegenResponse.model,
      image: assetResult.generatedAssets[0]?.model || (requestedAssets.length && env.MODEL_API_KEY ? env.MUSE_IMAGE_MODEL || 'muse-image-1.0' : null),
    },
    aiCalls: 2 + assetResult.attempted,
    imageTelemetry: {
      requested: requestedAssets.length,
      attempted: assetResult.attempted,
      succeeded: assetResult.generatedAssets.length,
      injected: injectedIds.length,
      failed: assetResult.assetErrors.length,
      requiredMinimum,
      errors: assetResult.assetErrors,
    },
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
