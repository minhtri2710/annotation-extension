import type { ScanContext } from './engine';

export function styleValue(ctx: ScanContext, el: Element, property: string, pseudo?: string): string {
  return ctx.style(el, pseudo).getPropertyValue(property).trim();
}

export function classSelector(el: Element): string {
  const tag = el.tagName.toLowerCase() || 'el';
  const classes = [...el.classList].filter(Boolean);
  return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
}

export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

export function hasDirectTextLongerThan(el: Element, minimum: number): boolean {
  return Array.from(el.childNodes).some((node) => (
    node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > minimum
  ));
}
