// Dredge (kernel step 9, CR 702.52): "If you would draw a card, you may mill N cards instead. If you do, return this card from your
// graveyard to your hand." A replacement of the draw, offered per draw when a card with dredge N is in the graveyard and the library
// has at least N cards. Asked through the replay protocol (core.takeAnswer / NeedAsk); "Draw normally" is listed first so a default
// policy that picks the first option never dredges.
import { NeedAsk, moveObject, player, printedAbilities, takeAnswer, tryObj, label, emit, type Run } from "./core";
import type { ObjId, PlayerId } from "./types";

const dredgeN = (r: Run, id: ObjId): number | undefined => {
  const o = tryObj(r, id);
  if (!o) return undefined;
  const k = printedAbilities(r, o).find((a) => a.kind === "keyword" && a.keyword?.name.toLowerCase() === "dredge");
  const n = Number(k?.keyword?.param);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** true = a dredge happened instead of the draw */
export function offerDredge(r: Run, pid: PlayerId): boolean {
  const p = player(r, pid);
  const cands = p.graveyard.filter((id) => { const n = dredgeN(r, id); return n !== undefined && p.library.length >= n; });
  if (!cands.length) return false;
  const given = takeAnswer(r);
  if (given === undefined) {
    throw new NeedAsk({
      kind: "choose_option", player: pid,
      prompt: { title: "Dredge?", instruction: "You would draw a card. You may instead mill cards equal to a dredge number and return that card from your graveyard to your hand." },
      options: [{ id: "draw", label: "Draw normally" }, ...cands.map((id) => ({ id, label: `Dredge ${dredgeN(r, id)}: ${label(r, id)}` }))], min: 1, max: 1
    });
  }
  const pick = given.ids?.[0];
  if (!pick || pick === "draw" || !cands.includes(pick)) return false;
  const n = dredgeN(r, pick)!;
  for (let i = 0; i < n; i++) { const top = p.library[0]; if (top) moveObject(r, top, "graveyard"); }
  moveObject(r, pick, "hand");
  emit(r, { type: "dredged", player: pid, id: pick, milled: n });
  return true;
}
