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

type UserInstructions = { main: string; steps: string[] };

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

export async function runVisualCritic(env: AiEnv, input: {
  target: string;
  visualSpec: any;
  appTsx: string;
  stylesCss: string;
  previewHtml: string;
  originalDesktop: string;
  generatedDesktop: string;
  originalMobile?: string;
  generatedMobile?: string;
  objectiveMetrics?: any;
  userInstructions?: UserInstructions;
}) {
  const instructions = instructionText(input.userInstructions);
  const content: any[] = [{
    type: 'input_text',
    text: `You are a correction pass inside a STRUCTURAL website reconstruction engine. You are not the acceptance authority. Deterministic browser geometry is the acceptance authority.\n\nTarget: ${input.target}\n\n${instructions}\n\nOBJECTIVE GEOMETRY METRICS FROM THE ACTUAL GENERATED DOM:\n${JSON.stringify(input.objectiveMetrics || null).slice(0, 12000)}\n\nCORRECTION PRIORITY:\n- Fix the objective failures first: missing data-ref-id coverage, x/y alignment, widths/heights, page height, section order and responsive geometry.\n- Preserve every existing valid data-ref-id attribute. Never delete, rename, invent, or move a data-ref-id to an unrelated element.\n- The same source node id must remain attached to the DOM element reconstructing that measured node.\n- Explicit user instructions are intentional overrides. Do not undo them.\n- For all non-overridden aspects, reference screenshots and structural evidence are truth.\n- Do NOT normalize editorial, brutalist, dense fintech or marketplace layouts into generic SaaS cards.\n- Preserve semantic tokens, but exact evidence-backed reconstruction geometry is allowed.\n- Preserve all generated image data URLs and product media. Never replace product imagery with placeholders, gradients, emoji or icons.\n\nYour visual score is only a secondary diagnostic. A draft whose objectiveMetrics.passed=false MUST return verdict=fix regardless of how attractive it looks. Compare macro layout, section proportions, density, typography, media footprint and mobile behavior. Return complete revised App.tsx, styles.css and standalone script-free previewHtml.\n\nSTRUCTURAL/DESIGN SPEC:\n${JSON.stringify(input.visualSpec).slice(0, 36000)}\n\nCurrent App.tsx:\n${input.appTsx.slice(0, 30000)}\n\nCurrent styles.css:\n${input.stylesCss.slice(0, 30000)}`,
  },
  { type: 'input_text', text: 'REFERENCE desktop:' },
  { type: 'input_image', image_url: input.originalDesktop, detail: 'high' },
  { type: 'input_text', text: 'GENERATED desktop:' },
  { type: 'input_image', image_url: input.generatedDesktop, detail: 'high' }];

  if (input.originalMobile && input.generatedMobile) {
    content.push({ type: 'input_text', text: 'REFERENCE mobile:' });
    content.push({ type: 'input_image', image_url: input.originalMobile, detail: 'high' });
    content.push({ type: 'input_text', text: 'GENERATED mobile:' });
    content.push({ type: 'input_image', image_url: input.generatedMobile, detail: 'high' });
  }

  const response = await responsesRequest(env, 'critic', {
    reasoning: { effort: 'high' },
    input: [{ role: 'user', content }],
    text: { verbosity: 'medium', format: { type: 'json_schema', name: 'structural_visual_critic_result', strict: true, schema: CRITIC_SCHEMA } },
  });

  const text = extractResponseText(response.payload);
  if (!text) throw new Error('Visual critic returned no output');
  return { ...JSON.parse(text), provider: response.provider, model: response.model };
}
