import {
  extractMuseImageBase64,
  extractResponseText,
  museImageRequest,
  responsesRequest,
  type AiEnv,
} from './ai-client';

type ImageEvidence = {
  label: string;
  dataUrl: string;
  detail?: 'low' | 'high' | 'auto';
};

type AssetRequest = {
  id: string;
  role: string;
  prompt: string;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  required: boolean;
};

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
    assetRequests: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          role: { type: 'string' },
          prompt: { type: 'string' },
          size: { type: 'string', enum: ['1024x1024', '1024x1536', '1536x1024'] },
          required: { type: 'boolean' },
        },
        required: ['id', 'role', 'prompt', 'size', 'required'],
      },
    },
  },
  required: [
    'summary',
    'designIntent',
    'layoutRules',
    'typographyRules',
    'colorRules',
    'componentRules',
    'responsiveRules',
    'mustMatch',
    'avoid',
    'assetRequests',
  ],
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
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || `asset-${index + 1}`;
}

function replaceAssetMarkers(text: string, assets: Array<{ id: string; dataUrl: string }>) {
  let result = text;
  for (const asset of assets) result = result.split(`{{ASSET:${asset.id}}}`).join(asset.dataUrl);
  return result;
}

function maxAssetsForSite(designIR: any) {
  // Product-heavy UIs need believable media density. Other site types remain
  // conservative so image generation is used only where it materially helps.
  if (designIR?.siteType === 'commerce') return 6;
  return 2;
}

