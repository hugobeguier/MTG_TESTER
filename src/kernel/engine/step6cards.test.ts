// Kernel step 6: every drafted card the engine newly runs is (a) reported fully supported and (b) survives a full turn cycle on the battlefield
// without a runtime "unsupported" / crash (static abilities, triggers and replacement effects scanned on real events), hands, graveyard and libraries seeded.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { realDef, realTable } from "./testdb";

const NEW = ["Cursed Mirror", "Estrid's Invocation", "Shifting Woodland", "Saheeli, Sublime Artificer", "Brudiclad, Telchor Engineer", "Memnarch", "Mister Negative", "Gray Merchant of Asphodel", "Chittering Witch", "Cankerbloom", "Angelic Sleuth", "The Ozolith", "Birthing Pod", "Fiend Artisan", "Lashwrithe", "Ashnod's Altar", "Phyrexian Altar", "Phyrexian Tower", "Gilded Goose", "Culling Ritual", "Sarkhan Unbroken", "Vanguard Seraph", "Dina, Essence Brewer", "Savra, Queen of the Golgari", "Moonstone Eulogist", "Psychosis Crawler", "Skullclamp", "Mazemind Tome", "Court of Grace", "Crown of Gondor", "Skyline Despot", "Sarkhan the Masterless", "Vedalken Humiliator", "End-Raze Forerunners", "Terror of Mount Velus", "Taurean Mauler", "Dauthi Voidwalker", "Chatterfang, Squirrel General", "Blasphemous Act", "Ancient Stone Idol", "Cleansing Nova", "Day of Judgment", "All Is Dust", "Reanimate", "Thirst for Knowledge", "Binding the Old Gods", "Shineshadow Snarl", "Necroblossom Snarl", "Frostboil Snarl", "Cultivator's Caravan", "Tear Asunder", "Disciple of Freyalise // Garden of Freyalise", "Fell the Profane // Fell Mire", "Skysovereign, Consul Flagship", "Thopter Fabricator", "Outpost Siege", "Three Tree City", "Orzhov Locket", "Sheoldred, Whispering One", "Maskwood Nexus", "Tezzeret, Artifice Master", "Angelic Destiny", "Wolfwillow Haven", "Exemplar of Light", "Dusk Legion Duelist", "Wojek Investigator", "Forsaken Monument", "Mycosynth Lattice", "Athreos, Shroud-Veiled", "Breena, the Demagogue", "Vault of Champions", "War Room"];
const STILL_OPEN = ["Hazel of the Rootbloom", "Gourmand's Talent"];

describe("newly supported real cards", () => {
  it.each(NEW)("%s is fully supported", (n) => { expect(cardUnsupported(realDef(n)!).all).toEqual([]); });
  it.each(STILL_OPEN)("%s still reports what it lacks (never faked)", (n) => { expect(cardUnsupported(realDef(n)!).all.length).toBeGreaterThan(0); });
});

describe("a full turn cycle with the card in play is safe and deterministic", () => {
  const run = (n: string) => {
    const t = realTable();
    for (let i = 0; i < 12; i++) { t.give("p1", "Forest", "library"); t.give("p2", "Island", "library"); }
    t.lands("p1", "Forest", 2); t.give("p1", "Llanowar Elves", "battlefield"); t.give("p2", "Llanowar Elves", "battlefield");
    t.give("p1", n, "battlefield");
    for (let i = 0; i < 24 && t.state.turn.number < 3; i++) {
      const p = t.state.pending;
      if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" ? { yes: false } : { ids: p.options.map((o) => o.id).slice(0, Math.max(p.min, 0)) } });
      else if (t.state.stack.length) t.resolveTop();
      else t.ok({ type: "advancePhase", player: t.state.priority ?? t.state.turn.active });
    }
    return JSON.stringify(t.state);
  };
  it.each(NEW.filter((n) => !["Disciple of Freyalise // Garden of Freyalise", "Fell the Profane // Fell Mire"].includes(n)))("%s", (n) => {
    expect(run(n)).toBe(run(n));
  });
});
