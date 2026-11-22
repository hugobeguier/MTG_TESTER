// Known differences that are NOT the kernel's, the drafts' or the adapter's fault: the legacy engine (or the headless self-play harness that
// drives it) does not do what the card / the rules say. Every rule names the cards it is about, the fields it may explain, a plain-English
// note and the EVIDENCE that makes it a legacy bug (a log line, a grep of src/engine, a rules citation). An action is "known legacy" when
// all of its diffs are state mismatches in the rule's fields and the rule's card is the acting card or the card named by the diff.
// A kernel / draft bug must never be added here: fix it, or leave the diff visible.
import type { Diff } from "./types";

export interface KnownLegacy {
  id: string;
  /** "legacy" = a real legacy rules bug; "harness" = the headless self-play orchestrator does not run something the live game does */
  owner: "legacy" | "harness";
  cards: string[];
  /** state_mismatch fields this rule may explain (undefined = any) */
  fields?: string[];
  /** also matches when this card is on either battlefield before the action and every diff is in `fields` (effects the legacy engine applies late / elsewhere) */
  boardHas?: string[];
  note: string;
  evidence: string;
}

export const KNOWN_LEGACY: KnownLegacy[] = [
  { id: "L-FLESHBAG", owner: "harness", cards: ["Fleshbag Marauder"], note: "Fleshbag Marauder's \"each player sacrifices a creature\" is a prompt the live UI drives (AppFlow); the headless orchestrator never runs it, so nobody sacrifices.", evidence: "legacy log of the cast shows only the cast line; src/components/AppFlow.sacrificeDeck.test.ts shows the UI path (destroyCreatures after a prompt)." },
  { id: "L-DISCIPLE-PROMPT", owner: "harness", cards: ["Disciple of Bolas"], note: "Disciple of Bolas's \"sacrifice another creature, gain X life and draw X cards\" is an interactive prompt (src/engine/cardScripts.ts disciple_sac); the headless orchestrator never answers it, so nothing is sacrificed.", evidence: "cardScripts.ts line ~298 asks the player (\"Don't sacrifice\" option); the legacy log of the cast has no sacrifice / draw line." },
  { id: "L-LATTICE-ARTIFACT-COUNT", owner: "legacy", cards: ["Mycosynth Lattice"], boardHas: ["Mycosynth Lattice"], fields: ["pt"], note: "Mycosynth Lattice makes every permanent an artifact, but the legacy artifact count (Darksteel Juggernaut, Master of Etherium...) ignores it: a land entering raises the count in the kernel only.", evidence: "play-land actions with Mycosynth Lattice on the board: the only diff is Darksteel Juggernaut 13/13 (legacy) vs 14/14 (kernel) right after a land enters." },
  { id: "R-SHUFFLE", owner: "harness", cards: ["Chaos Warp", "Finale of Revelation"], note: "The result depends on a random shuffle of the library (which card is revealed / drawn): the two engines use different random streams, so the position cannot match.", evidence: "legacy log: \"shuffles ... into its owner's library\" / \"shuffles their graveyard into their library\" followed by cards that the kernel's own shuffle does not reproduce." },
  { id: "L-DUPLICANT-PT", owner: "legacy", cards: ["Duplicant"], note: "Duplicant keeps its printed 2/4 after exiling a creature; the card gives it the exiled card's power, toughness and creature types.", evidence: "no handling of \"has the power, toughness, and creature types of the last creature card exiled\" anywhere in src/engine (grep); legacy shows Duplicant 2/4 after exiling a 2/3." },
  { id: "L-MYR-RETRIEVER", owner: "legacy", cards: ["Myr Retriever"], boardHas: ["Myr Retriever"], fields: ["zone:hand", "zone:graveyard"], note: "Myr Retriever's death trigger (return another artifact card from your graveyard to your hand) is not implemented.", evidence: "grep \"return another target artifact\" in src/engine finds nothing; legacy log after Myr Retriever dies has no trigger line." },
  { id: "L-MIRE-TRITON", owner: "legacy", cards: ["Mire Triton"], fields: ["life"], note: "Mire Triton mills two cards but the legacy engine skips the \"and you gain 2 life\" half.", evidence: "legacy log: \"Mire Triton mills ... for 2 cards.\" with no life gain line; grep of src/engine finds no Mire Triton / \"gain 2 life\" handler." },
  { id: "L-BEAST-WITHIN", owner: "legacy", cards: ["Beast Within"], note: "Beast Within destroys the permanent but its controller never gets the 3/3 Beast.", evidence: "src/engine/castTargets.ts (comment above applyRemovalEffect): \"Beast Within's token ... aren't modeled here\"; legacy log has only the destroy line." },
  { id: "L-LIVING-WEAPON-DYNAMIC", owner: "legacy", cards: ["Lashwrithe", "Nettlecyst", "Bonehoard"], note: "The living-weapon Phyrexian Germ is checked for toughness 0 before the Equipment's count-based bonus applies, so it dies at once (the log even says it was created and equipped afterwards).", evidence: "legacy log: \"Phyrexian Germ Token is put into ...graveyard for having toughness 0 or less\" followed by \"a Phyrexian Germ token is created and equipped\"; Tangleweave Armor (fixed +2/+2) works." },
  { id: "L-PSYCHOSIS-CRAWLER", owner: "legacy", cards: ["Psychosis Crawler"], note: "Psychosis Crawler's */* (number of cards in your hand) is never evaluated: it dies on entering as a 0/0 even with cards in hand.", evidence: "grep of src/engine finds no handler for \"equal to the number of cards in your hand\" on a creature; legacy log: \"Psychosis Crawler is put into ...graveyard for having toughness 0 or less\"." },
  { id: "L-LAZY-DEATH-TRIGGER", owner: "harness", cards: [], boardHas: ["Vengeful Dead"], fields: ["life"], note: "Vengeful Dead's \"whenever a Zombie dies, each opponent loses 1 life\" is drained at the start of the NEXT legacy action, so the life loss shows one action late.", evidence: "legacy log of the following cast: \"Vengeful Dead trigger resolves. ... loses 1 life each.\" while the killing action shows no loss." },
  { id: "L-SURRAK-GORECLAW", owner: "legacy", cards: ["Surrak and Goreclaw"], boardHas: ["Surrak and Goreclaw"], fields: ["counters", "pt"], note: "\"Whenever another nontoken creature you control enters, put a +1/+1 counter on it\" is not implemented.", evidence: "grep \"nontoken creature you control enters\" in src/engine finds nothing; no counter appears in the legacy state." }
];

