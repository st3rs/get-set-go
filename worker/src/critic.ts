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
  },
) {
  const content: any[] = [
    {
      type: 'input_text',
      text: `You are the final visual QA and correction pass for a website reconstruction engine.\n\nTarget: ${input.target}\n\nYour task is NOT to praise the draft. Compare the generated render against the reference and correct the implementation. Judge: macro layout, section proportions, alignment, whitespace rhythm, typography scale/weight, color relationships, borders/radii, density, visual hierarchy, media footprint, image crop, and mobile behavior.\n\nPRODUCT / COMMERCE QUALITY RULES:\n- If the reference contains product cards or product tiles, prominent cards must include believable product media with approximately matching aspect ratio, crop, visual weight and backdrop.\n- Empty media rectangles, generic gradients, emoji, icons standing in for products, obviously synthetic placeholder blocks, repeated identical fake thumbnails when the reference shows variety, stretched imagery, poor object-fit, or missing product imagery are major failures.\n- A commerce reconstruction with visibly weak/missing product media MUST NOT receive a score of 92 or higher.\n- Keep text, price, badges and CTA as HTML. Do not bake interface text into images.\n\nA score below 92 means the reconstruction still needs a correction. If it already deserves 92+, return verdict=pass and you may return the source unchanged. Otherwise verdict=fix and return fully revised App.tsx, styles.css and standalone previewHtml. Do not add generic visual effects unsupported by the reference. Keep the preview self-contained and script-free.\n\nVisual spec:\n${JSON.stringify(input.visualSpec).slice(0, 26000)}\n\nCurrent App.tsx:\n${input.appTsx.slice(0, 26000)}\n\nCurrent styles.css:\n${input.stylesCss.slice(0, 26000)}`,
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
