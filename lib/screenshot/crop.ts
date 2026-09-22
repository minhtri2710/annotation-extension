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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
