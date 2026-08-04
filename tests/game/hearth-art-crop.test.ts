import { expect, test } from 'bun:test';
import { hearthArtCoverCrop, hearthArtVerticalOffset } from '../../src/ui/scene/HearthCardRenderer';

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

test('带圆形留白的立绘可通过放大裁切把底色移出椭圆窗', () => {
  const regular = hearthArtCoverCrop(768, 768, 348, 317, 0.5, 0.38);
  const overscanned = hearthArtCoverCrop(768, 768, 348, 317, 0.5, 0.38, 1.1);

  expect(overscanned.sw).toBeLessThan(regular.sw);
  expect(overscanned.sh).toBeLessThan(regular.sh);
  expect(overscanned.sw / overscanned.sh).toBeCloseTo(348 / 317, 8);
  expect(overscanned.sx).toBeGreaterThan(0);
});

test('血铸巨匠在椭圆窗内下移，为贴顶的头部保留安全区', () => {
  expect(hearthArtVerticalOffset('bloodforgeColossus', 704)).toBeCloseTo(19.712, 6);
  expect(hearthArtVerticalOffset('stormDrake', 704)).toBe(0);
});
