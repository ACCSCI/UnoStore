import { expect, test } from 'bun:test';
import { hearthArtCoverCrop } from '../../src/ui/scene/HearthCardRenderer';

test('竖版炉石立绘按 cover 裁切并完整铺满椭圆窗', () => {
  const crop = hearthArtCoverCrop(768, 1024, 348, 317, 0.5, 0.34);

  expect(crop.sx).toBe(0);
  expect(crop.sy).toBe(0);
  expect(crop.sw / crop.sh).toBeCloseTo(348 / 317, 8);
  expect(crop.sh).toBeLessThan(1024);
});

test('横版炉石立绘裁切时保留指定视觉焦点', () => {
  const crop = hearthArtCoverCrop(1600, 900, 348, 317, 0.75, 0.5);

  expect(crop.sx).toBeGreaterThan(0);
  expect(crop.sy).toBe(0);
  expect(crop.sx + crop.sw).toBeLessThanOrEqual(1600);
  expect(crop.sw / crop.sh).toBeCloseTo(348 / 317, 8);
});
