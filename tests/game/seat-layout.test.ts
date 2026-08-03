import { expect, test } from 'bun:test';

import * as THREE from 'three';
import {
  minionSeatWorldPosition,
  seatAngle,
  seatScreenPosition,
  seatWorldPosition,
  separateSeatHudAnchors,
  TABLE_VISUAL_LAYOUT,
  tableEllipseCenterOnPlane,
  tableEllipseCenterWorldPosition,
} from '../../src/ui/scene/SeatLayout';
import { tableDeckWorldPosition, tableDiscardWorldPosition } from '../../src/ui/scene/TableCenter';

test('本地玩家固定在圆桌下方', () => {
  for (let count = 2; count <= 8; count++) {
    const screen = seatScreenPosition(0, count);
    const world = seatWorldPosition(0, count);
    expect(screen.x).toBeCloseTo(50, 8);
    expect(screen.y).toBeCloseTo(100, 8);
    expect(world.x).toBeCloseTo(0, 8);
    expect(world.z).toBeGreaterThan(0);
  }
});

test('2-8 人对手脚点沿可见桌沿上半段按弧长等距', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 5.8, 7.8);
  camera.lookAt(0, 0.35, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  for (let count = 2; count <= 8; count++) {
    const points = Array.from({ length: count }, (_, seat) =>
      seatWorldPosition(seat, count).project(camera)
    );
    const radiusX = TABLE_VISUAL_LAYOUT.width * TABLE_VISUAL_LAYOUT.ellipseRadiusXRatio;
    const radiusY = TABLE_VISUAL_LAYOUT.height * TABLE_VISUAL_LAYOUT.ellipseRadiusYRatio;
    const arcLengths = Array.from({ length: Math.max(0, count - 2) }, (_, index) => {
      const start = seatAngle(index + 1, count);
      const end = seatAngle(index + 2, count);
      let length = 0;
      let previous = new THREE.Vector2(Math.cos(start) * radiusX, Math.sin(start) * radiusY);
      for (let sample = 1; sample <= 360; sample++) {
        const angle = THREE.MathUtils.lerp(start, end, sample / 360);
        const point = new THREE.Vector2(Math.cos(angle) * radiusX, Math.sin(angle) * radiusY);
        length += point.distanceTo(previous);
        previous = point;
      }
      return length;
    });
    if (arcLengths.length > 1) {
      expect(Math.max(...arcLengths) / Math.min(...arcLengths)).toBeLessThan(1.0001);
    }
    for (let seat = 1; seat < count; seat++) {
      const mirror = count - seat;
      expect(points[seat]!.x).toBeCloseTo(-points[mirror]!.x, 3);
      expect(points[seat]!.y).toBeCloseTo(points[mirror]!.y, 3);
    }
  }
});

test('桌子 Sprite 与座位锚点共享同一布局参数', () => {
  const local = seatWorldPosition(0, 8);
  const far = seatWorldPosition(4, 8);
  expect(TABLE_VISUAL_LAYOUT.width).toBeCloseTo(12.15, 8);
  expect(TABLE_VISUAL_LAYOUT.height).toBeCloseTo(4.65, 8);
  expect(local.x).toBeCloseTo(TABLE_VISUAL_LAYOUT.x, 8);
  expect(far.x).toBeCloseTo(TABLE_VISUAL_LAYOUT.x, 8);
  expect(local.z).toBeGreaterThan(far.z);
  expect(local.y).toBeLessThan(far.y);
});

test('两副中央牌堆围绕可见桌面椭圆中心对称', () => {
  const planeY = 0.56;
  const visualCenter = tableEllipseCenterWorldPosition();
  const planeCenter = tableEllipseCenterOnPlane(planeY);
  const pileMidpoint = tableDeckWorldPosition(planeY).lerp(tableDiscardWorldPosition(planeY), 0.5);
  const camera = new THREE.Vector3(0, 5.8, 7.8);

  expect(pileMidpoint.distanceTo(planeCenter)).toBeLessThan(1e-8);
  expect(planeCenter.y).toBeCloseTo(planeY, 8);
  expect(
    planeCenter.clone().sub(camera).normalize().dot(visualCenter.clone().sub(camera).normalize())
  ).toBeCloseTo(1, 8);
});

test('随从槽位沿各自席位到椭圆中心的固定内圈定位', () => {
  const center = tableEllipseCenterWorldPosition();
  for (let playerCount = 2; playerCount <= 8; playerCount++) {
    for (let seat = 0; seat < playerCount; seat++) {
      const rim = seatWorldPosition(seat, playerCount);
      const slot = minionSeatWorldPosition(seat, playerCount);
      expect(slot.distanceTo(rim) / center.distanceTo(rim)).toBeCloseTo(0.38, 8);
    }
  }
});

test('腰部 HUD 只在二维矩形真正相撞时纵向错层', () => {
  const separated = separateSeatHudAnchors(
    [
      { seat: 1, x: 80, y: 220, width: 104, height: 88 },
      { seat: 2, x: 112, y: 150, width: 104, height: 88 },
      { seat: 3, x: 250, y: 120, width: 104, height: 88 },
    ],
    420,
    8
  );
  for (let index = 0; index < separated.length; index++) {
    for (let otherIndex = index + 1; otherIndex < separated.length; otherIndex++) {
      const first = separated[index]!;
      const second = separated[otherIndex]!;
      const overlapsX = Math.abs(first.x - second.x) < (first.width + second.width) / 2 + 8;
      const overlapsY = Math.abs(first.y - second.y) < (first.height + second.height) / 2 + 8;
      expect(overlapsX && overlapsY).toBe(false);
    }
  }
  const layeredSameX = separateSeatHudAnchors(
    [
      { seat: 1, x: 210, y: 240, width: 104, height: 88 },
      { seat: 3, x: 210, y: 90, width: 104, height: 88 },
    ],
    420
  );
  expect(layeredSameX.map((anchor) => anchor.x)).toEqual([210, 210]);
});
