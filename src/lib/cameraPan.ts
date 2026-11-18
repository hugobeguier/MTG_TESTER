// Pure camera-pan math for the 3D table. The camera orbits the table's centre by `yaw` (0 = the +Z side, PI = the far side); a pan drag
// must move the scene the same way on screen whatever the yaw, so the screen-space drag delta is rotated into world X/Z here.
// Matches the keyboard movement basis in ThreeGameTable (forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)).

export interface WorldDelta {
  x: number;
  z: number;
}

/**
 * How far the camera TARGET moves (world X/Z) for a pan-drag of (dx, dy) screen pixels, scaled by `scale`: dragging right drags the scene
 * right (the target moves along -right), dragging down drags it down (the target moves along +forward). At yaw 0 this is (-dx, -dy) * scale.
 */
export function rotateDelta(dx: number, dy: number, yaw: number, scale = 1): WorldDelta {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: (-dx * cos - dy * sin) * scale, z: (dx * sin - dy * cos) * scale };
}
