import { z } from 'zod';

export const DesignModeSchema = z.enum(['reconstruction', 'creation']);

export const DesignTokensSchema = z.object({
  colors: z.object({
    background: z.string().min(1),
    surface: z.string().min(1),
    surfaceElevated: z.string().min(1),
    text: z.string().min(1),
    textMuted: z.string().min(1),
    border: z.string().min(1),
    accent: z.string().min(1),
    accentForeground: z.string().min(1),
    danger: z.string().min(1),
  }).strict(),
  typography: z.object({
    fontDisplay: z.string().min(1),
    fontBody: z.string().min(1),
    fontMono: z.string().min(1),
    textXs: z.string().min(1),
    textSm: z.string().min(1),
    textBase: z.string().min(1),
    textLg: z.string().min(1),
    textXl: z.string().min(1),
    text2xl: z.string().min(1),
    textDisplay: z.string().min(1),
    lineTight: z.string().min(1),
    lineNormal: z.string().min(1),
    weightRegular: z.string().min(1),
    weightMedium: z.string().min(1),
    weightStrong: z.string().min(1),
  }).strict(),
  spacing: z.object({
    xs: z.string().min(1),
    sm: z.string().min(1),
    md: z.string().min(1),
    lg: z.string().min(1),
    xl: z.string().min(1),
    section: z.string().min(1),
  }).strict(),
  geometry: z.object({
    radiusSm: z.string().min(1),
    radiusMd: z.string().min(1),
    radiusLg: z.string().min(1),
    radiusFull: z.string().min(1),
    borderWidth: z.string().min(1),
    containerMaxWidth: z.string().min(1),
  }).strict(),
  elevation: z.object({
    shadowSm: z.string(),
    shadowMd: z.string(),
  }).strict(),
  motion: z.object({
    durationFast: z.string().min(1),
    durationBase: z.string().min(1),
    easing: z.string().min(1),
  }).strict(),
}).strict();

export const ComponentKindSchema = z.enum([
  'pageHeader', 'navMenu', 'hero', 'search', 'button', 'input', 'tabs', 'card',
  'productCard', 'pricingCard', 'grid', 'list', 'sidebar', 'filters', 'table',
  'accordion', 'testimonial', 'footer', 'dialog', 'badge', 'custom',
]);

export const RegistryTierSchema = z.enum(['strict', 'parametric', 'escape']);

export const ComponentNodeSchema = z.object({
  id: z.string().min(1).max(80),
  kind: ComponentKindSchema,
  role: z.string().min(1).max(180),
  tierPreference: RegistryTierSchema,
  children: z.array(z.string().min(1).max(80)).max(24),
  slots: z.array(z.object({
    name: z.string().min(1).max(60),
    contentRole: z.string().min(1).max(160),
    required: z.boolean(),
  }).strict()).max(16),
  layout: z.object({
    display: z.enum(['block', 'flex', 'grid', 'overlay', 'absolute']),
    columns: z.number().int().min(1).max(12),
    gapToken: z.enum(['xs', 'sm', 'md', 'lg', 'xl', 'section']),
    alignment: z.enum(['start', 'center', 'end', 'stretch', 'between']),
    position: z.enum(['flow', 'sticky', 'fixed', 'overlap']),
  }).strict(),
  responsive: z.object({
    desktop: z.string().min(1).max(240),
    tablet: z.string().min(1).max(240),
    mobile: z.string().min(1).max(240),
  }).strict(),
  states: z.object({
    hover: z.string().max(240),
    focus: z.string().max(240),
    active: z.string().max(240),
  }).strict(),
  styleIntent: z.string().min(1).max(360),
  escapeReason: z.string().max(360),
}).strict();

export const AssetRequestSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.string().min(1).max(160),
  prompt: z.string().min(1).max(1200),
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']),
  required: z.boolean(),
}).strict();

export const DesignPlanSchema = z.object({
  version: z.literal('1.0'),
  mode: DesignModeSchema,
  summary: z.string().min(1).max(1200),
  tokens: DesignTokensSchema,
  rootIds: z.array(z.string().min(1).max(80)).min(1).max(24),
  components: z.array(ComponentNodeSchema).min(1).max(80),
  assetRequests: z.array(AssetRequestSchema).max(8),
  globalRules: z.array(z.string().min(1).max(360)).max(24),
  mustMatch: z.array(z.string().min(1).max(360)).max(24),
  intentionalOverrides: z.array(z.string().min(1).max(360)).max(24),
}).strict();

