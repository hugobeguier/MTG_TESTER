import { ctx, deckNames } from "../src/kernel/integration/testgame";
for (const d of ["Wretched Ranks", "Meren", "Tramplesaurus Rex", "The Ur Dragon", "Saheeli", "Aminatou"]) {
  const names = [...new Set(deckNames(d).cards)]; const hits: string[] = [];
  for (const n of names) for (const a of ctx.cards(n)?.kernel.abilities ?? []) if (a.kind === "static" && a.static) for (const m of a.static.modify as any[]) if (("pt" in m && (typeof m.pt.power !== "number" || typeof m.pt.toughness !== "number")) || "setBasePT" in m) hits.push(n + (typeof a.static.affects === "string" ? ":" + a.static.affects : ":filter"));
  console.log(d, names.length, "cards; statics with computed P/T:", hits.join(", "));
}
