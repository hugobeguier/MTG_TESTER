import { it } from "vitest";
import { lookupCard, loadCardCatalog } from "@/lib/cardCatalog";
const catalog = loadCardCatalog();
import { commonTriggerEffect, parseGenericAbilityEffect } from "./AppFlow";
it("probe", () => {
  const out: string[] = [];
  for (const n of ["Spit Flame","Anger","Cursed Mirror","Dragonhawk, Fate's Tempest","The Elder Dragon War","Goldlust Triad","Minion of the Mighty","Nogi, Draco-Zealot","Thundermane Dragon","Herald's Horn","Grasp of Fate","Angelic Sleuth","Angel of the Ruins","Emeria Shepherd"]) {
    const c = lookupCard(catalog, n) as any;
    out.push("## " + n + " " + (c ? "" : "MISSING"));
    for (const line of (c?.oracleText ?? "").split("\n")) {
      const m = line.match(/^(?:when|whenever|at the beginning)/i) ? commonTriggerEffect(line.replace(/^[^,]*,\s*/, ""), "clause") : undefined;
      out.push("  " + line.slice(0, 60) + " => " + JSON.stringify(m ?? null));
    }
  }
  console.log(out.join("\n"));
});
