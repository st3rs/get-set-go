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

type ImageEvidence = {
  label: string;
  dataUrl: string;
  detail?: 'low' | 'high' | 'auto';
};

type UserInstructions = {
  main: string;
  steps: string[];
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
  if (designIR?.siteType === 'commerce') return 6;
  return 2;
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
  const content: any[] = [
    {
      type: 'input_text',
      text: `You are the Phase B Design Token Resolver and Component Spec Planner for a high-fidelity website reconstruction engine.\n\nYou are NOT the code generator. Your only output is the strict DesignPlan JSON contract supplied by the response schema.\n\nMODE:\n- This request is reconstruction mode because a visual reference URL is supplied. Set mode=reconstruction.\n- Explicit user instructions have highest priority for aspects they intentionally change.\n- For all other aspects, measured browser geometry and screenshots are the visual truth.\n\n${instructions}\n\nTARGET: ${input.target}\n\nMEASURED DESIGN IR:\n${compactJson(input.designIR, 26000)}\n\nEXISTING STRUCTURAL HINTS:\n${compactJson(input.componentPlan, 10000)}\n\nSEMANTIC + GEOMETRY EVIDENCE:\n${compactJson(input.semanticEvidence, 18000)}\n\nTOKEN RESOLUTION CONTRACT:\n- Resolve one semantic token system before defining components.\n- Normalize colors by role: background, surface, elevated surface, text, muted text, border, accent, accent foreground, danger.\n- Derive typography scale, line-height pairings and weights from measured evidence.\n- Resolve a compact spacing rhythm and reusable geometry/elevation/motion tokens.\n- In reconstruction mode, measured values may become token values even if they do not fit an 8pt creation-mode scale. Do not flatten a distinctive reference into generic SaaS defaults.\n\nSTRUCTURAL COMPONENT CONTRACT:\n- Return a flat component graph. rootIds define top-level page order. components reference child component ids.\n- Use strict primitives for behavior-heavy basics such as buttons, inputs, tabs, dialogs, accordion and navigation when possible.\n- Use parametric components for heroes, cards, product cards, grids, sidebars, pricing, tables, testimonials, headers and footers when the reference can be represented through token-driven variants.\n- Request tierPreference=escape only when the reference or explicit user instruction truly requires behavior/geometry outside the registry, such as asymmetric overlap, SVG-driven art, canvas/WebGL, unusually composed editorial layouts, or other evidence-backed custom structures.\n- Every escape request MUST provide a concrete escapeReason tied to visible evidence or a user instruction. Otherwise use strict or parametric.\n- Preserve high-character references. Brutalist, editorial, high-density fintech, marketplace and other non-SaaS visual languages must not be normalized into a generic dashboard.\n\nPRODUCT MEDIA:\n- Good product media is mandatory when prominent product cards depend on imagery.\n- This target is ${digitalMarketplace ? 'likely a DIGITAL PRODUCT MARKETPLACE; prefer polished fictional software/template/plugin/app preview thumbnails' : 'not specifically classified as a digital marketplace from current evidence'}.\n- Never request copied proprietary screenshots, logos or trademarks. Neutral original mock media is allowed.\n- UI labels, prices, badges and copy stay in HTML, never baked into generated images.\n\nBuild a DesignPlan that a deterministic registry router and a separate code generator can execute without inventing the design system again.`,
    },
  ];

  for (const image of input.images) {
    content.push({ type: 'input_text', text: `REFERENCE VISUAL: ${image.label}` });
    content.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  const response = await responsesRequest(env, 'architect', {
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content }],
    text: {
      verbosity: 'medium',
      format: {
        type: 'json_schema',
        name: 'guardrailed_design_plan',
        strict: true,
        schema: DESIGN_PLAN_JSON_SCHEMA,
      },
    },
  });

  const output = extractResponseText(response.payload);
  if (!output) throw new Error('Design resolver returned no output');
  const parsed = JSON.parse(output);
  const plan = DesignPlanSchema.parse(parsed);
  const registryPlan = resolveRegistryPlan(plan);
  const cssVariables = tokensToCssVariables(plan.tokens);

  return { plan, registryPlan, cssVariables, response };
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
  const digitalMarketplace = isDigitalMarketplace(input);
  const instructions = instructionText(input.userInstructions);

  // Micro-step A: resolve semantic tokens + structural component graph.
  const resolved = await resolveDesignPlan(env, input);
  const designPlan: DesignPlan = resolved.plan;
  const registryPlan = resolved.registryPlan;
  const cssVariables = resolved.cssVariables;

  const generatedAssets: Array<{
    id: string;
    role: string;
    size: string;
    model: string;
    dataUrl: string;
  }> = [];
  const assetErrors: string[] = [];

  if (resolved.response.provider === 'meta' && env.MODEL_API_KEY) {
    const requests = designPlan.assetRequests
      .filter((asset) => asset.required)
      .slice(0, maxAssetsForSite(input.designIR));

    for (let index = 0; index < requests.length; index++) {
      const asset = requests[index];
      const id = safeAssetId(asset.id, index);
      const isProduct = /product|catalog|card|merch|item|thumbnail|listing/i.test(`${asset.role} ${id}`);
      try {
        const imageResponse = await museImageRequest(env, {
          input: isProduct && digitalMarketplace
            ? `Create one polished digital-product marketplace preview thumbnail for a premium product card. Role: ${asset.role}. ${asset.prompt}\n\nThe listed product is digital, such as software, source code, a plugin, template, theme, SaaS, mobile app, web app, or developer tool. Create a commercially credible fictional preview using clean interface compositions, dashboard/app screens, browser or device mockups, abstract technical visualization, or layered UI panels as appropriate. Match the requested crop, perspective, palette, density, backdrop, and visual weight. No legible text, prices, labels, logos, trademarks, watermarks, marketplace chrome, or copied real product screenshots.`
            : isProduct
              ? `Create a single realistic commercial product photograph for a premium web product card. Role: ${asset.role}. ${asset.prompt}\n\nThe product may be fictional, but it must look physically believable and professionally photographed. Match the requested angle, crop, lighting, materials, backdrop, palette, and negative space. No text, prices, labels, logos, trademarks, watermarks, UI, collage, frame, or border inside the image.`
              : `Create one original visual asset for a web interface reconstruction. Role: ${asset.role}. ${asset.prompt}\n\nDo not include brand logos, trademarks, legible UI text, watermarks, or copied proprietary imagery. Match the requested composition, palette and visual weight while remaining original.`,
          tools: [{ type: 'image_generation', size: asset.size }],
        });
        const base64 = extractMuseImageBase64(imageResponse.payload);
        if (!base64) throw new Error('Muse Image returned no image_generation_call result');
        generatedAssets.push({ id, role: asset.role, size: asset.size, model: imageResponse.model, dataUrl: `data:image/png;base64,${base64}` });
      } catch (error) {
        assetErrors.push(`${id}: ${error instanceof Error ? error.message : 'Image generation failed'}`);
      }
    }
  }

  // Micro-step B: codegen receives an already-resolved design system and registry route.
  const codegenContent: any[] = [
    {
      type: 'input_text',
      text: `You are the target React code generator for a guardrailed design engine. The design decisions have ALREADY been made. Do not invent a second design system.\n\n${instructions}\n\nTARGET: ${input.target}\n\nDESIGN PLAN (single source of truth):\n${compactJson(designPlan, 36000)}\n\nDETERMINISTIC COMPONENT REGISTRY ROUTING:\n${compactJson(registryPlan, 26000)}\n\nSEMANTIC CSS VARIABLES:\n${cssVariableBlock(cssVariables)}\n\nCODEGEN RULES:\n- Return production-quality React TSX and CSS plus a completely self-contained previewHtml with inline CSS and no external scripts.\n- Component hierarchy, order, responsive behavior, states and styling intent must follow DesignPlan.\n- Use the registry component name from the routing plan as the local React component contract. For this prototype, implement the registry contracts locally in App.tsx rather than importing unavailable packages.\n- STRICT tier: preserve semantic/accessibility behavior and do not introduce arbitrary visual styling inside the primitive.\n- PARAMETRIC tier: styling must come from semantic CSS variables and component parameters derived from the plan/reference.\n- ESCAPE tier: custom CSS or scoped arbitrary layout values are allowed ONLY for components routed to escape. Even there, color and typography must use semantic CSS variables.\n- Declare resolved semantic values once in :root. Outside :root, avoid raw hex/rgb/hsl colors. Use var(--color-*), var(--font-*), var(--space-*), var(--radius-*), var(--shadow-*), and var(--motion-*).\n- Do not normalize distinctive editorial, brutalist, dense fintech or marketplace geometry into generic rounded SaaS cards. Registry primitives are implementation tools, not a visual style.\n- Explicit user instructions remain intentional overrides. Preserve reference fidelity elsewhere.\n- Do not add gradients, glass effects, giant radii or decorative motion unless requested or supported by evidence.\n- For generated image assets shown below, reference the exact marker {{ASSET:asset-id}}.\n- Product card copy, prices, badges and CTA remain HTML.\n- previewHtml must be standalone, script-free and visually representative of App.tsx + styles.css.`,
    },
  ];

  for (const image of input.images) {
    codegenContent.push({ type: 'input_text', text: `Reference image for fidelity check: ${image.label}` });
    codegenContent.push({ type: 'input_image', image_url: image.dataUrl, detail: image.detail || 'high' });
  }

  for (const asset of generatedAssets) {
    codegenContent.push({ type: 'input_text', text: `Generated asset id=${asset.id}, role=${asset.role}, size=${asset.size}. Use exact source marker {{ASSET:${asset.id}}}.` });
    codegenContent.push({ type: 'input_image', image_url: asset.dataUrl, detail: 'high' });
  }

  const codegenResponse = await responsesRequest(env, 'codegen', {
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content: codegenContent }],
    text: {
      verbosity: 'medium',
      format: {
        type: 'json_schema',
        name: 'guardrailed_codegen_output',
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
    mode: 'guardrailed-reconstruction',
    provider: resolved.response.provider,
    model: codegenResponse.model,
    models: {
      resolver: resolved.response.model,
      codegen: codegenResponse.model,
      image: generatedAssets[0]?.model || null,
    },
    aiCalls: 2 + generatedAssets.length,
    visualSpec: designPlan,
    designTokens: designPlan.tokens,
    componentSpec: {
      rootIds: designPlan.rootIds,
      components: designPlan.components,
    },
    registryPlan,
    tokenCssVariables: cssVariables,
    assets: generatedAssets.map(({ dataUrl: _dataUrl, ...asset }) => asset),
    assetErrors,
    generated,
  };
}
