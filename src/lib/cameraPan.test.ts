import { describe, expect, it } from "vitest";
import { rotateDelta } from "./cameraPan";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("rotateDelta", () => {
  it("matches the old world-space pan at yaw 0", () => {
    const d = rotateDelta(10, 4, 0);
    near(d.x, -10);
    near(d.z, -4);
  });
  it("mirrors both axes at yaw 180 degrees", () => {
    const d = rotateDelta(10, 4, Math.PI);
    near(d.x, 10);
    near(d.z, 4);
  });
  it("quarter turns rotate the delta", () => {
    const a = rotateDelta(10, 0, Math.PI / 2);
    near(a.x, 0);
    near(a.z, 10);
    const b = rotateDelta(10, 0, (3 * Math.PI) / 2);
    near(b.x, 0);
    near(b.z, -10);
  });
  it("preserves length and applies scale", () => {
    const d = rotateDelta(3, 4, 1.234, 0.025);
    near(Math.hypot(d.x, d.z), 5 * 0.025);
  });
  it("moves the target along the camera's -right for a rightward drag at any yaw", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 0.7]) {
      const d = rotateDelta(1, 0, yaw);
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      near(d.x, -right.x);
      near(d.z, -right.z);
    }
  });
});