export type DesignPlan = z.infer<typeof DesignPlanSchema>;
export type ComponentNode = z.infer<typeof ComponentNodeSchema>;
export type RegistryTier = z.infer<typeof RegistryTierSchema>;

export const DESIGN_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'string', enum: ['1.0'] },
    mode: { type: 'string', enum: ['reconstruction', 'creation'] },
    summary: { type: 'string' },
    tokens: {
      type: 'object', additionalProperties: false,
      properties: {
        colors: { type: 'object', additionalProperties: false, properties: {
          background: { type: 'string' }, surface: { type: 'string' }, surfaceElevated: { type: 'string' }, text: { type: 'string' }, textMuted: { type: 'string' }, border: { type: 'string' }, accent: { type: 'string' }, accentForeground: { type: 'string' }, danger: { type: 'string' },
        }, required: ['background','surface','surfaceElevated','text','textMuted','border','accent','accentForeground','danger'] },
        typography: { type: 'object', additionalProperties: false, properties: {
          fontDisplay: { type: 'string' }, fontBody: { type: 'string' }, fontMono: { type: 'string' }, textXs: { type: 'string' }, textSm: { type: 'string' }, textBase: { type: 'string' }, textLg: { type: 'string' }, textXl: { type: 'string' }, text2xl: { type: 'string' }, textDisplay: { type: 'string' }, lineTight: { type: 'string' }, lineNormal: { type: 'string' }, weightRegular: { type: 'string' }, weightMedium: { type: 'string' }, weightStrong: { type: 'string' },
        }, required: ['fontDisplay','fontBody','fontMono','textXs','textSm','textBase','textLg','textXl','text2xl','textDisplay','lineTight','lineNormal','weightRegular','weightMedium','weightStrong'] },
        spacing: { type: 'object', additionalProperties: false, properties: {
          xs: { type: 'string' }, sm: { type: 'string' }, md: { type: 'string' }, lg: { type: 'string' }, xl: { type: 'string' }, section: { type: 'string' },
        }, required: ['xs','sm','md','lg','xl','section'] },
        geometry: { type: 'object', additionalProperties: false, properties: {
          radiusSm: { type: 'string' }, radiusMd: { type: 'string' }, radiusLg: { type: 'string' }, radiusFull: { type: 'string' }, borderWidth: { type: 'string' }, containerMaxWidth: { type: 'string' },
        }, required: ['radiusSm','radiusMd','radiusLg','radiusFull','borderWidth','containerMaxWidth'] },
        elevation: { type: 'object', additionalProperties: false, properties: { shadowSm: { type: 'string' }, shadowMd: { type: 'string' } }, required: ['shadowSm','shadowMd'] },
        motion: { type: 'object', additionalProperties: false, properties: { durationFast: { type: 'string' }, durationBase: { type: 'string' }, easing: { type: 'string' } }, required: ['durationFast','durationBase','easing'] },
      },
      required: ['colors','typography','spacing','geometry','elevation','motion'],
    },
    rootIds: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    components: { type: 'array', maxItems: 80, items: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, kind: { type: 'string', enum: ['pageHeader','navMenu','hero','search','button','input','tabs','card','productCard','pricingCard','grid','list','sidebar','filters','table','accordion','testimonial','footer','dialog','badge','custom'] }, role: { type: 'string' }, tierPreference: { type: 'string', enum: ['strict','parametric','escape'] }, children: { type: 'array', items: { type: 'string' }, maxItems: 24 },
        slots: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, contentRole: { type: 'string' }, required: { type: 'boolean' } }, required: ['name','contentRole','required'] } },
        layout: { type: 'object', additionalProperties: false, properties: { display: { type: 'string', enum: ['block','flex','grid','overlay','absolute'] }, columns: { type: 'integer', minimum: 1, maximum: 12 }, gapToken: { type: 'string', enum: ['xs','sm','md','lg','xl','section'] }, alignment: { type: 'string', enum: ['start','center','end','stretch','between'] }, position: { type: 'string', enum: ['flow','sticky','fixed','overlap'] } }, required: ['display','columns','gapToken','alignment','position'] },
        responsive: { type: 'object', additionalProperties: false, properties: { desktop: { type: 'string' }, tablet: { type: 'string' }, mobile: { type: 'string' } }, required: ['desktop','tablet','mobile'] },
        states: { type: 'object', additionalProperties: false, properties: { hover: { type: 'string' }, focus: { type: 'string' }, active: { type: 'string' } }, required: ['hover','focus','active'] },
        styleIntent: { type: 'string' }, escapeReason: { type: 'string' },
      },
      required: ['id','kind','role','tierPreference','children','slots','layout','responsive','states','styleIntent','escapeReason'],
    } },
    assetRequests: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, role: { type: 'string' }, prompt: { type: 'string' }, size: { type: 'string', enum: ['1024x1024','1024x1536','1536x1024'] }, required: { type: 'boolean' } }, required: ['id','role','prompt','size','required'] } },
    globalRules: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    mustMatch: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    intentionalOverrides: { type: 'array', items: { type: 'string' }, maxItems: 24 },
  },
  required: ['version','mode','summary','tokens','rootIds','components','assetRequests','globalRules','mustMatch','intentionalOverrides'],
} as const;

