export type ElementSignal = {
  id: string;
  parentId: string | null;
  childIds: string[];
  siblingIndex: number;
  depth: number;
  domPath: string;
  tag: string;
  role: string | null;
  text: string;
  directText: string;
  box: { x: number; y: number; width: number; height: number };
  style: {
    display: string;
    position: string;
    width: string;
    height: string;
    minWidth: string;
    maxWidth: string;
    minHeight: string;
    maxHeight: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    color: string;
    backgroundColor: string;
    backgroundImage: string;
    border: string;
    borderRadius: string;
    boxShadow: string;
    padding: string;
    margin: string;
    gap: string;
    rowGap: string;
    columnGap: string;
    flexDirection: string;
    flexWrap: string;
    flexGrow: string;
    flexShrink: string;
    gridTemplateColumns: string;
    gridTemplateRows: string;
    justifyContent: string;
    alignItems: string;
    overflow: string;
    zIndex: string;
    opacity: string;
    transform: string;
    objectFit: string;
    aspectRatio: string;
  };
  meta: {
    ariaLabel: string | null;
    classHint: string;
    childCount: number;
    mediaKind: string | null;
    signature: string;
  };
};

export type Signal = {
  title: string;
  url: string;
  viewport: { width: number; height: number };
  page: { width: number; height: number };
  visibleElementCount: number;
  structuralRootIds?: string[];
  tokens: Record<string, Array<{ value: string; count: number }>>;
  headings: Array<any>;
  landmarks: Array<any>;
  elements?: ElementSignal[];
};

export function firstValues(list: Array<{ value: string; count: number }> = [], max = 8) {
  return list.slice(0, max).map((x) => x.value);
}

function inferSiteType(signal: Signal) {
  const url = signal.url.toLowerCase();
  const title = signal.title.toLowerCase();
  const headingText = signal.headings.map((h) => String(h.text || '')).join(' ').toLowerCase();
  const elementText = (signal.elements || []).slice(0, 220).map((el) => el.text).join(' ').toLowerCase();
  const text = `${url} ${title} ${headingText} ${elementText}`;

  if (/codecanyon|themeforest|envato|marketplace|browse items|best sellers|top authors|plugins|templates|themes/.test(text)) return 'marketplace';
  if (/dashboard|analytics|workspace|admin|inbox|pipeline/.test(text)) return 'dashboard';
  if (/blog|news|article|stories|magazine|journal/.test(text)) return 'content';
  if (/\bshop\b|\bstore\b|\bcart\b|checkout|add to cart|buy now|catalog/.test(text)) return 'commerce';
  if (/pricing|platform|software|system|developer|team|workflow|api|automation|collaboration/.test(text)) return 'saas';
  return 'landing';
}

function buildRegions(signal: Signal) {
  return signal.landmarks
    .filter((x) => x.box.width > 0 && x.box.height > 0)
    .map((x, index) => ({
      id: x.nodeId || `landmark-${index + 1}`,
      type: x.tag,
      box: x.box,
      classHint: x.classHint || null,
      ariaLabel: x.ariaLabel || null,
    }))
    .slice(0, 100);
}

function buildBands(signal: Signal) {
  const pageHeight = Math.max(signal.page.height || 1, signal.viewport.height || 1);
  const bandHeight = Math.max(520, signal.viewport.height);
  const count = Math.max(1, Math.min(20, Math.ceil(pageHeight / bandHeight)));
  const elements = signal.elements || [];

  return Array.from({ length: count }, (_, index) => {
    const y0 = index * bandHeight;
    const y1 = Math.min(pageHeight, y0 + bandHeight);
    const inBand = elements.filter((el) => {
      const cy = el.box.y + el.box.height / 2;
      return cy >= y0 && cy < y1;
    });
    return {
      index,
      y: y0,
      height: y1 - y0,
      elementCount: inBand.length,
      dominantTags: [...new Set(inBand.map((el) => el.tag))].slice(0, 12),
      nodeIds: inBand.slice(0, 80).map((el) => el.id),
      textAnchors: inBand.filter((el) => el.text).slice(0, 10).map((el) => ({ id: el.id, tag: el.tag, text: el.text, box: el.box })),
    };
  });
}

