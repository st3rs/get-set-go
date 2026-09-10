import type { ElementSignal, Signal } from './design';

export async function extractRichSignals(page: any): Promise<Signal> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    const visible = all.filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
    });

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

    const sample = visible.slice(0, 1400).map((el) => {
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

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .slice(0, 60)
      .map((el) => {
        const node = el as HTMLElement;
        const r = node.getBoundingClientRect();
        const s = getComputedStyle(node);
        return {
          tag: node.tagName,
          text: (node.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 260),
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
      .slice(0, 180)
      .map((el) => {
        const node = el as HTMLElement;
        const r = node.getBoundingClientRect();
        const s = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          ariaLabel: node.getAttribute('aria-label'),
          id: node.id || null,
          classHint: String(node.className || '').slice(0, 160),
          box: { x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
          display: s.display,
          gridTemplateColumns: s.gridTemplateColumns,
          gap: s.gap,
        };
      });

    const scoreElement = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const s = getComputedStyle(el);
      let score = Math.min(40, Math.round((r.width * r.height) / 12000));
      if (/^(img|picture|video|canvas|svg)$/.test(tag)) score += 48;
      if (/^(button|a|input|select|textarea)$/.test(tag)) score += 22;
      if (/^(article|section|header|nav|footer|aside)$/.test(tag)) score += 22;
      if (/grid|flex/.test(s.display)) score += 14;
      if (s.backgroundImage && s.backgroundImage !== 'none') score += 28;
      if (s.borderRadius !== '0px') score += 5;
      const txt = (el.innerText || '').trim();
      if (txt && txt.length <= 160) score += 6;
      return score;
    };

    const candidates = visible
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const s = getComputedStyle(el);
        if (r.width < 24 || r.height < 18) return false;
        return /^(img|picture|video|canvas|svg|button|a|article|section|header|nav|footer|aside|main)$/.test(tag)
          || /grid|flex/.test(s.display)
          || (s.backgroundImage && s.backgroundImage !== 'none')
          || (r.width >= innerWidth * 0.22 && r.height >= 80);
      })
      .map((el) => ({ el, score: scoreElement(el) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 360);

    const elements: ElementSignal[] = candidates.map(({ el }) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const mediaKind = /^(img|picture|video|canvas|svg)$/.test(tag)
        ? tag
        : s.backgroundImage && s.backgroundImage !== 'none'
          ? 'background-image'
          : null;

      return {
        tag,
        role: el.getAttribute('role'),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 180),
        box: {
          x: Math.round(r.x),
          y: Math.round(r.y + scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
        style: {
          display: s.display,
          position: s.position,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          lineHeight: s.lineHeight,
          color: s.color,
          backgroundColor: s.backgroundColor,
          border: s.border,
          borderRadius: s.borderRadius,
          boxShadow: s.boxShadow,
          padding: s.padding,
          margin: s.margin,
          gap: s.gap,
          gridTemplateColumns: s.gridTemplateColumns,
          justifyContent: s.justifyContent,
          alignItems: s.alignItems,
          objectFit: s.objectFit,
        },
        meta: {
          ariaLabel: el.getAttribute('aria-label'),
          childCount: el.children.length,
          mediaKind,
        },
      };
    });

    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      visibleElementCount: visible.length,
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
