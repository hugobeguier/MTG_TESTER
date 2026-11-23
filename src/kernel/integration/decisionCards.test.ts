// Every card a kernel decision lists to its player carries the card (art, text, P/T) even while it is still in the library, and the source card is
// found by name; nothing beyond what the kernel listed is revealed.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "./testgame";
import { cardForName } from "./toSession";
import { toTableState } from "./tableState";
import { packKit } from "./cardPack";
import { buildPack } from "./nodePack";

const kit = packKit([buildPack("aminatou", { catalog: false })]);
const env = { ctx, display: kit.display };

function surveilGame() {
  const t = mini();
  for (const n of ["Island", "Swamp"]) t.give("p1", "Island", "battlefield"), t.give("p1", n, "battlefield");
  const hidden = t.give("p1", "Swamp", "library");
  const tops = ["Forest", "Mountain", "Plains"].map((n) => t.give("p1", n, "library", { top: true }));
  t.give("p1", "Otherworldly Gaze", "hand");
  t.ok({ type: "castSpell", player: "p1", cardId: t.state.players[0].hand[0] });
  t.settle();
  return { t, hidden, tops };
}

describe("decision options carry cards", () => {
  it("a surveil lists the top cards of the library with their cards, and the source card by name", () => {
    const { t, hidden, tops } = surveilGame();
    const d = toTableState(t.state, "p1", env).decision!;
    expect(d.kind).toBe("choose_cards");
    expect(d.options.length).toBe(3);
    for (const o of d.options) {
      expect(o.card?.zone).toBe("library");
      expect(o.card?.typeLine).toContain("Land");
      expect(o.card?.name).toBe(o.label);
    }
    expect(d.options.map((o) => o.id).sort()).toEqual([...tops].sort());
    expect(d.options.map((o) => o.id)).not.toContain(hidden);
    
    expect(d.sourceCard?.name).toBe("Otherworldly Gaze");
    expect(d.sourceCard?.oracleText).toMatch(/surveil/i);
  });
  it("nothing beyond the listed options is revealed: the session still shows the library as hidden stubs, and the opponent sees no options", () => {
    const { t, hidden } = surveilGame();
    const ts = toTableState(t.state, "p1", env);
    expect(JSON.stringify(ts.session)).not.toContain(hidden);
    expect(ts.session.seats[0].library?.every((c) => c.name === "Hidden card")).toBe(true);
    const theirs = toTableState(t.state, "p2", env);
    expect(theirs.decision).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toContain("Forest");
  });
  it("cardForName builds a fallback card (no art) from the definition, and nothing for an unknown name", () => {
    const c = cardForName({ ctx }, "Otherworldly Gaze");
    expect(c?.name).toBe("Otherworldly Gaze");
    expect(c?.imageUris).toBeUndefined();
    expect(c?.typeLine).toContain("Instant");
    expect(cardForName({ ctx }, "No Such Card")).toBeUndefined();
  });
});
