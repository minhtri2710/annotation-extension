import type { Annotation } from '../annotation';
import type { ElementContext } from '../capture/context';

export function imageAssetExtension(mimeType: string): string {
  return mimeType === 'image/webp' ? 'webp' : mimeType === 'image/jpeg' ? 'jpeg' : 'png';
}

export function screenshotAssetFilename(annotationId: string, mimeType: string): string {
  return `annotations-${annotationId}.${imageAssetExtension(mimeType)}`;
}

export function attachmentAssetFilename(annotationId: string, index: number, mimeType: string): string {
  return `annotations-${annotationId}-attachment-${index + 1}.${imageAssetExtension(mimeType)}`;
}

export function format(annotations: Annotation[], pageUrl: string): string {
  if (annotations.length === 0) return 'No annotations found on this page.';

  const orderedAnnotations = sortByCreatedAt(annotations);
  const host = new URL(pageUrl).host;
  return [
    '# Page annotations',
    'Review the following annotations for this page.',
    `Page URL: ${pageUrl}`,
    `Host: ${host}`,
    `Annotation count: ${orderedAnnotations.length}`,
    ...orderedAnnotations.map((annotation, index) => formatAnnotationBlock(annotation, index + 1, 2)),
  ].join('\n\n');
}

export function formatAllPages(annotations: Annotation[]): string {
  if (annotations.length === 0) return 'No annotations found.';

  const hosts = new Map<string, Map<string, Annotation[]>>();
  for (const annotation of annotations) {
    const host = new URL(annotation.pageUrl).host;
    const pages = hosts.get(host) ?? new Map<string, Annotation[]>();
    pages.set(annotation.pageUrl, [...(pages.get(annotation.pageUrl) ?? []), annotation]);
    hosts.set(host, pages);
  }

  const sections = [...hosts.keys()].sort().flatMap((host) => {
    const pages = hosts.get(host) ?? new Map<string, Annotation[]>();
    return [
      `## ${host}`,
      ...[...pages.keys()].sort().flatMap((pageUrl) => {
        const orderedAnnotations = sortByCreatedAt(pages.get(pageUrl) ?? []);
        return [
          `### ${pageUrl}`,
          `Annotation count: ${orderedAnnotations.length}`,
          ...orderedAnnotations.map((annotation, index) => formatAnnotationBlock(annotation, index + 1, 4)),
        ];
      }),
    ];
  });

  return ['# All annotations', `Total annotation count: ${annotations.length}`, ...sections].join('\n\n');
}

function sortByCreatedAt(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function formatAnnotationBlock(annotation: Annotation, number: number, headingLevel: number): string {
  const heading = '#'.repeat(headingLevel);
  const subheading = '#'.repeat(headingLevel + 1);
  const sourcePath = readSourcePath(annotation.elementContext);
  const element = formatElementContext(annotation.elementContext);
  const attachmentBlock = annotation.attachments && annotation.attachments.length > 0
    ? [
        `${subheading} Attachments`,
        ...annotation.attachments.map((attachment, attachmentIndex) =>
          `- [${attachment.name}](./${attachmentAssetFilename(annotation.id, attachmentIndex, attachment.mimeType)})`,
        ),
      ].join('\n')
    : undefined;
  const lines = [
    `${heading} Annotation ${number}`,
    `- Note: ${annotation.note}`,
    `- Status: ${annotation.status}`,
    `- Selector: ${annotation.selector}`,
    element ? `- Element: ${element}` : undefined,
    sourcePath ? `- Source: ${sourcePath}` : undefined,
    annotation.screenshot
      ? `![Annotation screenshot](./${screenshotAssetFilename(annotation.id, annotation.screenshot.mimeType)})`
      : undefined,
    attachmentBlock,
    annotation.repro
      ? [
          `${subheading} Reproduction`,
          ...annotation.repro.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`),
          `Expected: ${annotation.repro.expected}`,
          `Actual: ${annotation.repro.actual}`,
        ].join('\n')
      : undefined,
    annotation.cssEdits && annotation.cssEdits.length > 0
      ? [`${subheading} CSS tweaks`, ...annotation.cssEdits.map(({ property, value, original }) => `${property}: ${original} -> ${value}`)].join('\n')
      : undefined,
  ];
  return lines.filter((line): line is string => line !== undefined).join('\n');
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
