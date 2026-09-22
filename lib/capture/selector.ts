export function buildSelector(element: Element): string {
  const document = element.ownerDocument;

  if (element.id) {
    const idSelector = `#${escapeCssIdentifier(element.id)}`;
    if (document.querySelectorAll(idSelector).length === 1) return idSelector;
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current) {
    let segment = current.localName;
    const parent = current.parentElement;

    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        (sibling) => sibling.localName === current!.localName,
      );
      const position = sameTagSiblings.indexOf(current) + 1;
      if (position > 0 && sameTagSiblings.length > 1) {
        segment += `:nth-of-type(${position})`;
      }
    }

    segments.unshift(segment);
    const selector = segments.join(' > ');
    if (document.querySelector(selector) === element) return selector;

    current = parent;
  }

  throw new Error('Unable to build a round-trippable selector for the element');
}

function escapeCssIdentifier(value: string): string {
  const cssEscape = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape;
  if (cssEscape) return cssEscape(value);

  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    const character = value[index];

    if (codePoint === 0) {
      escaped += '\\ufffd';
    } else if (
      (codePoint >= 1 && codePoint <= 31) ||
      codePoint === 127 ||
      (index === 0 && codePoint >= 48 && codePoint <= 57) ||
      (index === 1 && codePoint >= 48 && codePoint <= 57 && value[0] === '-')
    ) {
      escaped += `\\${codePoint.toString(16)} `;
    } else if (index === 0 && character === '-' && value.length === 1) {
      escaped += '\\\\-';
    } else if (codePoint >= 128 || character === '-' || character === '_' || /[a-zA-Z0-9]/.test(character)) {
      escaped += character;
    } else {
      escaped += `\\${character}`;
    }
  }
  return escaped;
}
