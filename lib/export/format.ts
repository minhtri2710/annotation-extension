import type { Annotation } from '../annotation';

export function screenshotAssetFilename(annotationId: string): string {
  return `annotations-${annotationId}.png`;
}

export function format(annotations: Annotation[], pageUrl: string): string {
  if (annotations.length === 0) return 'No annotations found on this page.';

  const orderedAnnotations = [...annotations].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const blocks = orderedAnnotations.map((annotation, index) => {
    const sourcePath = readSourcePath(annotation.elementContext);
    const element = formatElementContext(annotation.elementContext);
    const lines = [
      `## Annotation ${index + 1}`,
      `- Note: ${annotation.note}`,
      `- Selector: ${annotation.selector}`,
      element ? `- Element: ${element}` : undefined,
      sourcePath ? `- Source: ${sourcePath}` : undefined,
      annotation.screenshot
        ? `![Annotation screenshot](./${screenshotAssetFilename(annotation.id)})`
        : undefined,
      annotation.repro
        ? [
            '### Reproduction',
            ...annotation.repro.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`),
            `Expected: ${annotation.repro.expected}`,
            `Actual: ${annotation.repro.actual}`,
          ].join('\n')
        : undefined,
      annotation.cssEdits && annotation.cssEdits.length > 0
        ? ['### CSS tweaks', ...annotation.cssEdits.map(({ property, value }) => `${property}: ${value}`)].join('\n')
        : undefined,
    ];
    return lines.filter((line): line is string => line !== undefined).join('\n');
  });

  const host = new URL(pageUrl).host;
  return [
    '# Page annotations',
    'Review the following annotations for this page.',
    `Page URL: ${pageUrl}`,
    `Host: ${host}`,
    `Annotation count: ${orderedAnnotations.length}`,
    ...blocks,
  ].join('\n\n');
}

function formatElementContext(elementContext: unknown): string | undefined {
  if (!isRecord(elementContext)) return undefined;

  const tagName = typeof elementContext.tagName === 'string' ? elementContext.tagName : '';
  const id = typeof elementContext.id === 'string' ? elementContext.id : '';
  const classList = Array.isArray(elementContext.classList)
    ? elementContext.classList.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  const text = typeof elementContext.text === 'string' ? elementContext.text.replace(/\s+/g, ' ').trim() : '';
  const identity = `${tagName}${id ? `#${id}` : ''}${classList.map((className) => `.${className}`).join('')}`;
  if (!identity && !text) return undefined;
  return `${identity || 'element'}${text ? ` "${text}"` : ''}`;
}

function readSourcePath(elementContext: unknown): string | undefined {
  if (!isRecord(elementContext) || !isRecord(elementContext.sourcePath)) return undefined;

  const { fileName, lineNumber } = elementContext.sourcePath;
  if (typeof fileName !== 'string' || fileName.length === 0) return undefined;
  if (typeof lineNumber === 'number' && Number.isFinite(lineNumber)) return `${fileName}:${lineNumber}`;
  return fileName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
