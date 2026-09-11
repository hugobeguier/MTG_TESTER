import { describe, expect, it } from "vitest";
import { xmageReferenceBlurb } from "./xmageGrounding";
import type { XMageCardRow } from "./cardDb";

function xmageRow(overrides: Partial<XMageCardRow> & Pick<XMageCardRow, "source">): XMageCardRow {
  return {
    xmageKey: "testcard",
    filePath: "data/xmage-source/Mage.Sets/src/mage/cards/t/TestCard.java",
    ingestedAt: "2026-09-11T00:00:00.000Z",
    ...overrides
  };
}

describe("xmageReferenceBlurb", () => {
  it("includes the file path and the full source when under the size cap", () => {
    const blurb = xmageReferenceBlurb(xmageRow({ source: "public final class TestCard extends CardImpl {}" }));
    expect(blurb).toContain("TestCard.java");
    expect(blurb).toContain("public final class TestCard extends CardImpl {}");
    expect(blurb).not.toContain("(truncated)");
  });

  it("tells the model this is read-only grounding from a different engine, not instructions to follow", () => {
    const blurb = xmageReferenceBlurb(xmageRow({ source: "class X {}" }));
    expect(blurb).toMatch(/reference only/i);
    expect(blurb).toMatch(/do not copy java/i);
    expect(blurb).toMatch(/different, independent open-source magic engine/i);
  });

  it("truncates a source well past the size cap, with a visible marker", () => {
    const hugeSource = "x".repeat(20000);
    const blurb = xmageReferenceBlurb(xmageRow({ source: hugeSource }));
    expect(blurb).toContain("(truncated)");
    expect(blurb.length).toBeLessThan(hugeSource.length);
  });

  it("does not truncate a source right at the cap boundary", () => {
    const exactSource = "y".repeat(6000);
    const blurb = xmageReferenceBlurb(xmageRow({ source: exactSource }));
    expect(blurb).not.toContain("(truncated)");
    expect(blurb).toContain(exactSource);
  });
});
