import type { ElementSignal, Signal } from './design';

export async function extractRichSignals(page: any): Promise<Signal> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    const visible = all.filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
    });
    const visibleSet = new Set(visible);

    const top = (values: string[], limit = 10) => {
      const counts = new Map<string, number>();
      for (const raw of values) {
        const value = String(raw || '').trim();
        if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)' || value === '0px') continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
    };

    const sample = visible.slice(0, 1600).map((el) => {
      const s = getComputedStyle(el);
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        color: s.color,
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
        gap: s.gap,
      };
    });

    const pathFor = (el: HTMLElement) => {
      const parts: string[] = [];
      let current: HTMLElement | null = el;
      let guard = 0;
      while (current && current !== document.body && guard < 12) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
        const nth = Math.max(1, sameTag.indexOf(current) + 1);
        parts.push(`${tag}:nth-of-type(${nth})`);
        current = parent;
        guard++;
      }
      return `body>${parts.reverse().join('>')}`;
    };

    const hash = (value: string) => {
      let h = 2166136261;
      for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(36);
    };

    const scoreElement = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const s = getComputedStyle(el);
      let score = Math.min(40, Math.round((r.width * r.height) / 12000));
      if (/^(img|picture|video|canvas|svg)$/.test(tag)) score += 48;
      if (/^(button|a|input|select|textarea)$/.test(tag)) score += 22;
      if (/^(article|section|header|nav|footer|aside|main)$/.test(tag)) score += 24;
      if (/grid|flex/.test(s.display)) score += 16;
      if (s.backgroundImage && s.backgroundImage !== 'none') score += 28;
      if (s.position === 'fixed' || s.position === 'sticky') score += 14;
      const txt = (el.innerText || '').trim();
      if (txt && txt.length <= 180) score += 6;
      return score;
    };

    const primary = visible
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const s = getComputedStyle(el);
        if (r.width < 20 || r.height < 16) return false;
        return /^(img|picture|video|canvas|svg|button|a|input|select|textarea|article|section|header|nav|footer|aside|main|form|ul|ol|li)$/.test(tag)
          || /grid|flex/.test(s.display)
          || (s.backgroundImage && s.backgroundImage !== 'none')
          || (r.width >= innerWidth * 0.18 && r.height >= 64);
      })
      .map((el) => ({ el, score: scoreElement(el) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 380)
      .map(({ el }) => el);

    // Preserve the real containment tree. Every important node brings its visible
    // ancestors with it so parent/child relationships survive evidence compaction.
    const selectedSet = new Set<HTMLElement>();
    for (const el of primary) {
      selectedSet.add(el);
      let parent = el.parentElement;
      let guard = 0;
      while (parent && parent !== document.body && guard < 10) {
        if (visibleSet.has(parent)) selectedSet.add(parent);
        parent = parent.parentElement;
        guard++;
      }
    }
    const selected = visible.filter((el) => selectedSet.has(el)).slice(0, 720);

    const idMap = new Map<HTMLElement, string>();
    const pathMap = new Map<HTMLElement, string>();
    for (const el of selected) {
      const path = pathFor(el);
      pathMap.set(el, path);
      idMap.set(el, `n_${hash(path)}`);
    }

    const nearestSelectedParent = (el: HTMLElement) => {
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        if (idMap.has(parent)) return parent;
        parent = parent.parentElement;
      }
      return null;
    };

    const childIds = new Map<string, string[]>();
    for (const el of selected) {
      const id = idMap.get(el)!;
      childIds.set(id, []);
    }
    for (const el of selected) {
      const parent = nearestSelectedParent(el);
      if (!parent) continue;
      childIds.get(idMap.get(parent)!)?.push(idMap.get(el)!);
    }

    const directText = (el: HTMLElement) => Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 180);

    const elements: ElementSignal[] = selected.map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const parent = nearestSelectedParent(el);
      const mediaKind = /^(img|picture|video|canvas|svg)$/.test(tag)
        ? tag
        : s.backgroundImage && s.backgroundImage !== 'none'
          ? 'background-image'
          : null;
      const parentChildren = el.parentElement ? Array.from(el.parentElement.children) : [];
      const siblingIndex = Math.max(0, parentChildren.indexOf(el));
      let depth = 0;
      let cursor: HTMLElement | null = el.parentElement;
      while (cursor && cursor !== document.body) {
        depth++;
        cursor = cursor.parentElement;
      }
      const signature = [
        tag,
        s.display,
        s.position,
        el.children.length,
        mediaKind || '-',
        s.borderRadius,
        s.fontSize,
        Math.round(r.width / 20) * 20,
        Math.round(r.height / 20) * 20,
      ].join('|');

      return {
        id: idMap.get(el)!,
        parentId: parent ? idMap.get(parent)! : null,
        childIds: childIds.get(idMap.get(el)!) || [],
        siblingIndex,
        depth,
        domPath: pathMap.get(el)!,
        tag,
        role: el.getAttribute('role'),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 220),
        directText: directText(el),
        box: {
          x: Math.round(r.x),
          y: Math.round(r.y + scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
        style: {
          display: s.display,
          position: s.position,
          width: s.width,
          height: s.height,
          minWidth: s.minWidth,
          maxWidth: s.maxWidth,
          minHeight: s.minHeight,
          maxHeight: s.maxHeight,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          lineHeight: s.lineHeight,
          letterSpacing: s.letterSpacing,
          color: s.color,
          backgroundColor: s.backgroundColor,
          backgroundImage: s.backgroundImage,
          border: s.border,
          borderRadius: s.borderRadius,
          boxShadow: s.boxShadow,
          padding: s.padding,
          margin: s.margin,
          gap: s.gap,
          rowGap: s.rowGap,
          columnGap: s.columnGap,
          flexDirection: s.flexDirection,
          flexWrap: s.flexWrap,
          flexGrow: s.flexGrow,
          flexShrink: s.flexShrink,
          gridTemplateColumns: s.gridTemplateColumns,
          gridTemplateRows: s.gridTemplateRows,
          justifyContent: s.justifyContent,
          alignItems: s.alignItems,
          overflow: s.overflow,
          zIndex: s.zIndex,
          opacity: s.opacity,
          transform: s.transform,
          objectFit: s.objectFit,
          aspectRatio: s.aspectRatio,
        },
        meta: {
          ariaLabel: el.getAttribute('aria-label'),
          classHint: String(el.className || '').slice(0, 180),
          childCount: el.children.length,
          mediaKind,
          signature,
        },
      };
    });

    const elementByDom = new Map(selected.map((el) => [el, idMap.get(el)!]));

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .slice(0, 80)
      .map((el) => {
        const node = el as HTMLElement;
        const r = node.getBoundingClientRect();
        const s = getComputedStyle(node);
        return {
          nodeId: elementByDom.get(node) || null,
          tag: node.tagName,
          text: (node.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 280),
          box: { x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          lineHeight: s.lineHeight,
        };
      });

    const landmarks = Array.from(document.querySelectorAll('header,nav,main,section,article,aside,footer'))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .slice(0, 220)
      .map((el) => {
        const node = el as HTMLElement;
        const r = node.getBoundingClientRect();
        const s = getComputedStyle(node);
        return {
          nodeId: elementByDom.get(node) || null,
          tag: node.tagName.toLowerCase(),
          ariaLabel: node.getAttribute('aria-label'),
          id: node.id || null,
          classHint: String(node.className || '').slice(0, 180),
          box: { x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
          display: s.display,
          gridTemplateColumns: s.gridTemplateColumns,
          gap: s.gap,
        };
      });

    const rootIds = elements.filter((el) => !el.parentId).map((el) => el.id);

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      visibleElementCount: visible.length,
      structuralRootIds: rootIds,
      tokens: {
        fonts: top(sample.map((x) => x.fontFamily), 10),
        fontSizes: top(sample.map((x) => x.fontSize), 18),
        fontWeights: top(sample.map((x) => x.fontWeight), 12),
        textColors: top(sample.map((x) => x.color), 18),
        backgrounds: top(sample.map((x) => x.backgroundColor), 18),
        radii: top(sample.map((x) => x.borderRadius), 14),
        gaps: top(sample.map((x) => x.gap), 14),
      },
      headings,
      landmarks,
      elements,
    };
  });
}
