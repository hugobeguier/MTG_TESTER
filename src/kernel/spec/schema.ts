// Declarative per-card behaviour specs (see docs/card-spec-format.md). A spec is authored from a card's oracle text and the Comprehensive Rules alone;
// it never mentions engine ids, ability ids or draft JSON. Everything here is STRICT: an unknown key or a missing `why` is a SPEC ERROR, never a card failure.
import { z } from "zod";

const str = z.string().min(1);
const int = z.number().int();
export const PlayerRef = z.string().regex(/^p[1-4]$/, "player must be p1..p4");
export const ZoneName = z.enum(["hand", "battlefield", "graveyard", "exile", "library", "command"]);
export const PhaseName = z.enum(["upkeep", "draw", "precombat_main", "beginning_of_combat", "declare_attackers", "declare_blockers", "first_strike_damage", "combat_damage", "end_of_combat", "postcombat_main", "end_step", "cleanup"]);
export const ColorKey = z.enum(["W", "U", "B", "R", "G", "C"]);
const Counters = z.record(int.min(0));
const Mana = z.object({ W: int.min(0).optional(), U: int.min(0).optional(), B: int.min(0).optional(), R: int.min(0).optional(), G: int.min(0).optional(), C: int.min(0).optional() }).strict();

/** a number to compare: a bare number means "equals" */
export const Num = z.union([int, z.object({ equals: int.optional(), atLeast: int.optional(), atMost: int.optional() }).strict().refine((o) => Object.keys(o).length > 0, "give equals, atLeast and/or atMost")]);
export type NumSpec = z.infer<typeof Num>;
/** a list to compare (multiset for card names): exactly / atLeast / noneOf, any combination */
export const ListMatch = z.object({ exactly: z.array(z.string()).optional(), atLeast: z.array(z.string()).optional(), noneOf: z.array(z.string()).optional() }).strict().refine((o) => Object.keys(o).length > 0, "give exactly, atLeast and/or noneOf");
export type ListSpec = z.infer<typeof ListMatch>;

// ---------------------------------------------------------------- setup
const TokenSpec = z.object({
  name: str, types: z.array(str).min(1), subtypes: z.array(str).default([]), colors: z.array(ColorKey).default([]),
  power: int.optional(), toughness: int.optional(), keywords: z.array(str).default([])
}).strict();
/** One card (or token) in a zone. A bare string is a card by its real name (or a catalog stand-in). */
export const Entry = z.union([str, z.object({
  card: str.optional(), token: TokenSpec.optional(),
  as: str.optional(),
  count: int.min(1).max(40).optional(),
  tapped: z.boolean().optional(),
  counters: Counters.optional(),
  /** battlefield: came under its controller's control this turn (summoning sick) */
  fresh: z.boolean().optional(),
  faceDown: z.boolean().optional(),
  /** battlefield Aura / Equipment: what it is attached to (an object reference, e.g. "p2:Vanilla 2/2"); a player id for an Aura that enchants a player */
  attachedTo: str.optional(),
  /** battlefield: controlled by someone other than the owner */
  controller: PlayerRef.optional(),
  /** "as it enters, choose a color/type/name" already made */
  chosen: z.object({ color: ColorKey.optional(), type: str.optional(), name: str.optional() }).strict().optional(),
  /** Rooms: the unlocked door names */
  unlocked: z.array(str).optional(),
  damage: int.min(0).optional()
}).strict().refine((o) => !!o.card !== !!o.token, "give exactly one of card / token")]);
export type EntrySpec = z.infer<typeof Entry>;

export const PlayerSetup = z.object({
  life: int.optional(),
  hand: z.array(Entry).optional(),
  battlefield: z.array(Entry).optional(),
  graveyard: z.array(Entry).optional(),
  exile: z.array(Entry).optional(),
  /** top first. Omitted = 30 Islands (so drawing never loses the game); [] = really empty */
  library: z.array(Entry).optional(),
  command: z.array(Entry).optional(),
  /** a commander in the command zone (shorthand) */
  commander: str.optional(),
  pool: Mana.optional(),
  counters: Counters.optional(),
  landsPlayed: int.min(0).optional()
}).strict();

