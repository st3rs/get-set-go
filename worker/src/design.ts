export type Signal = {
  title: string;
  url: string;
  viewport: { width: number; height: number };
  page: { width: number; height: number };
  visibleElementCount: number;
  tokens: Record<string, Array<{ value: string; count: number }>>;
  headings: Array<any>;
  landmarks: Array<any>;
};

export function firstValues(list: Array<{ value: string; count: number }> = [], max = 8) {
  return list.slice(0, max).map((x) => x.value);
}

function inferSiteType(signal: Signal) {
  const title = signal.title.toLowerCase();
  const headingText = signal.headings.map((h) => String(h.text || '')).join(' ').toLowerCase();
  const text = `${title} ${headingText}`;
  if (/shop|store|cart|checkout|product/.test(text)) return 'commerce';
  if (/dashboard|analytics|workspace|admin/.test(text)) return 'dashboard';
  if (/blog|news|article|stories/.test(text)) return 'content';
  if (/pricing|product|platform|software|system|developer|team/.test(text)) return 'saas';
  return 'landing';
}

function buildRegions(signal: Signal) {
  const seen = new Set<string>();
  return signal.landmarks
    .filter((x) => x.box.width > 0 && x.box.height > 0)
    .map((x, index) => {
      const raw = x.ariaLabel || x.id || x.classHint || `${x.tag}-${index + 1}`;
      const id = String(raw).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `${x.tag}-${index + 1}`;
      const unique = seen.has(id) ? `${id}-${index + 1}` : id;
      seen.add(unique);
      return { id: unique, type: x.tag, box: x.box };
    })
    .slice(0, 32);
}

export function buildDesignIR(breakpoints: Record<string, Signal>) {
  const desktop = breakpoints.desktop;
  const tablet = breakpoints.tablet;
  const mobile = breakpoints.mobile;
  const regions = buildRegions(desktop);
  const regionTypes = [...new Set(regions.map((r) => r.type))];
  const components = [
    regionTypes.includes('nav') ? 'Navigation' : null,
    regionTypes.includes('header') ? 'Header' : null,
    desktop.headings.some((h) => h.tag === 'H1') ? 'HeroOrPrimaryHeading' : null,
    regionTypes.includes('section') ? 'SectionGroup' : null,
    regionTypes.includes('aside') ? 'Aside' : null,
    regionTypes.includes('footer') ? 'Footer' : null,
  ].filter(Boolean);

  const desktopWidth = desktop.viewport.width || 1;
  const contentBoxes = regions.filter((r) => r.type === 'main' || r.type === 'section');
  const widest = contentBoxes.reduce((max, r) => Math.max(max, r.box.width), 0);
  const maxContentWidth = widest > 0 ? widest : desktop.page.width;
  const mobileStructuralDelta = Math.abs((desktop.landmarks?.length || 0) - (mobile.landmarks?.length || 0));
  const tabletStructuralDelta = Math.abs((desktop.landmarks?.length || 0) - (tablet.landmarks?.length || 0));

  return {
    version: '0.3.0',
    generatedBy: 'deterministic-browser-analysis',
    siteType: inferSiteType(desktop),
    layout: {
      viewportWidth: desktopWidth,
      pageHeight: desktop.page.height,
      maxContentWidth,
      maxContentRatio: Number((maxContentWidth / desktopWidth).toFixed(3)),
      regionCount: regions.length,
      density: desktop.visibleElementCount > 3000 ? 'high' : desktop.visibleElementCount > 1200 ? 'medium' : 'low',
    },
    tokens: {
      fontFamilies: firstValues(desktop.tokens.fonts, 6),
      fontSizes: firstValues(desktop.tokens.fontSizes, 10),
      fontWeights: firstValues(desktop.tokens.fontWeights, 8),
      textColors: firstValues(desktop.tokens.textColors, 10),
      backgrounds: firstValues(desktop.tokens.backgrounds, 10),
      radii: firstValues(desktop.tokens.radii, 8),
      gaps: firstValues(desktop.tokens.gaps, 8),
    },
    typography: {
      headings: desktop.headings.slice(0, 12).map((h) => ({
        level: h.tag,
        text: h.text,
        fontSize: h.fontSize,
        fontWeight: h.fontWeight,
        lineHeight: h.lineHeight,
        box: h.box,
      })),
    },
    regions,
    components,
    responsive: {
      desktop: { viewport: desktop.viewport, page: desktop.page, visibleElements: desktop.visibleElementCount },
      tablet: { viewport: tablet.viewport, page: tablet.page, visibleElements: tablet.visibleElementCount, structuralDelta: tabletStructuralDelta },
      mobile: { viewport: mobile.viewport, page: mobile.page, visibleElements: mobile.visibleElementCount, structuralDelta: mobileStructuralDelta },
      likelyResponsiveReflow: mobile.page.height !== desktop.page.height || mobileStructuralDelta > 0,
    },
    uncertainty: [
      'No visual-model interpretation used',
      'Interactive states, animation timing, pseudo-elements and canvas/WebGL visuals are not semantically interpreted yet',
      'Component names are inferred from structural HTML landmarks, not source framework components',
    ],
  };
}

