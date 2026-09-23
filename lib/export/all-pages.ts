import type { Annotation } from '../annotation';
import { attachmentKey, screenshotKey } from '../blob-store';
import type { AnnotationExportDelivery } from './delivery';
import { attachmentAssetFilename, formatAllPages, screenshotAssetFilename } from './format';

export interface AllPagesExportDependencies {
  collect(): Promise<Annotation[]>;
  readBlob(key: string): Promise<Blob | undefined>;
  delivery: AnnotationExportDelivery;
}

/** Returns the status message for the popup. */
export async function exportAllPages({ collect, readBlob, delivery }: AllPagesExportDependencies): Promise<string> {
  try {
    const annotations = await collect();
    if (annotations.length === 0) return 'No annotations to export.';

    const markdown = formatAllPages(annotations);
    await delivery.copy(markdown);
    delivery.download(markdown, 'annotations-all.md');

    let exported = 0;
    let skipped = 0;
    const deliverAsset = async (key: string, filename: string) => {
      const blob = await readBlob(key);
      if (!blob) {
        skipped += 1;
        return;
      }
      delivery.downloadAsset(blob, filename);
      exported += 1;
    };
    for (const annotation of annotations) {
      if (annotation.screenshot) {
        await deliverAsset(screenshotKey(annotation.id), screenshotAssetFilename(annotation.id, annotation.screenshot.mimeType));
      }
      for (const [attachmentIndex, attachment] of (annotation.attachments ?? []).entries()) {
        await deliverAsset(
          attachmentKey(attachment.id),
          attachmentAssetFilename(annotation.id, attachmentIndex, attachment.mimeType),
        );
      }
    }

    const summary = `Exported ${plural(annotations.length, 'annotation')} and ${plural(exported, 'asset')}`;
    return skipped > 0 ? `${summary}; skipped ${plural(skipped, 'missing asset')}.` : `${summary}.`;
  } catch (error) {
    return `Export failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
