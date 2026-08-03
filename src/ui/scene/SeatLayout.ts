import * as THREE from 'three';

/** The painted table sprite and the visible outer tabletop ellipse within it. */
export const TABLE_VISUAL_LAYOUT = Object.freeze({
  x: 0,
  y: -0.98,
  z: 0.85,
  width: 12.15,
  height: 4.65,
  ellipseCenterYRatio: 0.148,
  ellipseRadiusXRatio: 0.495,
  ellipseRadiusYRatio: 0.352,
});

const seatAngleCache = new Map<number, readonly number[]>();
const TABLE_CAMERA_Y = 5.8;
const TABLE_CAMERA_Z = 7.8;

/**
 * Seat 0 is the local first-person position at the bottom edge. Paper actors
 * occupy only the visible opponent arc, from the near-left rim across the far
 * edge to the near-right rim. That keeps actors off the local/front tabletop.
 */
export function seatAngle(seat: number, playerCount: number): number {
  const count = Math.max(2, playerCount);
  const normalizedSeat = ((seat % count) + count) % count;
  return equalArcSeatAngles(count)[normalizedSeat]!;
}

function equalArcSeatAngles(playerCount: number): readonly number[] {
  const cached = seatAngleCache.get(playerCount);
  if (cached) return cached;

  if (playerCount === 2) {
    const headsUp = [Math.PI / 2, Math.PI * 1.5];
    seatAngleCache.set(playerCount, headsUp);
    return headsUp;
  }

  const sampleCount = 1440;
  const start = THREE.MathUtils.degToRad(160);
  const end = THREE.MathUtils.degToRad(380);
  const radiusX = TABLE_VISUAL_LAYOUT.width * TABLE_VISUAL_LAYOUT.ellipseRadiusXRatio;
  const radiusY = TABLE_VISUAL_LAYOUT.height * TABLE_VISUAL_LAYOUT.ellipseRadiusYRatio;
  const cumulative = new Array<number>(sampleCount + 1).fill(0);
  let previous = ellipsePoint(start, radiusX, radiusY);

  for (let index = 1; index <= sampleCount; index++) {
    const angle = THREE.MathUtils.lerp(start, end, index / sampleCount);
    const point = ellipsePoint(angle, radiusX, radiusY);
    cumulative[index] = cumulative[index - 1]! + point.distanceTo(previous);
    previous = point;
  }

  const totalLength = cumulative[sampleCount]!;
  const opponentCount = playerCount - 1;
  const opponents = Array.from({ length: opponentCount }, (_, opponentIndex) => {
    const target = (totalLength * opponentIndex) / (opponentCount - 1);
    let low = 0;
    let high = sampleCount;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cumulative[middle]! < target) low = middle + 1;
      else high = middle;
    }
    const previousIndex = Math.max(0, low - 1);
    const segmentLength = cumulative[low]! - cumulative[previousIndex]!;
    const fraction = segmentLength > 0 ? (target - cumulative[previousIndex]!) / segmentLength : 0;
    return THREE.MathUtils.lerp(start, end, (previousIndex + fraction) / sampleCount);
  });
  const angles = [Math.PI / 2, ...opponents];
  seatAngleCache.set(playerCount, angles);
  return angles;
}

function ellipsePoint(angle: number, radiusX: number, radiusY: number): THREE.Vector2 {
  return new THREE.Vector2(Math.cos(angle) * radiusX, -Math.sin(angle) * radiusY);
}

export interface SeatHudAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Resolve only real 2D card collisions. Horizontal-only packing detached cards
 * from actors that share an x coordinate on different parts of the ellipse.
 */
export function separateSeatHudAnchors<T extends SeatHudAnchor>(
  anchors: readonly T[],
  viewportWidth: number,
  gap = 8
): T[] {
  if (anchors.length < 2 || viewportWidth <= 0) return anchors.map((anchor) => ({ ...anchor }));
  const sorted = anchors.map((anchor) => ({ ...anchor })).sort((a, b) => a.y - b.y || a.x - b.x);
  const edge = 6;

  for (const anchor of sorted) {
    const halfWidth = anchor.width / 2;
    anchor.x = THREE.MathUtils.clamp(anchor.x, edge + halfWidth, viewportWidth - edge - halfWidth);
  }

  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index]!;
    for (let previousIndex = 0; previousIndex < index; previousIndex++) {
      const previous = sorted[previousIndex]!;
      const horizontalLimit = (previous.width + current.width) / 2 + gap;
      const verticalLimit = (previous.height + current.height) / 2 + gap;
      if (Math.abs(current.x - previous.x) >= horizontalLimit) continue;
      const verticalDistance = current.y - previous.y;
      if (Math.abs(verticalDistance) >= verticalLimit) continue;
      current.y += verticalLimit - verticalDistance;
    }
  }
  return sorted;
}