export async function runQualityPipeline(
  env: AiEnv,
  input: {
    target: string;
    designIR: any;
    componentPlan: any;
    semanticEvidence: any;
    images: ImageEvidence[];
  },
) {
  const architectContent: any[] = [
    {
      type: 'input_text',
      text: `You are the visual architect for a production-grade interface reconstruction engine.\n\nQUALITY BAR: The generated interface should be competitive with top visual website reconstruction tools. Optimize for visual fidelity, hierarchy, composition, typography, spacing, rhythm, section proportions, responsive intent, and implementation quality. Do not optimize merely for low token cost.\n\nUse screenshots as the primary visual truth and the deterministic Design IR as measured evidence. Resolve conflicts in favor of what is visibly rendered. Do not blindly reproduce third-party trademarks, logos, or proprietary media; preserve the visual role with neutral replacements when needed.\n\nTarget: ${input.target}\n\nDesign IR:\n${compactJson(input.designIR)}\n\nComponent plan:\n${compactJson(input.componentPlan)}\n\nSemantic evidence:\n${compactJson(input.semanticEvidence, 12000)}\n\nProduce precise implementation rules. Avoid generic SaaS-template advice.\n\nASSET POLICY:\n- For non-commerce interfaces, request Muse Image assets only when important hero/background/illustration media cannot be recreated well with HTML/CSS alone.\n- For commerce, catalog, marketplace, product-list, pricing-with-products, or any UI with product cards, GOOD PRODUCT MEDIA IS MANDATORY. Do not allow blank media blocks, abstract gray placeholders, emoji products, or generic CSS rectangles.\n- If original product media cannot be reused safely, request original neutral mock product photography that matches the reference card's framing, crop, lighting, backdrop, camera angle, palette, and visual weight. It is acceptable for the product itself to be fictional/mock, but the photography must look commercially believable and realistic.\n- Request separate product-card assets when cards visibly show different products. Prefer square assets for square/near-square cards, portrait for vertical cards, landscape only when the reference clearly uses it.\n- Never render prices, labels, badges, UI copy, logos or trademarks into the generated image. Those belong in HTML.\n- Never request screenshots or copied proprietary media.`,
    },
  ];

  for (const image of input.images) {
    architectContent.push({ type: 'input_text', text: `Visual evidence: ${image.label}` });
    architectContent.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  const architectResponse = await responsesRequest(env, 'architect', {
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

  const architectText = extractResponseText(architectResponse.payload);
  if (!architectText) throw new Error('Visual architect returned no output');
  const visualSpec = JSON.parse(architectText);

  const generatedAssets: Array<{
    id: string;
    role: string;
    size: string;
    model: string;
    dataUrl: string;
  }> = [];
  const assetErrors: string[] = [];

  if (architectResponse.provider === 'meta' && env.MODEL_API_KEY) {
    const requests = (Array.isArray(visualSpec.assetRequests) ? visualSpec.assetRequests : [])
      .filter((asset: AssetRequest) => asset?.required)
      .slice(0, maxAssetsForSite(input.designIR));

    for (let index = 0; index < requests.length; index++) {
      const asset = requests[index] as AssetRequest;
      const id = safeAssetId(asset.id, index);
      const isProduct = /product|catalog|card|merch|item/i.test(`${asset.role} ${id}`);
      try {
        const imageResponse = await museImageRequest(env, {
          input: isProduct
            ? `Create a single realistic commercial product photograph for a premium web product card. Role: ${asset.role}. ${asset.prompt}\n\nThe product may be fictional, but it must look physically believable, professionally photographed, and ready for an e-commerce card. Match the requested camera angle, crop, lighting, materials, backdrop, palette, and negative space. Keep one clear product subject. No text, prices, labels, logos, trademarks, watermarks, UI, collage, frame, or border inside the image.`
            : `Create one original visual asset for a web interface reconstruction. Role: ${asset.role}. ${asset.prompt}\n\nDo not include brand logos, trademarks, legible UI text, watermarks, or copied proprietary imagery. Match the requested composition, palette, lighting and visual weight while remaining an original neutral asset.`,
          tools: [{ type: 'image_generation', size: asset.size }],
        });
        const base64 = extractMuseImageBase64(imageResponse.payload);
        if (!base64) throw new Error('Muse Image returned no image_generation_call result');
        generatedAssets.push({
          id,
          role: asset.role,
          size: asset.size,
          model: imageResponse.model,
          dataUrl: `data:image/png;base64,${base64}`,
        });
      } catch (error) {
        assetErrors.push(`${id}: ${error instanceof Error ? error.message : 'Muse Image failed'}`);
      }
    }
  }

  const codegenContent: any[] = [
    {
      type: 'input_text',
      text: `You are the senior frontend implementation pass. Build a high-fidelity reconstruction from the supplied visual specification and evidence.\n\nTarget: ${input.target}\n\nVisual specification:\n${compactJson(visualSpec, 30000)}\n\nDesign IR:\n${compactJson(input.designIR, 22000)}\n\nComponent plan:\n${compactJson(input.componentPlan, 14000)}\n\nRequirements:\n- Return production-quality React TSX and CSS, not pseudo-code.\n- Also return a completely self-contained previewHtml with inline CSS and no external scripts.\n- Match measured composition, spacing, typography scale, density, borders, radii, media aspect ratios, and responsive layout as closely as evidence allows.\n- Use semantic HTML and responsive CSS.\n- Do not use generic gradients or decorative effects unless clearly supported by the reference.\n- Do not include remote third-party scripts, tracking, forms that submit externally, or copied proprietary assets.\n- Prefer visual fidelity over minimizing code length.\n- previewHtml must render standalone inside a sandboxed iframe.\n- For every generated Muse Image asset shown below, reference it with the exact marker {{ASSET:asset-id}} as an img src or CSS url. Do not invent other asset markers.\n- PRODUCT CARD RULE: if the reference contains product cards, every prominent visible card must have a believable product image area with the same approximate aspect ratio/crop as the reference. Use supplied product assets. Do not substitute empty rectangles, gradients, emoji, icons, or abstract placeholders. Use object-fit/object-position intentionally. Product copy, price, badges and CTA must stay as HTML, not baked into images.`,
    },
  ];

  for (const image of input.images) {
    codegenContent.push({ type: 'input_text', text: `Reference image: ${image.label}` });
    codegenContent.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  for (const asset of generatedAssets) {
    codegenContent.push({
      type: 'input_text',
      text: `Muse Image asset id=${asset.id}, role=${asset.role}, size=${asset.size}. Use exact source marker {{ASSET:${asset.id}}}.`,
    });
    codegenContent.push({ type: 'input_image', image_url: asset.dataUrl, detail: 'high' });
  }

  const codegenResponse = await responsesRequest(env, 'codegen', {
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

  const codegenText = extractResponseText(codegenResponse.payload);
  if (!codegenText) throw new Error('Code generation returned no output');
  const generated = JSON.parse(codegenText);

  if (generatedAssets.length) {
    const replacements = generatedAssets.map(({ id, dataUrl }) => ({ id, dataUrl }));
    generated.appTsx = replaceAssetMarkers(generated.appTsx, replacements);
    generated.stylesCss = replaceAssetMarkers(generated.stylesCss, replacements);
    generated.previewHtml = replaceAssetMarkers(generated.previewHtml, replacements);
  }

  return {
    mode: 'quality-first',
    provider: architectResponse.provider,
    model: codegenResponse.model,
    models: {
      architect: architectResponse.model,
      codegen: codegenResponse.model,
      image: generatedAssets[0]?.model || null,
    },
    aiCalls: 2 + generatedAssets.length,
    visualSpec,
    assets: generatedAssets.map(({ dataUrl: _dataUrl, ...asset }) => asset),
    assetErrors,
    generated,
  };
}