export function buildComponentPlan(ir: any, signal: Signal) {
  const has = (type: string) => ir.regions.some((r: any) => r.type === type);
  const primaryHeading = signal.headings.find((h) => h.tag === 'H1') || signal.headings[0];
  const sectionCount = Math.max(1, Math.min(8, ir.regions.filter((r: any) => r.type === 'section').length));
  const plan: any[] = [];

  if (has('nav') || has('header')) {
    plan.push({ id: 'site-header', component: 'SiteHeader', role: 'navigation', evidence: ['header/nav landmark'], responsive: 'collapse-or-wrap on narrow viewports' });
  }

  plan.push({
    id: 'primary',
    component: ir.siteType === 'dashboard' ? 'DashboardHeader' : 'HeroSection',
    role: 'primary-message',
    evidence: [primaryHeading?.text ? `heading:${String(primaryHeading.text).slice(0, 80)}` : 'first visible heading'],
    responsive: 'stack content and actions on mobile',
  });

  if (ir.siteType === 'dashboard') {
    plan.push({ id: 'workspace', component: 'DashboardGrid', role: 'operational-content', evidence: [`density:${ir.layout.density}`], responsive: 'reduce columns by viewport' });
  } else if (ir.siteType === 'commerce') {
    plan.push({ id: 'catalog', component: 'ProductGrid', role: 'catalog-content', evidence: [`sections:${sectionCount}`], responsive: 'responsive card grid' });
  } else if (ir.siteType === 'content') {
    plan.push({ id: 'content-feed', component: 'ContentFeed', role: 'editorial-content', evidence: [`sections:${sectionCount}`], responsive: 'single column on mobile' });
  } else {
    plan.push({ id: 'sections', component: 'SectionStack', role: 'supporting-content', evidence: [`sections:${sectionCount}`], responsive: 'stack sections vertically' });
  }

  if (has('aside')) plan.push({ id: 'aside', component: 'AsidePanel', role: 'secondary-content', evidence: ['aside landmark'], responsive: 'move below primary content' });
  if (has('footer')) plan.push({ id: 'footer', component: 'SiteFooter', role: 'footer', evidence: ['footer landmark'], responsive: 'wrap columns' });

  return {
    version: '0.3.0',
    strategy: 'structure-first',
    frameworkTarget: 'React + CSS/Tailwind compatible',
    components: plan,
    constraints: {
      noSourceFrameworkAssumption: true,
      noThirdPartyAssetCopy: true,
      preserveResponsiveIntent: true,
    },
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeColor(value: unknown, fallback: string) {
  const v = String(value || '').trim();
  return /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\))$/.test(v) ? v : fallback;
}

function safeSize(value: unknown, fallback: string) {
  const v = String(value || '').trim();
  return /^\d+(\.\d+)?(px|rem|em)$/.test(v) ? v : fallback;
}

export function buildGeneratedPreview(ir: any, plan: any, signal: Signal) {
  const bg = safeColor(ir.tokens.backgrounds?.[0], '#0b0d12');
  const text = safeColor(ir.tokens.textColors?.[0], '#f5f7fb');
  const border = safeColor(ir.tokens.textColors?.[3], 'rgba(127,127,127,.24)');
  const radius = safeSize(ir.tokens.radii?.[0], '14px');
  const h1 = signal.headings.find((h) => h.tag === 'H1');
  const title = escapeHtml(h1?.text || signal.title || 'Generated interface');
  const secondaryHeadings = signal.headings.filter((h) => h !== h1 && h.text).slice(0, 5);
  const items = secondaryHeadings.length
    ? secondaryHeadings.map((h, index) => `<article class="card"><small>0${index + 1}</small><h2>${escapeHtml(h.text)}</h2><p>Reconstructed from structural and computed-style evidence.</p></article>`).join('')
    : Array.from({ length: 3 }, (_, index) => `<article class="card"><small>0${index + 1}</small><h2>Supporting section</h2><p>Structure-first generated block.</p></article>`).join('');
  const nav = plan.components.some((x: any) => x.component === 'SiteHeader')
    ? `<header><strong>${escapeHtml(signal.title.split('—')[0].trim().slice(0, 36) || 'Reference')}</strong><nav><span>Overview</span><span>Product</span><span>Resources</span></nav><button>Get started</button></header>`
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:${bg};color:${text}}body{padding:0 5vw 8vh}header{height:76px;display:flex;align-items:center;gap:28px;border-bottom:1px solid ${border}}header nav{margin-left:auto;display:flex;gap:22px;opacity:.68;font-size:13px}button{border:1px solid ${border};background:${text};color:${bg};border-radius:${radius};padding:11px 15px;font-weight:750}.hero{padding:11vh 0 8vh;max-width:min(980px,90vw)}.eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;opacity:.5}.hero h1{font-size:clamp(44px,7vw,88px);letter-spacing:-.055em;line-height:.98;margin:18px 0 24px}.hero p{max-width:680px;font-size:17px;line-height:1.65;opacity:.64}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{min-height:190px;border:1px solid ${border};border-radius:${radius};padding:22px;background:color-mix(in srgb,${bg} 92%,${text} 8%)}.card small{opacity:.42}.card h2{font-size:20px;line-height:1.15;margin:35px 0 12px}.card p{font-size:13px;line-height:1.55;opacity:.58}@media(max-width:760px){body{padding:0 20px 50px}header nav{display:none}.hero{padding-top:70px}.grid{grid-template-columns:1fr}.hero h1{font-size:48px}}
</style></head><body>${nav}<main><section class="hero"><div class="eyebrow">${escapeHtml(ir.siteType)} · generated from design IR</div><h1>${title}</h1><p>Structure-first preview generated without a model call. Typography, density, regions and responsive intent come from browser evidence.</p></section><section class="grid">${items}</section></main></body></html>`;

  return {
    version: '0.3.0',
    mode: 'deterministic-structure-preview',
    html,
    sandboxRecommended: true,
    aiCalls: 0,
    note: 'This is a structural preview, not final pixel-level reconstruction.',
  };
}
