import { describe, expect, it } from 'vitest';
import { computeCropRect } from './crop';

describe('computeCropRect', () => {
  it('clamps negative origins and image-edge overflow', () => {
    const rect = computeCropRect({ x: -10, y: -5, width: 100, height: 80 }, 2, 120, 100);

    expect(rect).toEqual({ x: 0, y: 0, width: 120, height: 100 });
  });
});