export function seatWorldPosition(
  seat: number,
  playerCount: number,
  _legacyRadiusX?: number,
  _legacyRadiusZ?: number
): THREE.Vector3 {
  const angle = seatAngle(seat, playerCount);
  const radiusX = TABLE_VISUAL_LAYOUT.width * TABLE_VISUAL_LAYOUT.ellipseRadiusXRatio;
  const radiusY = TABLE_VISUAL_LAYOUT.height * TABLE_VISUAL_LAYOUT.ellipseRadiusYRatio;
  const localX = Math.cos(angle) * radiusX;
  const localY =
    TABLE_VISUAL_LAYOUT.height * TABLE_VISUAL_LAYOUT.ellipseCenterYRatio -
    Math.sin(angle) * radiusY;

  // The table is a camera-facing Sprite. Its edge anchors therefore live in
  // the same right/up plane, keeping actor feet attached through camera resize.
  const viewLength = Math.hypot(5.45, 7.8);
  const cameraUpY = 7.8 / viewLength;
  const cameraUpZ = -5.45 / viewLength;
  return new THREE.Vector3(
    TABLE_VISUAL_LAYOUT.x + localX,
    TABLE_VISUAL_LAYOUT.y + localY * cameraUpY,
    TABLE_VISUAL_LAYOUT.z + localY * cameraUpZ
  );
}

/** Center of the painted tabletop ellipse on the camera-facing table sprite. */
export function tableEllipseCenterWorldPosition(): THREE.Vector3 {
  const localY = TABLE_VISUAL_LAYOUT.height * TABLE_VISUAL_LAYOUT.ellipseCenterYRatio;
  const viewLength = Math.hypot(5.45, TABLE_CAMERA_Z);
  const cameraUpY = TABLE_CAMERA_Z / viewLength;
  const cameraUpZ = -5.45 / viewLength;
  return new THREE.Vector3(
    TABLE_VISUAL_LAYOUT.x,
    TABLE_VISUAL_LAYOUT.y + localY * cameraUpY,
    TABLE_VISUAL_LAYOUT.z + localY * cameraUpZ
  );
}

/** Project that visual center onto the real horizontal plane holding the cards. */
export function tableEllipseCenterOnPlane(planeY: number): THREE.Vector3 {
  const visualCenter = tableEllipseCenterWorldPosition();
  const rayFraction = (planeY - TABLE_CAMERA_Y) / (visualCenter.y - TABLE_CAMERA_Y);
  return new THREE.Vector3(
    0,
    planeY,
    TABLE_CAMERA_Z + (visualCenter.z - TABLE_CAMERA_Z) * rayFraction
  );
}

/** A seat-relative board slot, inset from the visible rim toward the ellipse center. */
export function minionSeatWorldPosition(
  seat: number,
  playerCount: number,
  inset = 0.38
): THREE.Vector3 {
  return seatWorldPosition(seat, playerCount).lerp(
    tableEllipseCenterWorldPosition(),
    THREE.MathUtils.clamp(inset, 0, 1)
  );
}

/** 0 at the far edge and 1 at the local/near edge; use for scale and z-order only. */
export function seatNearFactor(seat: number, playerCount: number): number {
  return (Math.sin(seatAngle(seat, playerCount)) + 1) / 2;
}

export function seatScreenPosition(
  seat: number,
  playerCount: number,
  radiusX = 50,
  radiusY = 50
): { x: number; y: number } {
  const angle = seatAngle(seat, playerCount);
  return {
    x: 50 + Math.cos(angle) * radiusX,
    y: 50 + Math.sin(angle) * radiusY,
  };
}
