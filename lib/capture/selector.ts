export const SHADOW_SELECTOR_DELIMITER = ' >>> ';

export function buildSelector(element: Element): string {
  const parts: string[] = [];
  for (let current: Element | null = element; current; ) {
    const root = current.getRootNode() as Document | ShadowRoot;
    parts.unshift(buildScopedSelector(current, root));
    current = isShadowRoot(root) ? root.host : null;
  }
  return parts.join(SHADOW_SELECTOR_DELIMITER);
}

// Realm-safe: `instanceof ShadowRoot` fails for roots from another realm (an iframe, Firefox Xray wrappers).
export function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in node;
}

export function resolveSelector(document: Document, selector: string): Element | null {
  let root: Document | ShadowRoot | null = document;
  let element: Element | null = null;
  for (const part of selector.split(SHADOW_SELECTOR_DELIMITER)) {
    if (!root || !part.trim()) return null;
    try {
      element = root.querySelector(part);
    } catch {
      return null;
    }
    if (!element) return null;
    root = element.shadowRoot;
  }
  return element;
}

function buildScopedSelector(element: Element, root: Document | ShadowRoot): string {
  if (element.id) {
    const idSelector = `#${CSS.escape(element.id)}`;
    if (root.querySelectorAll(idSelector).length === 1) return idSelector;
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current) {
    const currentElement: Element = current;
    let segment = currentElement.localName;
    const parent: Element | null = currentElement.parentElement;
    // A shadow root's top-level elements have no parentElement but still need sibling disambiguation.
    const container = parent ?? (currentElement.parentNode === root ? root : null);

    if (container) {
      const sameTagSiblings = Array.from(container.children).filter(
        (sibling: Element) => sibling.localName === currentElement.localName,
      );
      const position = sameTagSiblings.indexOf(currentElement) + 1;
      if (position > 0 && sameTagSiblings.length > 1) {
        segment += `:nth-of-type(${position})`;
      }
    }

    segments.unshift(segment);
    const selector = segments.join(' > ');
    if (root.querySelector(selector) === element) return selector;

    if (!parent && isShadowRoot(root) && currentElement.parentNode === root) {
      segments[0] = `${segment}:not(* > ${currentElement.localName})`;
      const anchored = segments.join(' > ');
      if (root.querySelector(anchored) === element) return anchored;
    }

    current = parent;
  }

  throw new Error('Unable to build a round-trippable selector for the element');
}

export function resolveElementBox(
  document: Document,
  selector: string,
): { x: number; y: number; width: number; height: number } | undefined {
  const element = resolveSelector(document, selector);
  if (!element) return undefined;
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}
