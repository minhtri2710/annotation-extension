import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';

export function screenshotAssetFilename(annotationId: string, mimeType: string): string {
  const extension = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/jpeg' ? 'jpeg' : 'png';
  return `annotations-${annotationId}.${extension}`;
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
        ? `![Annotation screenshot](./${screenshotAssetFilename(annotation.id, annotation.screenshot.mimeType)})`
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

function formatElementContext(elementContext: ElementContext): string | undefined {
  const { tagName, id, classList, text } = elementContext;
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const identity = `${tagName}${id ? `#${id}` : ''}${classList
    .filter((className) => className.length > 0)
    .map((className) => `.${className}`)
    .join('')}`;
  if (!identity && !normalizedText) return undefined;
  return `${identity || 'element'}${normalizedText ? ` "${normalizedText}"` : ''}`;
}

function readSourcePath(elementContext: ElementContext): string | undefined {
  const sourcePath = elementContext.sourcePath;
  if (!sourcePath) return undefined;
  if (sourcePath.lineNumber !== undefined) return `${sourcePath.fileName}:${sourcePath.lineNumber}`;
  return sourcePath.fileName;
}
