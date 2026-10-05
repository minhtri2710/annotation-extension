const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  scan: ['M4 9V5h4', 'M16 5h4v4', 'M20 15v4h-4', 'M8 19H4v-4', 'M8 12h8'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  'eye-off': ['M3 3l18 18', 'M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 10 6-.6.8-1.6 2-3 3.1', 'M6.6 6.7C4.5 8 3 10 2 12c1.5 2 5 6 10 6 1.5 0 2.8-.3 4-.8', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  locate: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'],
  edit: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function createIcon(document: Document, name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const data of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

export function setIconButton(button: HTMLButtonElement, name: IconName, label: string): void {
  button.replaceChildren(createIcon(button.ownerDocument, name));
  button.setAttribute('aria-label', label);
  button.title = label;
}
