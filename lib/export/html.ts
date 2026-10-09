import type { Annotation } from '../annotation';
import { isSupportedImageMimeType, MAX_IMAGE_BYTES } from '../attachments/validation';
import { blobToBase64 } from '../base64';
import { attachmentKey, screenshotKey } from '../blob-store';
import { formatElementContext } from './format';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export async function formatHtml(
  annotations: Annotation[],
  readBlob: (key: string) => Promise<Blob | undefined>,
): Promise<string> {
  const sections: string[] = [];
  for (const [index, annotation] of annotations.entries()) {
    const images: string[] = [];
    if (annotation.screenshot) {
      images.push(await embeddedImage(await readBlob(screenshotKey(annotation.id)), 'Annotation screenshot'));
    }
    for (const attachment of annotation.attachments ?? []) {
      images.push(await embeddedImage(await readBlob(attachmentKey(attachment.id)), attachment.name));
    }
    sections.push(formatAnnotationSection(annotation, index + 1, images));
  }
  return ['<h1>Annotations</h1>', ...sections].join('\n');
}

function formatAnnotationSection(annotation: Annotation, number: number, images: string[]): string {
  const element = formatElementContext(annotation.elementContext);
  return [
    `<section>`,
    `<h2>Annotation ${number}</h2>`,
    `<p>Page: ${escapeHtml(annotation.pageUrl)}</p>`,
    `<p>Note: ${escapeHtml(annotation.note)}</p>`,
    `<p>Status: ${escapeHtml(annotation.status)}</p>`,
    `<p>Selector: <code>${escapeHtml(annotation.selector)}</code></p>`,
    element ? `<p>Element: ${escapeHtml(element)}</p>` : '',
    ...images,
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}
