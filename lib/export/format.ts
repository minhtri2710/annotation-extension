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
    `Page URL: ${inline(pageUrl)}`,
    `Host: ${inline(host)}`,
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
      `## ${inline(host)}`,
      ...[...pages.keys()].sort().flatMap((pageUrl) => {
        const orderedAnnotations = sortByCreatedAt(pages.get(pageUrl) ?? []);
        return [
          `### ${inline(pageUrl)}`,
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
          `- [${inline(attachment.name)}](${linkTarget(attachmentAssetFilename(annotation.id, attachmentIndex, attachment.mimeType))})`,
        ),
      ].join('\n')
    : undefined;
  const lines = [
    `${heading} Annotation ${number}`,
    /[\r\n]/.test(annotation.note) ? `- Note:\n${fenced(annotation.note, '  ')}` : `- Note: ${inline(annotation.note)}`,
    `- Status: ${annotation.status}`,
    `- Selector: ${inline(annotation.selector)}`,
    element ? `- Element: ${inline(element)}` : undefined,
    sourcePath ? `- Source: ${inline(sourcePath)}` : undefined,
    annotation.screenshot
      ? `![Annotation screenshot](${linkTarget(screenshotAssetFilename(annotation.id, annotation.screenshot.mimeType))})`
      : undefined,
    attachmentBlock,
    annotation.repro
      ? [
          `${subheading} Reproduction`,
          fenced([
            ...annotation.repro.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`),
            `Expected: ${annotation.repro.expected}`,
            `Actual: ${annotation.repro.actual}`,
          ].join('\n')),
        ].join('\n')
      : undefined,
    annotation.cssEdits && annotation.cssEdits.length > 0
      ? [
          `${subheading} CSS tweaks`,
          fenced(annotation.cssEdits.map(({ property, value, original }) => `${property}: ${original} -> ${value}`).join('\n')),
        ].join('\n')
      : undefined,
  ];
  return lines.filter((line): line is string => line !== undefined).join('\n');
}

/** User text on one line: line breaks become spaces and the characters that start links, HTML, tables or code are escaped. */
function inline(text: string): string {
  return text.replace(/\r\n?|\n/g, ' ').replace(/[\\`[\]<>|]/g, '\\$&');
}

/** User text as a fenced block, fenced by more backticks than any run inside it; indent keeps it inside a list item. */
function fenced(text: string, indent = ''): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return [fence, ...text.split(/\r\n?|\n/), fence].map((line) => `${indent}${line}`).join('\n');
}

function linkTarget(filename: string): string {
  return `./${encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
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
