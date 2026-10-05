import { describe, expect, it } from 'vitest';
import { processScreenshot } from './processor';

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 255, 0];
const YELLOW = [255, 255, 0];

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
  it('places the colour boundaries of asymmetric crops exactly where the device-pixel offsets put them', async () => {
    const symmetricCapture = await quadrantImage(400, 200);
    const symmetric = await processScreenshot(symmetricCapture, { x: 80, y: 30, width: 40, height: 40 }, 2);

    expect([symmetric.width, symmetric.height]).toEqual([80, 80]);
    const symmetricImage = await decode(symmetric.blob);
    expect([symmetricImage.width, symmetricImage.height]).toEqual([80, 80]);
    expectColor(symmetricImage.pixel(10, 10), RED);
    expectColor(symmetricImage.pixel(70, 10), BLUE);
    expectColor(symmetricImage.pixel(10, 70), GREEN);
    expectColor(symmetricImage.pixel(70, 70), YELLOW);

    const capture = await quadrantImage(400, 200);

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

    const result = await processScreenshot(capture, { x: 120, y: 40, width: 41, height: 43 }, 1.5);

    expect([result.width, result.height]).toEqual([62, 65]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([62, 65]);
    expectColor(image.pixel(0, 0), RED);
    expectColor(image.pixel(61, 0), BLUE);
    expectColor(image.pixel(0, 64), GREEN);
    expectColor(image.pixel(61, 64), YELLOW);

    const cases: [number, number, number, number][] = [
      [41, 43, 51, 54],
      [43, 41, 54, 51],
    ];
    for (const [boxWidth, boxHeight, width, height] of cases) {
      const rounded = await processScreenshot(capture, { x: 120, y: 40, width: boxWidth, height: boxHeight }, 1.25);
      expect([rounded.width, rounded.height]).toEqual([width, height]);
      const roundedImage = await decode(rounded.blob);
      expect([roundedImage.width, roundedImage.height]).toEqual([width, height]);
    }
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

  it('downscales a fractional devicePixelRatio crop from its unrounded device size', async () => {
    const capture = await splitImage(3100, 1300);

    const result = await processScreenshot(capture, { x: 0, y: 0, width: 2400.4, height: 1000.36 }, 1.25);

    expect([result.width, result.height]).toEqual([1600, 667]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([1600, 667]);
    expectColor(image.pixel(100, 333), RED);
    expectColor(image.pixel(1500, 333), BLUE);
  });

  it('scales by the unrounded longest side when rounding it would change the short side', async () => {
    const capture = await splitImage(3100, 2200);

    const result = await processScreenshot(capture, { x: 0, y: 0, width: 3000.4, height: 2118 }, 1);

    expect([result.width, result.height]).toEqual([1600, 1129]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([1600, 1129]);
    expectColor(image.pixel(100, 564), RED);
    expectColor(image.pixel(1500, 564), BLUE);
  });

  it('scales by the unrounded longest side, not the rounded-up one', async () => {
    const capture = await splitImage(3100, 1100);

    const result = await processScreenshot(capture, { x: 0, y: 0, width: 3000.4, height: 1010 }, 1);

    expect([result.width, result.height]).toEqual([1600, 539]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([1600, 539]);
    expectColor(image.pixel(100, 269), RED);
    expectColor(image.pixel(1500, 269), BLUE);
  });

  it('scales the unrounded crop size, not the rounded one, before rounding the output size', async () => {
    const capture = await splitImage(3100, 1100);

    const result = await processScreenshot(capture, { x: 0, y: 0, width: 3000.4, height: 1002.4 }, 1);

    expect([result.width, result.height]).toEqual([1600, 535]);
    const image = await decode(result.blob);
    expect([image.width, image.height]).toEqual([1600, 535]);
    expectColor(image.pixel(100, 267), RED);
    expectColor(image.pixel(1500, 267), BLUE);
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