export type RegistryEntry = {
  kind: z.infer<typeof ComponentKindSchema>;
  component: string;
  tier: Exclude<RegistryTier, 'escape'>;
  behavior: string;
};

export const CORE_COMPONENT_REGISTRY: RegistryEntry[] = [
  { kind: 'pageHeader', component: 'SiteHeader', tier: 'parametric', behavior: 'semantic header shell with responsive slots' },
  { kind: 'navMenu', component: 'NavigationMenu', tier: 'strict', behavior: 'keyboard-accessible navigation menu' },
  { kind: 'hero', component: 'HeroSection', tier: 'parametric', behavior: 'layout, alignment and media variants controlled by tokens' },
  { kind: 'search', component: 'SearchField', tier: 'strict', behavior: 'accessible search input and action' },
  { kind: 'button', component: 'Button', tier: 'strict', behavior: 'accessible semantic button variants' },
  { kind: 'input', component: 'Input', tier: 'strict', behavior: 'accessible labeled input states' },
  { kind: 'tabs', component: 'Tabs', tier: 'strict', behavior: 'keyboard-accessible tab behavior' },
  { kind: 'card', component: 'ContentCard', tier: 'parametric', behavior: 'density, border and media variants' },
  { kind: 'productCard', component: 'ProductCard', tier: 'parametric', behavior: 'media ratio, metadata and CTA variants' },
  { kind: 'pricingCard', component: 'PricingCard', tier: 'parametric', behavior: 'pricing hierarchy and featured-state variants' },
  { kind: 'grid', component: 'ResponsiveGrid', tier: 'parametric', behavior: 'tokenized responsive columns and gaps' },
  { kind: 'list', component: 'SemanticList', tier: 'strict', behavior: 'semantic list with density variants' },
  { kind: 'sidebar', component: 'Sidebar', tier: 'parametric', behavior: 'sticky/collapsible responsive sidebar' },
  { kind: 'filters', component: 'FilterGroup', tier: 'parametric', behavior: 'composable filter controls and responsive drawer mode' },
  { kind: 'table', component: 'DataTable', tier: 'parametric', behavior: 'dense data layout with horizontal overflow policy' },
  { kind: 'accordion', component: 'Accordion', tier: 'strict', behavior: 'keyboard-accessible disclosure behavior' },
  { kind: 'testimonial', component: 'TestimonialCard', tier: 'parametric', behavior: 'quote, identity and proof variants' },
  { kind: 'footer', component: 'SiteFooter', tier: 'parametric', behavior: 'column and compact footer layouts' },
  { kind: 'dialog', component: 'Dialog', tier: 'strict', behavior: 'focus-managed accessible dialog' },
  { kind: 'badge', component: 'Badge', tier: 'strict', behavior: 'semantic inline status or metadata badge' },
];

