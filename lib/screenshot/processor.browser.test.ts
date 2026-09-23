import { describe, expect, it } from 'vitest';
import { processScreenshot } from './processor';

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 255, 0];
const YELLOW = [255, 255, 0];

/** A PNG data URL whose left half is red and right half is blue. */
async function splitImage(width: number, height: number): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, width / 2, height);
  context.fillStyle = 'rgb(0, 0, 255)';
  context.fillRect(width / 2, 0, width / 2, height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A PNG data URL split into quadrants: red top-left, blue top-right, green bottom-left, yellow bottom-right. */
async function quadrantImage(width: number, height: number): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  const quadrants: [number, number, string][] = [
    [0, 0, 'rgb(255, 0, 0)'],
    [width / 2, 0, 'rgb(0, 0, 255)'],
    [0, height / 2, 'rgb(0, 255, 0)'],
    [width / 2, height / 2, 'rgb(255, 255, 0)'],
  ];
  for (const [x, y, color] of quadrants) {
    context.fillStyle = color;
    context.fillRect(x, y, width / 2, height / 2);
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function decode(blob: Blob): Promise<{ width: number; height: number; pixel(x: number, y: number): number[] }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  bitmap.close();
  const data = context.getImageData(0, 0, width, height).data;
  return {
    width,
    height,
    pixel: (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)),
  };
}

function expectColor(actual: number[], expected: number[]): void {
  actual.forEach((channel, index) => expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(24));
}

describe('processScreenshot', () => {
  it('crops the bounding box scaled by devicePixelRatio and encodes WebP', async () => {
    const capture = await splitImage(400, 200);

    const result = await processScreenshot(capture, { x: 60, y: 20, width: 80, height: 50 }, 2);

    expect(result.width).toBe(160);
    expect(result.height).toBe(100);
    // Product contract: screenshots are stored as WebP on both engines.
    expect(result.blob.type).toBe('image/webp');
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([160, 100]);
    expectColor(image.pixel(10, 50), RED);
    expectColor(image.pixel(150, 50), BLUE);
  });

  it('offsets and scales the crop by devicePixelRatio on both axes', async () => {
    const capture = await quadrantImage(400, 200);

    // Device-pixel crop is x 160..240, y 60..140: it straddles both the vertical and the horizontal split.
    const result = await processScreenshot(capture, { x: 80, y: 30, width: 40, height: 40 }, 2);

    expect([result.width, result.height]).toEqual([80, 80]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([80, 80]);
    expectColor(image.pixel(10, 10), RED);
    expectColor(image.pixel(70, 10), BLUE);
    expectColor(image.pixel(10, 70), GREEN);
    expectColor(image.pixel(70, 70), YELLOW);
  });

  it('places the colour boundaries of an asymmetric crop exactly where the device-pixel offsets put them', async () => {
    const capture = await quadrantImage(400, 200);

    // Device-pixel crop is x 170..250, y 80..150: the vertical split (x 200) lands at output column 30 of 80,
    // the horizontal split (y 100) at output row 20 of 70.
    const result = await processScreenshot(capture, { x: 85, y: 40, width: 40, height: 35 }, 2);

    expect([result.width, result.height]).toEqual([80, 70]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([80, 70]);
    expectColor(image.pixel(0, 0), RED);
    expectColor(image.pixel(79, 0), BLUE);
    expectColor(image.pixel(0, 69), GREEN);
    expectColor(image.pixel(79, 69), YELLOW);

    const firstBlueColumn = Array.from({ length: 80 }, (_, x) => x).find((x) => image.pixel(x, 10)[2]! > 127);
    const firstGreenRow = Array.from({ length: 70 }, (_, y) => y).find((y) => image.pixel(10, y)[1]! > 127);
    expect(firstBlueColumn).toBe(30);
    expect(firstGreenRow).toBe(20);
  });

  it('rounds the output size of a fractional devicePixelRatio crop to the nearest pixel', async () => {
    const capture = await quadrantImage(400, 200);

    // Device-pixel crop at dpr 1.5 is x 180..241.5, y 60..124.5 (61.5 x 64.5), so the output rounds to 62 x 65.
    const result = await processScreenshot(capture, { x: 120, y: 40, width: 41, height: 43 }, 1.5);

    expect([result.width, result.height]).toEqual([62, 65]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([62, 65]);
    expectColor(image.pixel(0, 0), RED);
    expectColor(image.pixel(61, 0), BLUE);
    expectColor(image.pixel(0, 64), GREEN);
    expectColor(image.pixel(61, 64), YELLOW);
  });

  it('keeps a crop at or under 1600px at full size', async () => {
    const capture = await splitImage(1600, 40);

    const result = await processScreenshot(capture, { x: 0, y: 0, width: 1600, height: 40 }, 1);

    expect([result.width, result.height]).toEqual([1600, 40]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([1600, 40]);
  });

  it('downscales a wide crop so its width is 1600px', async () => {
    const capture = await splitImage(4000, 1000);

    const result = await processScreenshot(capture, { x: 0, y: 0, width: 4000, height: 1000 }, 1);

    expect([result.width, result.height]).toEqual([1600, 400]);
    expect(result.blob.type).toBe('image/webp');
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([1600, 400]);
    expectColor(image.pixel(100, 200), RED);
    expectColor(image.pixel(1500, 200), BLUE);
  });

  it('downscales a tall crop so its height is 1600px', async () => {
    const capture = await splitImage(1000, 3200);

    const result = await processScreenshot(capture, { x: 0, y: 0, width: 1000, height: 3200 }, 1);

    expect([result.width, result.height]).toEqual([500, 1600]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([500, 1600]);
  });

  it('clamps the box to the image and rejects an empty crop', async () => {
    const capture = await splitImage(100, 100);

    const clamped = await processScreenshot(capture, { x: 60, y: -20, width: 100, height: 70 }, 1);
    expect([clamped.width, clamped.height]).toEqual([40, 50]);

    await expect(processScreenshot(capture, { x: 200, y: 10, width: 50, height: 50 }, 1)).rejects.toThrow(
      'Screenshot crop is empty',
    );
  });

  it('rejects a capture that is not a base64 data URL', async () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    await expect(processScreenshot('not a data url', box, 1)).rejects.toThrow('Screenshot capture is not a data URL');
    await expect(processScreenshot('data:image/png,abc', box, 1)).rejects.toThrow(
      'Screenshot capture is not a base64 data URL',
    );
    await expect(processScreenshot('data:image/png;base64,', box, 1)).rejects.toThrow(
      'Screenshot capture is not a base64 data URL',
    );
  });
});