function structuralScene(signal: Signal, limit = 620) {
  return (signal.elements || []).slice(0, limit).map((el) => ({
    id: el.id,
    parentId: el.parentId,
    childIds: el.childIds,
    siblingIndex: el.siblingIndex,
    depth: el.depth,
    domPath: el.domPath,
    tag: el.tag,
    role: el.role,
    text: el.text,
    directText: el.directText,
    box: el.box,
    style: el.style,
    meta: el.meta,
  }));
}

function repeatedGroups(signal: Signal) {
  const groups = new Map<string, ElementSignal[]>();
  for (const el of signal.elements || []) {
    if (!el.meta.signature) continue;
    const list = groups.get(el.meta.signature) || [];
    list.push(el);
    groups.set(el.meta.signature, list);
  }
  return [...groups.entries()]
    .filter(([, nodes]) => nodes.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 24)
    .map(([signature, nodes], index) => ({
      id: `repeat-${index + 1}`,
      signature,
      count: nodes.length,
      nodeIds: nodes.slice(0, 24).map((node) => node.id),
      representative: {
        tag: nodes[0].tag,
        box: nodes[0].box,
        style: {
          display: nodes[0].style.display,
          borderRadius: nodes[0].style.borderRadius,
          backgroundColor: nodes[0].style.backgroundColor,
          padding: nodes[0].style.padding,
          gap: nodes[0].style.gap,
        },
      },
    }));
}

function measuredSections(signal: Signal) {
  const viewportWidth = Math.max(1, signal.viewport.width);
  const nodes = signal.elements || [];
  const candidates = nodes.filter((node) =>
    /^(header|nav|main|section|article|aside|footer)$/.test(node.tag)
    && node.box.width >= viewportWidth * 0.45
    && node.box.height >= 56,
  );

  return candidates
    .sort((a, b) => a.box.y - b.box.y || a.depth - b.depth)
    .slice(0, 100)
    .map((node) => ({
      id: node.id,
      parentId: node.parentId,
      tag: node.tag,
      depth: node.depth,
      box: node.box,
      childIds: node.childIds,
      textAnchor: node.text.slice(0, 120),
      display: node.style.display,
      gridTemplateColumns: node.style.gridTemplateColumns,
      flexDirection: node.style.flexDirection,
      gap: node.style.gap,
    }));
}

function crossViewportMatches(desktop: Signal, tablet: Signal, mobile: Signal) {
  const tabletById = new Map((tablet.elements || []).map((el) => [el.id, el]));
  const mobileById = new Map((mobile.elements || []).map((el) => [el.id, el]));
  return (desktop.elements || []).slice(0, 520).map((desktopNode) => {
    const tabletNode = tabletById.get(desktopNode.id);
    const mobileNode = mobileById.get(desktopNode.id);
    return {
      id: desktopNode.id,
      desktop: desktopNode.box,
      tablet: tabletNode?.box || null,
      mobile: mobileNode?.box || null,
      display: {
        desktop: desktopNode.style.display,
        tablet: tabletNode?.style.display || null,
        mobile: mobileNode?.style.display || null,
      },
      flexDirection: {
        desktop: desktopNode.style.flexDirection,
        tablet: tabletNode?.style.flexDirection || null,
        mobile: mobileNode?.style.flexDirection || null,
      },
    };
  });
}

