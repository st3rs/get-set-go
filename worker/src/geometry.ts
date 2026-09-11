type Box = { x: number; y: number; width: number; height: number };

export type GeneratedGeometry = {
  page: { width: number; height: number };
  viewport: { width: number; height: number };
  nodes: Array<{ id: string; box: Box }>;
};

function clamp(value: number, min = 0, max = 2) {
  return Math.max(min, Math.min(max, value));
}

export async function extractGeneratedGeometry(page: any): Promise<GeneratedGeometry> {
  return page.evaluate(() => ({
    page: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    viewport: { width: innerWidth, height: innerHeight },
    nodes: Array.from(document.querySelectorAll<HTMLElement>('[data-ref-id]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute('data-ref-id') || '',
          box: {
            x: Math.round(r.x),
            y: Math.round(r.y + scrollY),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
        };
      })
      .filter((item) => item.id && item.box.width > 0 && item.box.height > 0),
  }));
}

export async function screenshotLumaSimilarity(page: any, referenceDataUrl: string, generatedDataUrl: string) {
  return page.evaluate(async ({ referenceDataUrl, generatedDataUrl }: { referenceDataUrl: string; generatedDataUrl: string }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode screenshot for comparison'));
      image.src = src;
    });
    const [reference, generated] = await Promise.all([load(referenceDataUrl), load(generatedDataUrl)]);
    const width = 128;
    const height = 80;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.drawImage(reference, 0, 0, width, height);
    const a = ctx.getImageData(0, 0, width, height).data;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(generated, 0, 0, width, height);
    const b = ctx.getImageData(0, 0, width, height).data;

    let diff = 0;
    let count = 0;
    for (let i = 0; i < a.length; i += 4) {
      const la = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
      const lb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
      diff += Math.abs(la - lb) / 255;
      count++;
    }
    return Number((1 - diff / Math.max(1, count)).toFixed(3));
  }, { referenceDataUrl, generatedDataUrl });
}

function referenceTargets(designIR: any, viewportName: 'desktop' | 'mobile') {
  const snapshot = designIR?.structuralSnapshot?.[viewportName];
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const viewportWidth = Number(viewportName === 'desktop' ? designIR?.responsive?.desktop?.viewport?.width : designIR?.responsive?.mobile?.viewport?.width) || 1;
  const repeatedIds = new Set<string>();
  for (const group of designIR?.repeatedGroups || []) {
    for (const id of group?.nodeIds || []) repeatedIds.add(id);
  }

  return nodes.filter((node: any) => {
    const tag = String(node?.tag || '').toLowerCase();
    const media = Boolean(node?.meta?.mediaKind);
    const structural = /^(header|nav|main|section|article|aside|footer|form|ul|ol|li)$/.test(tag);
    const interactive = /^(button|a|input|select|textarea)$/.test(tag);
    const major = Number(node?.box?.width || 0) >= viewportWidth * 0.22 && Number(node?.box?.height || 0) >= 48;
    return structural || interactive || media || repeatedIds.has(node?.id) || major;
  }).slice(0, viewportName === 'desktop' ? 220 : 180);
}

export function compareGeometry(designIR: any, viewportName: 'desktop' | 'mobile', generated: GeneratedGeometry) {
  const targets = referenceTargets(designIR, viewportName);
  const generatedById = new Map(generated.nodes.map((node) => [node.id, node]));
  const matches = targets.filter((target: any) => generatedById.has(target.id));
  const viewport = generated.viewport;

  let positionError = 0;
  let sizeError = 0;
  for (const target of matches) {
    const actual = generatedById.get(target.id)!;
    const ref = target.box as Box;
    positionError += (
      clamp(Math.abs(actual.box.x - ref.x) / Math.max(1, viewport.width))
      + clamp(Math.abs(actual.box.y - ref.y) / Math.max(1, viewport.height))
    ) / 2;
    sizeError += (
      clamp(Math.abs(actual.box.width - ref.width) / Math.max(1, ref.width))
      + clamp(Math.abs(actual.box.height - ref.height) / Math.max(1, ref.height))
    ) / 2;
  }

  const coverage = matches.length / Math.max(1, targets.length);
  const meanPositionError = matches.length ? positionError / matches.length : 2;
  const meanSizeError = matches.length ? sizeError / matches.length : 2;
  const referencePageHeight = Number(designIR?.responsive?.[viewportName]?.page?.height || designIR?.layout?.pageHeight || 1);
  const pageHeightError = Math.abs(generated.page.height - referencePageHeight) / Math.max(1, referencePageHeight);

  const thresholds = viewportName === 'desktop'
    ? { coverage: 0.55, position: 0.22, size: 0.34, pageHeight: 0.28 }
    : { coverage: 0.45, position: 0.25, size: 0.38, pageHeight: 0.32 };

  const passed = coverage >= thresholds.coverage
    && meanPositionError <= thresholds.position
    && meanSizeError <= thresholds.size
    && pageHeightError <= thresholds.pageHeight;

  return {
    viewport: viewportName,
    passed,
    targets: targets.length,
    matched: matches.length,
    coverage: Number(coverage.toFixed(3)),
    meanPositionError: Number(meanPositionError.toFixed(3)),
    meanSizeError: Number(meanSizeError.toFixed(3)),
    pageHeightError: Number(pageHeightError.toFixed(3)),
    referencePageHeight,
    generatedPageHeight: generated.page.height,
    thresholds,
  };
}

export function objectiveGate(designIR: any, desktop: GeneratedGeometry, mobile: GeneratedGeometry, similarity?: { desktop: number; mobile: number }) {
  const desktopMetrics = compareGeometry(designIR, 'desktop', desktop);
  const mobileMetrics = compareGeometry(designIR, 'mobile', mobile);
  const screenshotThresholds = { desktop: 0.45, mobile: 0.42 };
  const screenshotPassed = similarity
    ? similarity.desktop >= screenshotThresholds.desktop && similarity.mobile >= screenshotThresholds.mobile
    : true;
  return {
    passed: desktopMetrics.passed && mobileMetrics.passed && screenshotPassed,
    desktop: desktopMetrics,
    mobile: mobileMetrics,
    screenshot: similarity ? {
      ...similarity,
      thresholds: screenshotThresholds,
      passed: screenshotPassed,
    } : null,
  };
}
