import { extractResponseText, responsesRequest, type AiEnv } from './ai-client';

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

type UserInstructions = {
  main: string;
  steps: string[];
};

function instructionText(instructions?: UserInstructions) {
  if (!instructions) return 'No user customization instructions were supplied.';
  const main = instructions.main?.trim();
  const steps = (instructions.steps || []).map((step) => step.trim()).filter(Boolean);
  if (!main && !steps.length) return 'No user customization instructions were supplied.';
  return [
    'USER CUSTOMIZATION INSTRUCTIONS:',
    main ? `Main prompt: ${main}` : 'Main prompt: none',
    ...steps.map((step, index) => `Instruction step ${index + 1}: ${step}`),
  ].join('\n');
}

export async function runVisualCritic(
  env: AiEnv,
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
    userInstructions?: UserInstructions;
  },
) {
  const instructions = instructionText(input.userInstructions);
  const content: any[] = [
    {
      type: 'input_text',
      text: `You are the final visual QA and correction pass for a guardrailed website reconstruction engine.\n\nTarget: ${input.target}\n\n${instructions}\n\nCRITIC PRIORITY:\n- Judge BOTH reference fidelity and user-instruction compliance.\n- Explicit user instructions are intentional overrides. Do not fix an instructed difference back toward the reference.\n- For aspects the user did not ask to change, use the reference as visual truth.\n- Ordered instruction steps must remain satisfied in sequence.\n\nDESIGN CONTRACT IS LOCKED:\n- Visual spec below is the resolved Phase B DesignPlan: semantic tokens + flat component graph + tier preferences. Treat it as the implementation contract, not optional advice.\n- Preserve the resolved semantic token system. Do not invent a second palette, typography scale, spacing scale or radius system during correction.\n- In CSS, resolved raw color values belong in :root token declarations only. Outside :root, use semantic var(--color-*), var(--font-*), var(--space-*), var(--radius-*), var(--shadow-*), and var(--motion-*) references.\n- Do not turn distinctive editorial, brutalist, dense fintech or marketplace layouts into generic rounded SaaS cards.\n- Strict primitives keep accessible behavior and should not receive arbitrary bespoke styling. Parametric components may use token-driven variants and measured layout parameters. Custom/arbitrary CSS is justified only for components explicitly marked for escape by the DesignPlan.\n- A visual correction must improve the render without weakening this contract.\n\nYour task is NOT to praise the draft. Compare the generated render against the reference and correct the implementation. Judge macro layout, section proportions, alignment, whitespace rhythm, typography scale/weight, color relationships, borders/radii, density, visual hierarchy, media footprint, image crop, mobile behavior, instruction compliance, and design-contract compliance.\n\nPRODUCT / COMMERCE QUALITY RULES:\n- If the reference or instructions contain product cards or product tiles, prominent cards must include believable product media with approximately matching/requested aspect ratio, crop, visual weight and backdrop.\n- Empty media rectangles, generic gradients, emoji, icons standing in for products, obviously synthetic placeholder blocks, repeated identical fake thumbnails when variety is expected, stretched imagery, poor object-fit, or missing product imagery are major failures.\n- A commerce reconstruction with visibly weak/missing product media MUST NOT receive a score of 92 or higher.\n- For digital marketplaces, software/plugin/template listings should use credible digital-product preview thumbnails or UI/app mockups, not physical product photography unless explicitly requested.\n- Keep text, price, badges and CTA as HTML. Do not bake interface text into images.\n\nA score below 92 means the reconstruction still needs a correction. A contract-breaking draft also cannot pass 92 even if it looks visually close. If it deserves 92+, satisfies the user instructions, AND preserves the DesignPlan contract, return verdict=pass and you may return the source unchanged. Otherwise verdict=fix and return fully revised App.tsx, styles.css and standalone previewHtml. Keep the preview self-contained and script-free.\n\nResolved DesignPlan:\n${JSON.stringify(input.visualSpec).slice(0, 30000)}\n\nCurrent App.tsx:\n${input.appTsx.slice(0, 26000)}\n\nCurrent styles.css:\n${input.stylesCss.slice(0, 26000)}`,
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

  const response = await responsesRequest(env, 'critic', {
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

  const text = extractResponseText(response.payload);
  if (!text) throw new Error('Visual critic returned no output');
  return {
    ...JSON.parse(text),
    provider: response.provider,
    model: response.model,
  };
}
