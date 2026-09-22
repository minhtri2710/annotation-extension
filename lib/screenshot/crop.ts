import type { BoundingBox } from '../capture/context';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeCropRect(
  boundingBox: BoundingBox,
  devicePixelRatio: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const left = clamp(boundingBox.x * devicePixelRatio, 0, imageWidth);
  const top = clamp(boundingBox.y * devicePixelRatio, 0, imageHeight);
  const right = clamp((boundingBox.x + boundingBox.width) * devicePixelRatio, 0, imageWidth);
  const bottom = clamp((boundingBox.y + boundingBox.height) * devicePixelRatio, 0, imageHeight);

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
}

/** Browser-only image/canvas glue; the geometry is covered by computeCropRect tests. */
export async function cropDataUrl(
  dataUrl: string,
  boundingBox: BoundingBox,
  devicePixelRatio: number,
): Promise<string> {
  const image = await loadImage(dataUrl);
  const rect = computeCropRect(
    boundingBox,
    devicePixelRatio,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(rect.width);
  canvas.height = Math.ceil(rect.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');

  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Screenshot image could not be decoded'));
    image.src = dataUrl;
  });
}