const ruleFor = (diffs: Diff[]): KnownLegacy | undefined => {
  const real = diffs.filter((d) => d.category !== "adapter_gap");
  if (!real.length) return undefined;
  for (const rule of KNOWN_LEGACY) {
    const names = new Set(rule.cards);
    const acting = (d: Diff): boolean => !!d.intent.card && names.has(d.intent.card) || names.has(String(d.intent.label ?? "").replace(/^cast (commander )?/, ""));
    const about = real.every(acting) || real.every((d) => d.cards.some((c) => names.has(c)));
    const fieldsOk = real.every((d) => d.category.startsWith("state_mismatch:") && (!rule.fields || rule.fields.includes(d.category.slice("state_mismatch:".length))) || (!rule.fields && d.category.startsWith("state_mismatch:")));
    if (about && fieldsOk) return rule;
    if (rule.boardHas && rule.fields && real.every((d) => d.category.startsWith("state_mismatch:") && rule.fields!.includes(d.category.slice("state_mismatch:".length)))) {
      const boards = real.map((d) => (d.context as { boardBefore?: Record<string, string[]> } | undefined)?.boardBefore).find((b) => !!b);
      if (boards && Object.values(boards).some((l) => rule.boardHas!.some((c) => l.includes(c)))) return rule;
    }
  }
  return undefined;
};

/** The rule that explains ALL diffs of one action, if any. */
export function classifyAction(diffs: Diff[]): KnownLegacy | undefined { return ruleFor(diffs); }