export function routeComponent(node: ComponentNode) {
  const registered = CORE_COMPONENT_REGISTRY.find((entry) => entry.kind === node.kind);
  const wantsEscape = node.kind === 'custom' || node.tierPreference === 'escape';
  const escapeAllowed = wantsEscape && node.escapeReason.trim().length >= 12;

  if (escapeAllowed) {
    return {
      id: node.id,
      kind: node.kind,
      tier: 'escape' as const,
      component: `Custom_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`,
      policy: 'Custom CSS Module or scoped arbitrary utilities allowed only for this component. Colors and typography must still use resolved semantic CSS variables.',
      reason: node.escapeReason,
    };
  }

  if (registered) {
    return {
      id: node.id,
      kind: node.kind,
      tier: registered.tier,
      component: registered.component,
      policy: registered.tier === 'strict'
        ? 'Use registry primitive contract. No arbitrary visual styling inside the primitive.'
        : 'Use registry component with token-driven variants. Scoped layout parameters may follow measured reference geometry.',
      reason: wantsEscape ? 'Escape request denied because no sufficient evidence-based reason was supplied.' : '',
    };
  }

  return {
    id: node.id,
    kind: node.kind,
    tier: 'escape' as const,
    component: `Custom_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`,
    policy: 'Fallback custom component. Semantic tokens remain mandatory for color and typography.',
    reason: node.escapeReason || 'No registry match exists.',
  };
}

export function resolveRegistryPlan(plan: DesignPlan) {
  const ids = new Set(plan.components.map((component) => component.id));
  for (const root of plan.rootIds) {
    if (!ids.has(root)) throw new Error(`Design plan references missing root component: ${root}`);
  }
  for (const component of plan.components) {
    for (const child of component.children) {
      if (!ids.has(child)) throw new Error(`Component ${component.id} references missing child: ${child}`);
    }
  }

  return plan.components.map(routeComponent);
}

export function tokensToCssVariables(tokens: DesignPlan['tokens']) {
  return {
    '--color-background': tokens.colors.background,
    '--color-surface': tokens.colors.surface,
    '--color-surface-elevated': tokens.colors.surfaceElevated,
    '--color-text': tokens.colors.text,
    '--color-text-muted': tokens.colors.textMuted,
    '--color-border': tokens.colors.border,
    '--color-accent': tokens.colors.accent,
    '--color-accent-foreground': tokens.colors.accentForeground,
    '--color-danger': tokens.colors.danger,
    '--font-display': tokens.typography.fontDisplay,
    '--font-body': tokens.typography.fontBody,
    '--font-mono': tokens.typography.fontMono,
    '--text-xs': tokens.typography.textXs,
    '--text-sm': tokens.typography.textSm,
    '--text-base': tokens.typography.textBase,
    '--text-lg': tokens.typography.textLg,
    '--text-xl': tokens.typography.textXl,
    '--text-2xl': tokens.typography.text2xl,
    '--text-display': tokens.typography.textDisplay,
    '--line-tight': tokens.typography.lineTight,
    '--line-normal': tokens.typography.lineNormal,
    '--weight-regular': tokens.typography.weightRegular,
    '--weight-medium': tokens.typography.weightMedium,
    '--weight-strong': tokens.typography.weightStrong,
    '--space-xs': tokens.spacing.xs,
    '--space-sm': tokens.spacing.sm,
    '--space-md': tokens.spacing.md,
    '--space-lg': tokens.spacing.lg,
    '--space-xl': tokens.spacing.xl,
    '--space-section': tokens.spacing.section,
    '--radius-sm': tokens.geometry.radiusSm,
    '--radius-md': tokens.geometry.radiusMd,
    '--radius-lg': tokens.geometry.radiusLg,
    '--radius-full': tokens.geometry.radiusFull,
    '--border-width': tokens.geometry.borderWidth,
    '--container-max-width': tokens.geometry.containerMaxWidth,
    '--shadow-sm': tokens.elevation.shadowSm,
    '--shadow-md': tokens.elevation.shadowMd,
    '--motion-fast': tokens.motion.durationFast,
    '--motion-base': tokens.motion.durationBase,
    '--motion-easing': tokens.motion.easing,
  };
}
