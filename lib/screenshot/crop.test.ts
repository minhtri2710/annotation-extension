import { describe, expect, it } from 'vitest';
import { computeCropRect } from './crop';

describe('computeCropRect', () => {
  it('scales a viewport CSS rectangle into image pixels', () => {
    expect(
      computeCropRect({ x: 10, y: 20, width: 100, height: 50 }, 2, 1000, 800),
    ).toEqual({ x: 20, y: 40, width: 200, height: 100 });
  });

  it('clamps negative origins and image-edge overflow', () => {
    const rect = computeCropRect({ x: -10, y: -5, width: 100, height: 80 }, 2, 120, 100);

    expect(rect).toEqual({ x: 0, y: 0, width: 120, height: 100 });
    expect(rect.x + rect.width).toBeLessThanOrEqual(120);
    expect(rect.y + rect.height).toBeLessThanOrEqual(100);
  });
});