function compactNode(node: ElementSignal) {
  return {
    id: node.id,
    parentId: node.parentId,
    childIds: node.childIds.slice(0, 12),
    siblingIndex: node.siblingIndex,
    depth: node.depth,
    tag: node.tag,
    role: node.role,
    text: node.directText || node.text.slice(0, 100),
    box: node.box,
    style: {
      display: node.style.display,
      position: node.style.position,
      fontSize: node.style.fontSize,
      fontWeight: node.style.fontWeight,
      lineHeight: node.style.lineHeight,
      color: node.style.color,
      backgroundColor: node.style.backgroundColor,
      border: node.style.border,
      borderRadius: node.style.borderRadius,
      padding: node.style.padding,
      margin: node.style.margin,
      gap: node.style.gap,
      flexDirection: node.style.flexDirection,
      flexWrap: node.style.flexWrap,
      gridTemplateColumns: node.style.gridTemplateColumns,
      justifyContent: node.style.justifyContent,
      alignItems: node.style.alignItems,
      objectFit: node.style.objectFit,
      aspectRatio: node.style.aspectRatio,
    },
    mediaKind: node.meta.mediaKind,
  };
}

function balancedNodes(signal: Signal, limit: number) {
  const nodes = signal.elements || [];
  if (nodes.length <= limit) return nodes.map(compactNode);
  const pageHeight = Math.max(1, signal.page.height);
  const chosen = new Map<string, ElementSignal>();
  const add = (node?: ElementSignal) => {
    if (node && !chosen.has(node.id) && chosen.size < limit) chosen.set(node.id, node);
  };

  const important = nodes.filter((node) => {
    const interactive = /^(button|a|input|select|textarea|nav|header|footer|main|section|aside|article)$/.test(node.tag);
    const media = Boolean(node.meta.mediaKind);
    const major = node.box.width >= signal.viewport.width * 0.35 && node.box.height >= 56;
    return interactive || media || major;
  });
  for (const node of important.slice(0, Math.floor(limit * 0.42))) add(node);

  const bands = 8;
  const perBand = Math.max(2, Math.floor((limit - chosen.size) / bands));
  for (let band = 0; band < bands && chosen.size < limit; band++) {
    const y0 = (pageHeight * band) / bands;
    const y1 = (pageHeight * (band + 1)) / bands;
    const inBand = nodes.filter((node) => {
      const cy = node.box.y + node.box.height / 2;
      return cy >= y0 && cy < y1;
    });
    for (const node of inBand.slice(0, perBand)) add(node);
  }

  for (const node of nodes) {
    if (chosen.size >= limit) break;
    add(node);
  }

  // Restore selected ancestors so a compact node still has useful containment context.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of [...chosen.values()]) {
    let parentId = node.parentId;
    let guard = 0;
    while (parentId && guard < 5 && chosen.size < limit) {
      const parent = byId.get(parentId);
      if (!parent) break;
      add(parent);
      parentId = parent.parentId;
      guard++;
    }
  }

  return [...chosen.values()]
    .sort((a, b) => a.box.y - b.box.y || a.depth - b.depth || a.siblingIndex - b.siblingIndex)
    .map(compactNode);
}

function compactSections(signal: Signal, limit = 28) {
  const sections = measuredSections(signal);
  if (sections.length <= limit) return sections;
  const out: any[] = [];
  for (let i = 0; i < limit; i++) {
    const index = Math.round((i * (sections.length - 1)) / Math.max(1, limit - 1));
    out.push(sections[index]);
  }
  return out;
}

