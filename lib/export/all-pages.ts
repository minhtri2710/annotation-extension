import type { Annotation } from '../annotation';
import { errorMessage } from '../guards';
import { clipboardFailure, type AnnotationExportDelivery } from './delivery';
import { annotationAssets, formatAllPages } from './format';
import { formatHtml } from './html';

export interface AllPagesExportDependencies {
  collect(): Promise<Annotation[]>;
  readBlob(key: string): Promise<Blob | undefined>;
  delivery: AnnotationExportDelivery;
}

const NO_ANNOTATIONS = 'No annotations to export.';

export async function exportAllPages({ collect, readBlob, delivery }: AllPagesExportDependencies): Promise<string> {
  try {
    // The copy starts before collect is awaited, so its write uses the user activation of the click that called this.
    // An empty collection rejects the payload, so the write is still attempted and leaves the clipboard unchanged;
    // no copy status is reported. This is an accepted tradeoff: an empty export makes one failing write.
    const collected = collect();
    const payload = collected.then(async (annotations) => {
      if (annotations.length === 0) throw new Error(NO_ANNOTATIONS);
      return { text: formatAllPages(annotations), html: await formatHtml(annotations, readBlob) };
    });
    // A copy may not consume the payload on every path, so its rejection is marked handled here; copy still reports it.
    payload.catch(() => undefined);
    const copied = clipboardFailure(() => delivery.copy(payload));
    const annotations = await collected;
    if (annotations.length === 0) return NO_ANNOTATIONS;

    delivery.download(formatAllPages(annotations), 'annotations-all.md');

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
      for (const { key, filename } of annotationAssets(annotation)) await deliverAsset(key, filename);
    }

    const copyFailure = await copied;
    const summary = `Exported ${plural(annotations.length, 'annotation')} and ${plural(exported, 'asset')}`;
    const status = skipped > 0 ? `${summary}; skipped ${plural(skipped, 'missing asset')}.` : `${summary}.`;
    return copyFailure ? `${status} ${copyFailure}` : status;
  } catch (error) {
    return `Export failed: ${errorMessage(error)}`;
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