// ---------------------------------------------------------------- answers to decisions
const Pick = z.union([str, z.object({ index: int.min(0) }).strict()]);
export const Answer = z.object({
  /** true: the engine MUST ask this decision (FAIL if it asks something else or nothing). Default: an answer that does not fit what is asked is skipped (a forced choice may legitimately not be asked); targets given on cast / activate are always required */
  required: z.boolean().optional(),
  /** assert the engine asks this kind of decision (choose_targets, choose_modes, choose_yes_no, choose_cards, choose_color, choose_option, choose_number, choose_x, order_triggers, order_library, pay_unless, pay_mana, assign_damage, ...) */
  kind: str.optional(),
  /** assert the asked player */
  player: PlayerRef.optional(),
  /** assert the prompt text (title or instruction) contains this */
  promptContains: str.optional(),
  /** the options to choose, by option label / card name ("Name#2" = second option with that label) or {index: n} (0-based) */
  pick: z.array(Pick).optional(),
  yes: z.boolean().optional(),
  number: int.optional(),
  /** answer with no options at all (an optional choice declined) */
  none: z.boolean().optional(),
  cancel: z.boolean().optional(),
  /** pay_mana: sources to tap (object references) */
  payWith: z.array(str).optional(),
  /** assign_damage / assign_counters / assign_mana: option label -> amount */
  assign: z.record(int.min(0)).optional(),
  /** order_library: where each listed card goes */
  place: z.object({ top: z.array(str).optional(), toBottom: z.array(str).optional(), toGraveyard: z.array(str).optional() }).strict().optional()
}).strict();
export type AnswerSpec = z.infer<typeof Answer>;