function buildCodegenBundle(desktop: Signal, tablet: Signal, mobile: Signal, repeats: any[], matches: any[]) {
  const desktopNodes = balancedNodes(desktop, 54);
  const tabletNodes = balancedNodes(tablet, 36);
  const mobileNodes = balancedNodes(mobile, 46);
  const selectedIds = new Set([...desktopNodes, ...tabletNodes, ...mobileNodes].map((node: any) => node.id));
  return {
    version: '2.0-balanced',
    strategy: 'balanced-vertical-and-semantic-sampling',
    desktop: {
      viewport: desktop.viewport,
      page: desktop.page,
      rootIds: desktop.structuralRootIds || [],
      sections: compactSections(desktop, 28),
      nodes: desktopNodes,
    },
    tablet: {
      viewport: tablet.viewport,
      page: tablet.page,
      rootIds: tablet.structuralRootIds || [],
      sections: compactSections(tablet, 22),
      nodes: tabletNodes,
    },
    mobile: {
      viewport: mobile.viewport,
      page: mobile.page,
      rootIds: mobile.structuralRootIds || [],
      sections: compactSections(mobile, 26),
      nodes: mobileNodes,
    },
    repeatedGroups: repeats.slice(0, 16),
    crossViewportMatches: matches.filter((match: any) => selectedIds.has(match.id)).slice(0, 90),
  };
}

export function buildDesignIR(breakpoints: Record<string, Signal>) {
  const desktop = breakpoints.desktop;
  const tablet = breakpoints.tablet;
  const mobile = breakpoints.mobile;
  const regions = buildRegions(desktop);
  const desktopWidth = desktop.viewport.width || 1;
  const contentBoxes = regions.filter((r) => r.type === 'main' || r.type === 'section');
  const widest = contentBoxes.reduce((max, r) => Math.max(max, r.box.width), 0);
  const maxContentWidth = widest > 0 ? widest : desktop.page.width;
  const matches = crossViewportMatches(desktop, tablet, mobile);
  const repeats = repeatedGroups(desktop);
  const tabletMatched = matches.filter((match) => match.tablet).length;
  const mobileMatched = matches.filter((match) => match.mobile).length;
  const codegenBundle = buildCodegenBundle(desktop, tablet, mobile, repeats, matches);

  return {
    version: '2.0.0',
    generatedBy: 'deterministic-structural-browser-analysis',
    reconstructionStrategy: 'structural-first-no-generic-section-collapse',
    siteType: inferSiteType(desktop),
    layout: {
      viewportWidth: desktopWidth,
      pageHeight: desktop.page.height,
      maxContentWidth,
      maxContentRatio: Number((maxContentWidth / desktopWidth).toFixed(3)),
      regionCount: regions.length,
      structuralNodeCount: desktop.elements?.length || 0,
      density: desktop.visibleElementCount > 3000 ? 'high' : desktop.visibleElementCount > 1200 ? 'medium' : 'low',
    },
    tokens: {
      fontFamilies: firstValues(desktop.tokens.fonts, 8),
      fontSizes: firstValues(desktop.tokens.fontSizes, 16),
      fontWeights: firstValues(desktop.tokens.fontWeights, 10),
      textColors: firstValues(desktop.tokens.textColors, 16),
      backgrounds: firstValues(desktop.tokens.backgrounds, 16),
      radii: firstValues(desktop.tokens.radii, 12),
      gaps: firstValues(desktop.tokens.gaps, 12),
    },
    typography: {
      headings: desktop.headings.slice(0, 30).map((h) => ({
        nodeId: h.nodeId || null,
        level: h.tag,
        text: h.text,
        fontSize: h.fontSize,
        fontWeight: h.fontWeight,
        lineHeight: h.lineHeight,
        box: h.box,
      })),
    },
    regions,
    bands: buildBands(desktop),
    structuralSnapshot: {
      desktop: {
        // Placed first intentionally: compactJson in the LLM path sees a balanced
        // desktop/tablet/mobile evidence pack before verbose acceptance data.
        codegenBundle,
        rootIds: desktop.structuralRootIds || [],
        nodes: structuralScene(desktop, 620),
        sections: measuredSections(desktop),
      },
      tablet: { rootIds: tablet.structuralRootIds || [], nodes: structuralScene(tablet, 520), sections: measuredSections(tablet) },
      mobile: { rootIds: mobile.structuralRootIds || [], nodes: structuralScene(mobile, 560), sections: measuredSections(mobile) },
    },
    repeatedGroups: repeats,
    crossViewportMatches: matches,
    responsive: {
      desktop: { viewport: desktop.viewport, page: desktop.page, visibleElements: desktop.visibleElementCount },
      tablet: { viewport: tablet.viewport, page: tablet.page, visibleElements: tablet.visibleElementCount, matchedNodes: tabletMatched },
      mobile: { viewport: mobile.viewport, page: mobile.page, visibleElements: mobile.visibleElementCount, matchedNodes: mobileMatched },
      desktopStructuralNodes: desktop.elements?.length || 0,
      tabletMatchRatio: Number((tabletMatched / Math.max(1, matches.length)).toFixed(3)),
      mobileMatchRatio: Number((mobileMatched / Math.max(1, matches.length)).toFixed(3)),
    },
    uncertainty: [
      'Rendered structure is measured from browser output rather than source framework components',
      'Canvas/WebGL internals and some pseudo-elements remain opaque',
      'Third-party proprietary media is measured but replaced with original generated media',
    ],
  };
}

