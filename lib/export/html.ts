import type { Annotation } from '../annotation';
import { isSupportedImageMimeType, MAX_IMAGE_BYTES } from '../attachments/validation';
import { blobToBase64 } from '../base64';
import { attachmentKey, screenshotKey } from '../blob-store';
import { cssEditText, formatElementContext, groupByHostAndPage, readSourcePath, reproductionText, sortByCreatedAt } from './format';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export async function formatPageHtml(
  pageUrl: string,
  annotations: Annotation[],
  readBlob: (key: string) => Promise<Blob | undefined>,
): Promise<string> {
  return [
    '<h1>Page annotations</h1>',
    `<p>Page URL: ${escapeHtml(pageUrl)}</p>`,
    `<p>Host: ${escapeHtml(new URL(pageUrl).host)}</p>`,
    `<p>Annotation count: ${annotations.length}</p>`,
    ...(await annotationSections(sortByCreatedAt(annotations), 2, readBlob)),
  ].join('\n');
}

export async function formatAllPagesHtml(
  annotations: Annotation[],
  readBlob: (key: string) => Promise<Blob | undefined>,
): Promise<string> {
  const sections: string[] = [];
  for (const { host, pages } of groupByHostAndPage(annotations)) {
    sections.push(`<h2>${escapeHtml(host)}</h2>`);
    for (const { pageUrl, annotations: pageAnnotations } of pages) {
      sections.push(`<h3>${escapeHtml(pageUrl)}</h3>`, `<p>Annotation count: ${pageAnnotations.length}</p>`);
      sections.push(...(await annotationSections(pageAnnotations, 4, readBlob)));
    }
  }
  return ['<h1>All annotations</h1>', `<p>Total annotation count: ${annotations.length}</p>`, ...sections].join('\n');
}

async function annotationSections(
  annotations: Annotation[],
  headingLevel: number,
  readBlob: (key: string) => Promise<Blob | undefined>,
): Promise<string[]> {
  const sections: string[] = [];
  for (const [index, annotation] of annotations.entries()) {
    const images: string[] = [];
    if (annotation.screenshot) {
      images.push(await embeddedImage(await readBlob(screenshotKey(annotation.id)), 'Annotation screenshot'));
    }
    for (const attachment of annotation.attachments ?? []) {
      images.push(await embeddedImage(await readBlob(attachmentKey(attachment.id)), attachment.name));
    }
    sections.push(annotationSection(annotation, index + 1, headingLevel, images));
  }
  return sections;
}

function annotationSection(annotation: Annotation, number: number, headingLevel: number, images: string[]): string {
  const heading = `h${headingLevel}`;
  const subheading = `h${headingLevel + 1}`;
  const element = formatElementContext(annotation.elementContext);
  const sourcePath = readSourcePath(annotation.elementContext);
  return [
    `<section>`,
    `<${heading}>Annotation ${number}</${heading}>`,
    /[\r\n]/.test(annotation.note) ? `<p>Note:</p>\n${preformatted(annotation.note)}` : `<p>Note: ${escapeHtml(annotation.note)}</p>`,
    `<p>Status: ${escapeHtml(annotation.status)}</p>`,
    `<p>Selector: <code>${escapeHtml(annotation.selector)}</code></p>`,
    element ? `<p>Element: ${escapeHtml(element)}</p>` : '',
    sourcePath ? `<p>Source: <code>${escapeHtml(sourcePath)}</code></p>` : '',
    ...images,
    annotation.repro ? `<${subheading}>Reproduction</${subheading}>\n${preformatted(reproductionText(annotation.repro))}` : '',
    annotation.cssEdits && annotation.cssEdits.length > 0
      ? `<${subheading}>CSS tweaks</${subheading}>\n${preformatted(cssEditText(annotation.cssEdits))}`
      : '',
    `</section>`,
  ].filter((line) => line !== '').join('\n');
}

async function embeddedImage(blob: Blob | undefined, alt: string): Promise<string> {
  if (!blob) throw new Error(`The image "${alt}" is missing and cannot be copied.`);
  if (!isSupportedImageMimeType(blob.type) || blob.size > MAX_IMAGE_BYTES) {
    throw new Error(`The image "${alt}" cannot be copied.`);
  }
  return `<img alt="${escapeHtml(alt)}" src="data:${blob.type};base64,${await blobToBase64(blob)}">`;
}

function preformatted(text: string): string {
  // HTML drops a newline that directly follows <pre>, so a leading newline in the text is doubled to keep it.
  const leadingNewline = /^\r?\n/.test(text) ? '\n' : '';
  return `<pre>${leadingNewline}${escapeHtml(text)}</pre>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}
