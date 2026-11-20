import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bear, by, seat, session } from "@/components/AppFlow.batch3Abilities.test";
import { SummoningSickBadge } from "@/components/SummoningSickBadge";
import { VisualCard } from "@/components/VisualCard";
import { moveCardAcrossSeats } from "@/engine/entry";
import { untapForSeat } from "@/engine/turnFlow";
import { changeControlWithinBattlefield } from "@/engine/zones";
import { buildSnapshot } from "@/lib/multiplayer/snapshot";
import { SUMMONING_SICK_TOOLTIP, isSummoningSick } from "@/lib/summoningSickness";
import type { VisibleCard } from "@/lib/types";

const sick = (extra: Partial<VisibleCard> = {}) => bear("c", { summoningSick: true, ...extra });

describe("isSummoningSick", () => {
  it("is true for a fresh creature and false once the flag is clear", () => {
    expect(isSummoningSick(sick())).toBe(true);
    expect(isSummoningSick(sick({ summoningSick: false }))).toBe(false);
  });
  it("never applies to haste (printed or granted)", () => {
    expect(isSummoningSick(sick({ oracleText: "Haste" }))).toBe(false);
    expect(isSummoningSick(sick({ grantedKeywords: ["haste"] }))).toBe(false);
  });
  it("ignores noncreature permanents, but a permanent that is currently a creature counts", () => {
    expect(isSummoningSick(sick({ typeLine: "Artifact — Treasure" }))).toBe(false);
    expect(isSummoningSick(sick({ typeLine: "Artifact — Vehicle" }))).toBe(false);
    expect(isSummoningSick(sick({ typeLine: "Artifact Creature — Vehicle" }))).toBe(true);
  });
  it("clears at the start of its controller's next turn only, not an opponent's", () => {
    const s = session([seat("a", [sick()]), seat("b", [])]);
    expect(isSummoningSick(by(untapForSeat(s, "b"), "a").board.battlefield[0])).toBe(true);
    expect(isSummoningSick(by(untapForSeat(s, "a"), "a").board.battlefield[0])).toBe(false);
  });
  it("is sick again after a control change", () => {
    const s = session([seat("a", [bear("c")]), seat("b", [])]);
    const moved = changeControlWithinBattlefield(s, "c", "a", "b");
    expect(isSummoningSick(by(moved, "b").board.battlefield[0])).toBe(true);
  });
  it("is sick again after leaving and re-entering the battlefield (blink)", () => {
    const s = session([seat("a", [bear("c")]), seat("b", [])]);
    const out = moveCardAcrossSeats(s, "a", "c", "a", "exile").session;
    const back = out.seats.find((x) => x.id === "a")!.board.exile?.find((c) => c.id === "c");
    expect(back).toBeDefined();
    const returned = moveCardAcrossSeats(out, "a", "c", "a", "battlefield").session;
    expect(isSummoningSick(by(returned, "a").board.battlefield[0])).toBe(true);
  });
});

describe("hourglass badge", () => {
  it("renders with the tooltip/aria-label only for a sick creature", () => {
    const html = renderToStaticMarkup(<SummoningSickBadge card={sick()} />);
    expect(html).toContain("<svg");
    expect(html).toContain(`aria-label="${SUMMONING_SICK_TOOLTIP.replace(/'/g, "&#x27;")}"`);
    expect(renderToStaticMarkup(<SummoningSickBadge card={sick({ oracleText: "Haste" })} />)).toBe("");
    expect(renderToStaticMarkup(<VisualCard card={sick()} />)).toContain("summoning-sick-badge");
  });
  it("the flag reaches every viewer's snapshot for every seat's creatures (public info)", () => {
    const s = session([seat("a", [sick({ id: "x" })]), seat("b", [sick({ id: "y" })])]);
    const snap = buildSnapshot({ session: s, hostName: "Host", priorityPasses: [], stackActions: [], gameStage: "playing" }, "b");
    for (const guestSeat of snap.session.seats) expect(isSummoningSick(guestSeat.board.battlefield[0])).toBe(true);
  });
});