export function buildComponentPlan(ir: any, signal: Signal) {
  return {
    version: '2.0.0',
    strategy: 'structural-compiler',
    frameworkTarget: 'React + CSS',
    siteType: ir.siteType,
    structuralRoots: ir.structuralSnapshot?.desktop?.rootIds || signal.structuralRootIds || [],
    codegenBundle: ir.structuralSnapshot?.desktop?.codegenBundle || null,
    sections: ir.structuralSnapshot?.desktop?.sections || [],
    repeatedGroups: ir.repeatedGroups || [],
    responsiveEvidence: {
      tabletMatchRatio: ir.responsive?.tabletMatchRatio,
      mobileMatchRatio: ir.responsive?.mobileMatchRatio,
    },
    components: [],
    compilerRules: [
      'Preserve measured parent-child-sibling structure before semantic component naming',
      'Preserve section order, measured widths, heights, gaps, padding and alignment',
      'Use repeatedGroups to reconstruct repeated cards/items rather than inventing generic cards',
      'Derive responsive reflow from matching stable node ids across desktop/tablet/mobile',
      'Do not introduce a HeroSection unless the measured tree actually has hero-like geometry',
      'Registry primitives are optional behavior helpers, never a reconstruction template',
    ],
    constraints: {
      noGenericSectionCollapse: true,
      noSourceFrameworkAssumption: true,
      noThirdPartyAssetCopy: true,
      preserveResponsiveIntent: true,
      preserveMeasuredGeometry: true,
      structuralEvidenceOverridesRegistry: true,
    },
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeColor(value: unknown, fallback: string) {
  const v = String(value || '').trim();
  return /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\))$/.test(v) ? v : fallback;
}

export function buildGeneratedPreview(ir: any, _plan: any, signal: Signal) {
  const bg = safeColor(ir.tokens.backgrounds?.[0], '#0b0d12');
  const text = safeColor(ir.tokens.textColors?.[0], '#f5f7fb');
  const title = escapeHtml(signal.title || 'Reference captured');
  const html = `<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>*{box-sizing:border-box}body{margin:0;padding:48px;font:500 16px/1.5 system-ui;background:${bg};color:${text}}main{max-width:900px;margin:auto}h1{font-size:42px;line-height:1.05}pre{white-space:pre-wrap;opacity:.7}</style></head><body><main><h1>${title}</h1><p>Structural evidence captured. AI reconstruction was unavailable, so no fabricated design fallback is shown.</p><pre>nodes: ${Number(ir.layout?.structuralNodeCount || 0)}\nsections: ${Number(ir.structuralSnapshot?.desktop?.sections?.length || 0)}\nsite type: ${escapeHtml(ir.siteType)}</pre></main></body></html>`;
  return {
    version: '2.0.0',
    mode: 'structural-evidence-fallback',
    html,
    sandboxRecommended: true,
    aiCalls: 0,
    note: 'Fallback intentionally avoids generating a fake generic website.',
  };
}
