import type { BoundingBox } from '../capture/context';
import { computeCropRect } from './crop';
import { base64ToBlob } from '../base64';

export interface ProcessedScreenshot {
  blob: Blob;
  width: number;
  height: number;
}

export type ScreenshotProcessor = (
  captureDataUrl: string,
  boundingBox: BoundingBox,
  devicePixelRatio: number,
) => Promise<ProcessedScreenshot>;

const MAX_LONGEST_SIDE = 1600;

/** Browser-only decode/crop/encode glue; the processor is injected in unit tests. */
export const processScreenshot: ScreenshotProcessor = async (
  captureDataUrl,
  boundingBox,
  devicePixelRatio,
) => {
  const sourceBlob = dataUrlToBlob(captureDataUrl);
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const crop = computeCropRect(boundingBox, devicePixelRatio, bitmap.width, bitmap.height);
    if (crop.width <= 0 || crop.height <= 0) throw new Error('Screenshot crop is empty');

    const scale = Math.min(1, MAX_LONGEST_SIDE / Math.max(crop.width, crop.height));
    const width = Math.max(1, Math.round(crop.width * scale));
    const height = Math.max(1, Math.round(crop.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Screenshot canvas context is unavailable');

    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
};

function dataUrlToBlob(dataUrl: string): Blob {
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Screenshot capture is not a data URL');
  const header = dataUrl.slice(0, separator);
  const base64 = dataUrl.slice(separator + 1);
  if (!header.startsWith('data:') || !header.includes(';base64') || !base64) {
    throw new Error('Screenshot capture is not a base64 data URL');
  }

  const mimeType = header.slice('data:'.length, header.indexOf(';')) || 'image/png';
  return base64ToBlob(base64, mimeType);
}
