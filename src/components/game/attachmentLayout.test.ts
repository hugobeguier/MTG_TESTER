import { describe, expect, it } from "vitest";
import { HOST_HEIGHT, attachmentLayout } from "./attachmentLayout";

describe("attachmentLayout", () => {
  it("puts the first attachment behind its host, peeking out on the right (equipment) or left (aura)", () => {
    const r = attachmentLayout(1, 0, "right");
    const l = attachmentLayout(1, 0, "left");
    expect(r.y).toBeLessThan(HOST_HEIGHT);
    expect(r.renderOrder).toBeLessThan(0);
    expect(r.dx).toBeGreaterThan(0.36); // beyond the host's half width: a visible strip
    expect(l.dx).toBe(-r.dx);
  });
  it("fans several attachments outward, each at its own lower height", () => {
    const ps = [0, 1, 2, 3].map((i) => attachmentLayout(4, i, "right"));
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i].dx).toBeGreaterThan(ps[i - 1].dx);
      expect(ps[i].y).toBeLessThan(ps[i - 1].y);
      expect(ps[i].renderOrder).toBeLessThan(ps[i - 1].renderOrder);
    }
  });
  it("never goes below the table plane and packs a crowded side tighter", () => {
    expect(attachmentLayout(20, 19, "right").y).toBeGreaterThan(0);
    expect(attachmentLayout(4, 1, "right").dx - attachmentLayout(4, 0, "right").dx).toBeLessThan(attachmentLayout(2, 1, "right").dx - attachmentLayout(2, 0, "right").dx);
  });
});
