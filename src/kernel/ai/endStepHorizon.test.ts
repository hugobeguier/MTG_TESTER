// The AI sees what its deck does (deck profile + value model + end-step horizon). Real cards (oracle text read from data/cards.db):
//   Meren of Clan Nel Toth {2}{B}{G} Legendary Creature 3/4  "Whenever another creature you control dies, you get an experience counter.
//     At the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience
//     counters you have, return it to the battlefield. Otherwise, put it into your hand."
//   Spore Frog {G} 1/1 Creature  "Sacrifice this creature: Prevent all combat damage that would be dealt this turn."
import { describe, expect, it } from "vitest";
import { ctx, deckNames } from "../integration/testgame";
import { legalActions } from "../engine/legal";
import { chooseAiAction, type AiMemory } from "../../components/game/kernelAi";
import { deckProfile } from "./profile";
import { endStepLive } from "./horizon";
import { board, choose, playOne, zoneOf, type Table } from "./kernelAiKit";

const d = deckNames("Meren");
const merenProfile = deckProfile(d.cards, d.commander, ctx);
const withProfile = (): Record<string, AiMemory> => ({ p1: { banned: new Set(), profiles: { p1: merenProfile } } });
const exp = (t: Table, seat = "p1") => t.state.players.find((p) => p.id === seat)!.counters?.experience ?? 0;

/** play the rest of the turn the way the engine does: nothing declared, triggers resolved by the AI, until the end step has resolved */
function toEndStep(t: Table, seat = "p1"): void {
  for (let i = 0; i < 40; i++) {
    const s = t.state;
    if (s.pending) { const a = chooseAiAction(legalActions(s, s.pending.player, ctx), s, ctx, s.pending.player, { banned: new Set() }); t.ok(a!); continue; }
    if (s.stack.length) { t.ok({ type: "passPriority", player: s.priority!, fastForward: true }); continue; }
    if (s.turn.phase === "end_step") return;
    t.ok({ type: "advancePhase", player: seat });
  }
  throw new Error("end step not reached");
}

describe("sacrifice outlet + recursion engine (Meren + Spore Frog)", () => {
  const spec = () => board({ p1: { lands: { Forest: 4, Swamp: 4 }, field: ["Meren of Clan Nel Toth", "Spore Frog"] }, p2: {} });
  it("activates Spore Frog in the main phase; the end step returns it and the death gave an experience counter", () => {
    const { t, ids } = spec();
    const frog = ids["p1:Spore Frog"][0];
    const r = playOne(t, "p1", withProfile());
    expect(r.label).toMatch(/^Spore Frog: Sacrifice/);
    expect(exp(t)).toBe(1); // "whenever another creature you control dies" resolved
    expect(zoneOf(t, frog)).toBe("graveyard");
    toEndStep(t);
    const back = Object.values(t.state.objects).find((o) => o.cardName === "Spore Frog" && o.zone === "battlefield"); // mana value 1 <= 1 experience: back on the battlefield
    expect(back).toBeTruthy();
    expect(exp(t)).toBe(1);
  });
  it("works without a profile too (it is derived from the seat's own cards)", () => {
    const { t } = spec();
    expect(playOne(t, "p1").label).toMatch(/^Spore Frog: Sacrifice/);
  });
  it("the horizon is what makes it pay: only live when the seat controls an end-step effect", () => {
    const { t } = spec();
    expect(endStepLive(t.state, ctx, "p1", merenProfile)).toBe(true);
    const c = board({ p1: { lands: { Forest: 4 }, field: ["Spore Frog"] }, p2: {} });
    expect(endStepLive(c.t.state, ctx, "p1", merenProfile)).toBe(false);
  });
  it("control: without Meren the same Spore Frog is NOT sacrificed (nothing brings it back, nothing pays)", () => {
    const { t, ids } = board({ p1: { lands: { Forest: 4, Swamp: 4 }, field: ["Spore Frog"] }, p2: {} });
    expect(choose(t, "p1", withProfile().p1).label).not.toMatch(/Spore Frog/);
    expect(playOne(t, "p1").label).toBeUndefined();
    expect(zoneOf(t, ids["p1:Spore Frog"][0])).toBe("battlefield");
  });
  it("control: with Meren but nothing worth sacrificing (only Meren herself on the board) it does nothing silly", () => {
    const { t } = board({ p1: { lands: { Forest: 4, Swamp: 4 }, field: ["Meren of Clan Nel Toth"] }, p2: {} });
    expect(playOne(t, "p1", withProfile()).label).toBeUndefined();
  });
  it("does not sacrifice a big creature just for the counter: Meren + a 10/10", () => {
    const { t, ids } = board({ p1: { lands: { Forest: 4, Swamp: 4 }, field: ["Meren of Clan Nel Toth", "Gigantosaurus"] }, p2: {} });
    playOne(t, "p1", withProfile());
    expect(zoneOf(t, ids["p1:Gigantosaurus"][0])).toBe("battlefield");
  });
});