// ---------------------------------------------------------------- expectations
const why = z.string().min(10, "`why` must quote the oracle clause or CR section this tests");
const Since = z.enum(["scenario", "lastAction"]);
const base = { why };
const ExpectationBase = z.discriminatedUnion("check", [
  z.object({ check: z.literal("life"), player: PlayerRef, value: Num, ...base }).strict(),
  z.object({ check: z.literal("zone"), player: PlayerRef, zone: ZoneName, cards: ListMatch.optional(), count: Num.optional(), ordered: z.boolean().optional(), ...base }).strict(),
  z.object({ check: z.literal("permanent"), ref: str,
    exists: z.boolean().optional(), zone: str.optional(), controller: PlayerRef.optional(), owner: PlayerRef.optional(), name: str.optional(),
    power: Num.optional(), toughness: Num.optional(), manaValue: Num.optional(),
    types: ListMatch.optional(), subtypes: ListMatch.optional(), supertypes: ListMatch.optional(), keywords: ListMatch.optional(), colors: ListMatch.optional(),
    abilityText: ListMatch.optional(), abilitiesStripped: z.boolean().optional(),
    tapped: z.boolean().optional(), summoningSick: z.boolean().optional(), damage: Num.optional(), faceDown: z.boolean().optional(), token: z.boolean().optional(),
    attacking: z.boolean().optional(), blocking: z.boolean().optional(),
    attachedTo: z.union([str, z.null()]).optional(), attachments: ListMatch.optional(),
    counters: z.record(Num).optional(), unlocked: ListMatch.optional(), chosenColor: ColorKey.optional(), ...base }).strict(),
  z.object({ check: z.literal("tokens"), player: PlayerRef, name: str.optional(), count: Num.optional(), power: Num.optional(), toughness: Num.optional(), types: ListMatch.optional(), subtypes: ListMatch.optional(), colors: ListMatch.optional(), keywords: ListMatch.optional(), tapped: z.boolean().optional(), ...base }).strict(),
  z.object({ check: z.literal("stack"), items: ListMatch.optional(), count: Num.optional(), topFirst: z.array(str).optional(), ...base }).strict(),
  z.object({ check: z.literal("pending"), present: z.boolean(), kind: str.optional(), player: PlayerRef.optional(), promptContains: str.optional(), options: ListMatch.optional(), min: Num.optional(), max: Num.optional(), ...base }).strict(),
  z.object({ check: z.literal("pool"), player: PlayerRef, equals: Mana.optional(), atLeast: Mana.optional(), total: Num.optional(), ...base }).strict(),
  z.object({ check: z.literal("turn"), active: PlayerRef.optional(), phase: PhaseName.optional(), number: Num.optional(), ...base }).strict(),
  z.object({ check: z.literal("player"), player: PlayerRef, hasLost: z.boolean().optional(), monarch: z.boolean().optional(), counters: z.record(Num).optional(), ...base }).strict(),
  z.object({ check: z.literal("game"), over: z.boolean().optional(), winner: PlayerRef.optional(), ...base }).strict(),
  /** substring(s) that must (contains) / must not (absent) appear in some event line since the marker; lines look like "damage_dealt source=Lightning Bolt target=p2 amount=3" */
  z.object({ check: z.literal("log"), contains: z.array(str).optional(), absent: z.array(str).optional(), since: Since.optional(), ...base }).strict(),
  /** structured event count: events of `type` whose fields match `where` (object ids are compared by card name) */
  z.object({ check: z.literal("events"), type: str, where: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(), count: Num.optional(), since: Since.optional(), ...base }).strict(),
  /** does the player have (exists: true) or lack (exists: false) this legal action right now */
  z.object({ check: z.literal("legal"), player: PlayerRef, action: z.enum(["cast", "playLand", "activate"]), card: str, ability: z.union([int.min(1), str]).optional(), free: z.boolean().optional(), exists: z.boolean(), ...base }).strict(),
  /** the engine reported no `unresolved` event (it can run everything the cards say). Without this check an unresolved event still turns the scenario into UNSUPPORTED. */
  z.object({ check: z.literal("noUnresolved"), ...base }).strict()
]);
export const Expectation = ExpectationBase.superRefine((o, ctx) => {
  const need = (ok: boolean, m: string) => { if (!ok) ctx.addIssue({ code: "custom", message: m }); };
  if (o.check === "zone") need(!!o.cards || o.count !== undefined, "give cards and/or count");
  if (o.check === "stack") need(!!o.items || o.count !== undefined || !!o.topFirst, "give items, count and/or topFirst");
  if (o.check === "log") need(!!o.contains || !!o.absent, "give contains and/or absent");
});
export type ExpectationSpec = z.infer<typeof ExpectationBase>;

// ---------------------------------------------------------------- actions
const Pay = z.union([z.literal("auto"), z.literal("pool"), z.object({ tap: z.array(str).min(1) }).strict()]);
const common = {
  label: str.optional(),
  /** decisions this action should run into, answered in order */
  answers: z.array(Answer).optional(),
  /** the engine must refuse this action with this error code (wrong_timing, illegal_target, cannot_pay, not_castable, not_your_priority, invalid_choice, cannot_activate, illegal_attack, illegal_block, land_limit, ...) */
  expectRejected: str.optional(),
  expect: z.array(Expectation).optional()
};
const Targets = z.array(z.union([str, z.array(str)]));
export const Action = z.discriminatedUnion("do", [
  z.object({ do: z.literal("cast"), player: PlayerRef, card: str, targets: Targets.optional(), modes: z.array(str).optional(), x: int.min(0).optional(), face: str.optional(), way: str.optional(), extras: z.array(str).optional(), pay: Pay.optional(), ...common }).strict(),
  z.object({ do: z.literal("activate"), player: PlayerRef, source: str, ability: z.union([int.min(1), str]), targets: Targets.optional(), x: int.min(0).optional(), color: ColorKey.optional(), pay: Pay.optional(), ...common }).strict(),
  z.object({ do: z.literal("tapForMana"), player: PlayerRef, permanent: str, color: ColorKey.optional(), ...common }).strict(),
  z.object({ do: z.literal("playLand"), player: PlayerRef, card: str, face: str.optional(), ...common }).strict(),
  z.object({ do: z.literal("unlockDoor"), player: PlayerRef, card: str, door: str, pay: Pay.optional(), ...common }).strict(),
  z.object({ do: z.literal("pass"), player: PlayerRef.optional(), times: int.min(1).max(50).optional(), ...common }).strict(),
  /** everyone passes priority until the stack is empty (or an unanswered decision is pending) */
  z.object({ do: z.literal("resolve"), ...common }).strict(),
  z.object({ do: z.literal("advance"), to: PhaseName, active: PlayerRef.optional(), ...common }).strict(),
  z.object({ do: z.literal("answer"), ...common, answers: z.array(Answer).min(1) }).strict(),
  z.object({ do: z.literal("declareAttackers"), player: PlayerRef, attackers: z.array(z.object({ creature: str, defender: str.optional() }).strict()), ...common }).strict(),
  z.object({ do: z.literal("declareBlockers"), player: PlayerRef, blocks: z.array(z.object({ blocker: str, attacker: str }).strict()), ...common }).strict(),
  /** put a card into a zone in the middle of the scenario (as if it had been there all along; triggers nothing) */
  z.object({ do: z.literal("put"), player: PlayerRef, zone: ZoneName, card: Entry, ...common }).strict()
]);
export type ActionSpec = z.infer<typeof Action>;

// ---------------------------------------------------------------- scenario / file
export const Scenario = z.object({
  name: str,
  description: z.string().optional(),
  players: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(2),
  active: PlayerRef.default("p1"),
  phase: PhaseName.default("precombat_main"),
  turnNumber: int.min(1).optional(),
  startingLife: int.optional(),
  setup: z.record(PlayerRef, PlayerSetup).default({}),
  /** players who pay by hand (a pay_mana decision opens; answer it, or use tapForMana) */
  manualPay: z.array(PlayerRef).optional(),
  seed: int.optional(),
  steps: z.array(Action).default([]),
  /** checked after the last step */
  expect: z.array(Expectation).default([]),
  /** this scenario is a documented engine bug: FAIL is the expected result (the wrapper turns green only while it still fails; it goes red when fixed so the spec can be promoted) */
  knownFailure: z.string().min(10).optional()
}).strict();
export type ScenarioSpec = z.infer<typeof Scenario>;

export const SpecFile = z.object({
  card: str,
  /** the deck whose drafts (data/kernel-drafts/<deck>) win when several decks draft the same card; the CLI's --deck overrides it */
  deck: str.optional(),
  /** other real cards this file exercises (so `--card <name>` finds it) */
  cards: z.array(str).optional(),
  /** draft = being written / under triage; accepted = a permanent regression test (src/kernel/spec/specs.test.ts runs it) */
  status: z.enum(["draft", "accepted"]),
  oracle: z.string().optional(),
  notes: z.string().optional(),
  scenarios: z.array(Scenario).min(1)
}).strict().superRefine((f, ctx) => {
  const seen = new Set<string>();
  f.scenarios.forEach((s, i) => { if (seen.has(s.name)) ctx.addIssue({ code: "custom", message: `duplicate scenario name "${s.name}"`, path: ["scenarios", i, "name"] }); seen.add(s.name); });
});
export type SpecFileSpec = z.infer<typeof SpecFile>;

/** "scenarios[2].steps[1].expect[0].why: Required" style message list */
export function formatZodError(e: z.ZodError): string[] {
  return e.issues.map((i) => `${i.path.map((p, n) => (typeof p === "number" ? `[${p}]` : n ? `.${p}` : p)).join("") || "(file)"}: ${i.message}`);
}
