import { describe, expect, it } from "vitest";
import type { GameSession, PlayerSeat, VisibleCard } from "../types";
import type { PendingRuleChoice } from "@/engine/types";
import { answerRefusal } from "./answerGuard";
import { INTENT_SPECS, GUEST_INTENT_NAMES, intentArity } from "./intentSpecs";
import { dispatchIntent, type IntentRegistry } from "./intentDispatch";
import type { PromptSlots } from "./seatPrompts";

const ME = "seat-b";
const OPP = "seat-a";

function card(id: string, typeLine = "Creature - Elf", extra: Partial<VisibleCard> = {}): VisibleCard {
  return { id, name: id, typeLine, oracleText: "", manaValue: 1, colors: [], role: "x", zone: "battlefield", ...extra } as VisibleCard;
}

function seat(id: string): PlayerSeat {
  return {
    id, name: id, kind: "human", life: 40, commanderDamage: {}, zones: { library: 3, hand: 3, battlefield: 3, graveyard: 2, exile: 0, command: 0 },
    library: [card(`${id}-l0`), card(`${id}-l1`), card(`${id}-l2`)],
    board: {
      hand: [card(`${id}-h0`, "Instant"), card(`${id}-h1`, "Instant"), card(`${id}-h2`, "Instant")],
      battlefield: [card(`${id}-c0`), card(`${id}-land`, "Basic Land - Forest"), card(`${id}-art`, "Artifact", { counters: [{ kind: "+1/+1", count: 1 }] as never })],
      graveyard: [card(`${id}-g0`, "Creature - Zombie"), card(`${id}-g1`, "Sorcery")],
      exile: []
    }
  } as unknown as PlayerSeat;
}

const session = { id: "s", seats: [seat(OPP), seat(ME)], events: [], stackSpellCardIds: ["seat-b-h2"] } as unknown as GameSession;

const rule = (choice: Record<string, unknown>) => ({ pendingRuleChoice: { id: "p1", controllerSeatId: ME, sourceCardId: "src", sourceCardName: "Src", prompt: "?", ...choice } as unknown as PendingRuleChoice });

interface Case { label: string; name: string; args: unknown[]; slots: PromptSlots; ok?: boolean }

const cases: Case[] = [
  // discard / put back / connive / return land / blink
  { label: "discard: opponent's card", name: "onCompleteDiscardChoice", args: [["seat-a-h0"]], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }) },
  { label: "discard: battlefield card", name: "onCompleteDiscardChoice", args: [["seat-b-c0"]], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }) },
  { label: "discard: spell on the stack", name: "onCompleteDiscardChoice", args: [["seat-b-h2"]], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }) },
  { label: "discard: duplicate ids", name: "onCompleteDiscardChoice", args: [["seat-b-h0", "seat-b-h0"]], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 2 }) },
  { label: "discard: nothing when one is owed", name: "onCompleteDiscardChoice", args: [[]], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }) },
  { label: "discard: too many", name: "onCompleteDiscardChoice", args: [["seat-b-h0", "seat-b-h1"]], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }) },
  { label: "discard: wrong prompt kind", name: "onCompleteDiscardChoice", args: [["seat-b-h0"]], slots: rule({ kind: "connive_discard", remainingAmount: 0 }) },
  { label: "discard: prompt owned by someone else", name: "onCompleteDiscardChoice", args: [["seat-b-h0"]], slots: { pendingRuleChoice: { ...rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }).pendingRuleChoice, controllerSeatId: OPP } as PendingRuleChoice } },
  { label: "discard: no prompt open", name: "onCompleteDiscardChoice", args: [["seat-b-h0"]], slots: {} },
  { label: "discard: valid", name: "onCompleteDiscardChoice", args: [["seat-b-h0"]], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }), ok: true },
  { label: "put back: skipped", name: "onCompletePutCardsOnLibrary", args: [[]], slots: rule({ kind: "put_cards_on_library", requiredCount: 2 }) },
  { label: "put back: opponent hand", name: "onCompletePutCardsOnLibrary", args: [["seat-a-h0", "seat-a-h1"]], slots: rule({ kind: "put_cards_on_library", requiredCount: 2 }) },
  { label: "put back: valid", name: "onCompletePutCardsOnLibrary", args: [["seat-b-h0", "seat-b-h1"]], slots: rule({ kind: "put_cards_on_library", requiredCount: 2 }), ok: true },
  { label: "connive: skip discard", name: "onCompleteConniveDiscard", args: [[]], slots: rule({ kind: "connive_discard", remainingAmount: 0 }) },
  { label: "connive: card not in hand", name: "onCompleteConniveDiscard", args: [["seat-b-c0"]], slots: rule({ kind: "connive_discard", remainingAmount: 0 }) },
  { label: "connive: valid", name: "onCompleteConniveDiscard", args: [["seat-b-h1"]], slots: rule({ kind: "connive_discard", remainingAmount: 0 }), ok: true },
  { label: "return land: skip", name: "onCompleteReturnLandToHand", args: [[]], slots: rule({ kind: "return_land_to_hand" }) },
  { label: "return land: opponent's land", name: "onCompleteReturnLandToHand", args: [["seat-a-land"]], slots: rule({ kind: "return_land_to_hand" }) },
  { label: "return land: non-land", name: "onCompleteReturnLandToHand", args: [["seat-b-c0"]], slots: rule({ kind: "return_land_to_hand" }) },
  { label: "return land: valid", name: "onCompleteReturnLandToHand", args: [["seat-b-land"]], slots: rule({ kind: "return_land_to_hand" }), ok: true },
  { label: "blink: opponent permanent", name: "onCompleteChoosePermanentToBlink", args: [["seat-a-c0"]], slots: rule({ kind: "choose_permanent_to_blink" }) },
  { label: "blink: the source itself", name: "onCompleteChoosePermanentToBlink", args: [["src"]], slots: rule({ kind: "choose_permanent_to_blink", sourceCardId: "seat-b-c0" }) },
  { label: "blink: two permanents", name: "onCompleteChoosePermanentToBlink", args: [["seat-b-c0", "seat-b-land"]], slots: rule({ kind: "choose_permanent_to_blink" }) },
  // modal / X / index answers
  { label: "X: index out of range", name: "onChooseModalOption", args: [26], slots: rule({ kind: "choose_cast_x", options: [{ value: 1, label: "" }, { value: 0, label: "" }], resume: {} }) },
  { label: "X: valid", name: "onChooseModalOption", args: [1], slots: rule({ kind: "choose_cast_x", options: [{ value: 1, label: "" }, { value: 0, label: "" }], resume: {} }), ok: true },
  { label: "modal: no modal prompt open (a discard)", name: "onChooseModalOption", args: [0], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }) },
  { label: "cast alt: index 7", name: "onChooseModalOption", args: [7], slots: rule({ kind: "choose_cast_alt", altLabel: "x", resume: {} }) },
  { label: "dig: index not offered", name: "onChooseModalOption", args: [9], slots: rule({ kind: "choose_dig_card", options: [{ index: 0, label: "", cardId: "x" }] }) },
  { label: "trigger option: index not offered", name: "onChooseModalOption", args: [5], slots: rule({ kind: "choose_trigger_option", options: [{ index: 0, label: "" }, { index: 1, label: "" }] }) },
  { label: "spell modes: out of range", name: "onChooseModalOption", args: [3], slots: rule({ kind: "choose_spell_modes", labels: ["a", "b"] }) },
  { label: "labeled target: out of range", name: "onChooseModalOption", args: [2], slots: rule({ kind: "choose_labeled_target", slotIndex: 0, slots: [{ prompt: "", options: [{ label: "", target: {} }, { label: "", target: {} }] }] }) },
  { label: "mode set: position out of range", name: "onChooseModalSet", args: [[0, 9]], slots: rule({ kind: "choose_cast_targets", promptKind: "modeset", options: [{ label: "a" }, { label: "b" }] }) },
  { label: "mode set: valid", name: "onChooseModalSet", args: [[0, 1]], slots: rule({ kind: "choose_cast_targets", promptKind: "modeset", options: [{ label: "a" }, { label: "b" }] }), ok: true },
  // targets / reanimation
  { label: "reanimate: non-creature card", name: "onChooseGraveyardReanimationTarget", args: [ME, "seat-b-g1"], slots: rule({ kind: "choose_creature_from_graveyards" }) },
  { label: "reanimate: card not in that graveyard", name: "onChooseGraveyardReanimationTarget", args: [OPP, "seat-b-g0"], slots: rule({ kind: "choose_creature_from_graveyards" }) },
  { label: "reanimate: opponent graveyard when restricted to yours", name: "onChooseGraveyardReanimationTarget", args: [OPP, "seat-a-g0"], slots: rule({ kind: "choose_creature_from_graveyards", restrictToYourGraveyard: true }) },
  { label: "reanimate: card from hand", name: "onChooseGraveyardReanimationTarget", args: [ME, "seat-b-h0"], slots: rule({ kind: "choose_creature_from_graveyards" }) },
  { label: "reanimate: valid (any graveyard)", name: "onChooseGraveyardReanimationTarget", args: [OPP, "seat-a-g0"], slots: rule({ kind: "choose_creature_from_graveyards" }), ok: true },
  { label: "trigger card pick: not offered", name: "onChooseGraveyardReanimationTarget", args: [OPP, "seat-a-g0"], slots: rule({ kind: "choose_trigger_card", cards: [{ seatId: ME, cardId: "seat-b-g0" }], picked: [] }) },
  { label: "trigger card pick: already picked", name: "onChooseBattlefieldCreatureTarget", args: [ME, "seat-b-c0"], slots: rule({ kind: "choose_trigger_card", cards: [{ seatId: ME, cardId: "seat-b-c0" }], picked: ["seat-b-c0"] }) },
  { label: "ability card target: not offered", name: "onChooseGraveyardReanimationTarget", args: [ME, "seat-b-g0"], slots: rule({ kind: "choose_ability_card_target", cards: [{ seatId: ME, cardId: "seat-b-g1" }], activation: {} }) },
  { label: "counter on creature: opponent's when restricted to yours", name: "onChooseBattlefieldCreatureTarget", args: [OPP, "seat-a-c0"], slots: rule({ kind: "choose_creature_on_battlefield", counterKind: "+1/+1", amount: 1, restrictToYourControl: true }) },
  { label: "counter on creature: a non-creature", name: "onChooseBattlefieldCreatureTarget", args: [ME, "seat-b-art"], slots: rule({ kind: "choose_creature_on_battlefield", counterKind: "+1/+1", amount: 1, restrictToYourControl: false }) },
  { label: "counter on creature: card from the wrong seat", name: "onChooseBattlefieldCreatureTarget", args: [ME, "seat-a-c0"], slots: rule({ kind: "choose_creature_on_battlefield", counterKind: "+1/+1", amount: 1, restrictToYourControl: false }) },
  { label: "aura: unknown card", name: "onChooseAuraRetarget", args: [OPP, "nope"], slots: rule({ kind: "choose_aura_attach_target", restrictToYourControl: false }) },
  { label: "aura: opponent's when restricted", name: "onChooseAuraRetarget", args: [OPP, "seat-a-c0"], slots: rule({ kind: "choose_aura_attach_target", restrictToYourControl: true }) },
  { label: "equip: opponent's creature", name: "onChooseEquipTarget", args: ["seat-a-c0"], slots: rule({ kind: "choose_equip_target", cost: 1 }) },
  { label: "equip: own non-creature", name: "onChooseEquipTarget", args: ["seat-b-land"], slots: rule({ kind: "choose_equip_target", cost: 1 }) },
  { label: "proliferate: permanent without counters", name: "onConfirmProliferateTargets", args: [["seat-b-c0"], []], slots: rule({ kind: "choose_proliferate_targets" }) },
  { label: "proliferate: unknown player", name: "onConfirmProliferateTargets", args: [[], ["seat-z"]], slots: rule({ kind: "choose_proliferate_targets" }) },
  { label: "sacrifice cost: already picked", name: "onChooseSacrificeCostTarget", args: [ME, "seat-b-c0"], slots: rule({ kind: "choose_creature_to_sacrifice", pickedIds: ["seat-b-c0"] }) },
  { label: "creature type: junk", name: "onChooseCreatureType", args: ["<script>"], slots: rule({ kind: "choose_creature_type" }) },
  { label: "creature type: no such prompt", name: "onChooseCreatureType", args: ["Elf"], slots: rule({ kind: "choose_color" }) },
  { label: "colour: no such prompt", name: "onChooseColor", args: ["R"], slots: {} },
  { label: "attack mana: colourless key", name: "onConfirmAttackTriggerManaColors", args: [{ C: 2 }], slots: rule({ kind: "distribute_attack_trigger_mana", amount: 2 }) },
  { label: "next trigger: not offered", name: "onChooseNextTrigger", args: ["x"], slots: rule({ kind: "order_triggers", triggers: [{ sourceCardId: "a", sourceCardName: "", text: "" }], orderedTriggers: [] }) },
  // library look: tutor through scry / surveil buttons
  { label: "look: keep a library card that is not being looked at", name: "onKeepLibraryLookCardOnTop", args: ["seat-b-l2"], slots: { libraryLook: { seatId: ME, mode: "surveil", cards: [card("seat-b-l0")], remaining: 1 } } },
  { label: "look: bin a card that is not being looked at (reanimator tutor)", name: "onPutLibraryLookCardInGraveyard", args: ["seat-b-l2"], slots: { libraryLook: { seatId: ME, mode: "surveil", cards: [card("seat-b-l0")], remaining: 1 } } },
  { label: "look: bottom a card not shown", name: "onPutLibraryLookCardOnBottom", args: ["seat-b-l1"], slots: { libraryLook: { seatId: ME, mode: "scry", cards: [card("seat-b-l0")], remaining: 1 } } },
  { label: "look: graveyard button during scry", name: "onPutLibraryLookCardInGraveyard", args: ["seat-b-l0"], slots: { libraryLook: { seatId: ME, mode: "scry", cards: [card("seat-b-l0")], remaining: 1 } } },
  { label: "look: take to hand while only scrying", name: "onSendLibraryLookCardToHand", args: ["seat-b-l0"], slots: { libraryLook: { seatId: ME, mode: "scry", cards: [card("seat-b-l0")], remaining: 1 } } },
  { label: "look: no look open", name: "onKeepLibraryLookCardOnTop", args: ["seat-b-l0"], slots: {} },
  { label: "look: valid bottom", name: "onPutLibraryLookCardOnBottom", args: ["seat-b-l0"], slots: { libraryLook: { seatId: ME, mode: "scry", cards: [card("seat-b-l0")], remaining: 1 } }, ok: true },
  { label: "look: valid graveyard", name: "onPutLibraryLookCardInGraveyard", args: ["seat-b-l0"], slots: { libraryLook: { seatId: ME, mode: "surveil", cards: [card("seat-b-l0")], remaining: 1 } }, ok: true },
  // mana colour box
  { label: "mana: colour not offered", name: "onChooseMana", args: ["R"], slots: { manaChoice: { seatId: ME, cardId: "x", cardName: "x", location: "battlefield", choices: ["G", "C"] } } },
  { label: "mana: no box open", name: "onChooseMana", args: ["G"], slots: {} },
  { label: "mana: valid", name: "onChooseMana", args: ["G"], slots: { manaChoice: { seatId: ME, cardId: "x", cardName: "x", location: "battlefield", choices: ["G", "C"] } }, ok: true },
  // misc searches
  { label: "myriad search: three lands", name: "onCompleteMyriadSearch", args: [["a", "b", "c"]], slots: { myriadSearch: { seatId: ME, sourceCardId: "x" } } },
  { label: "myriad search: same land twice", name: "onCompleteMyriadSearch", args: [["a", "a"]], slots: { myriadSearch: { seatId: ME, sourceCardId: "x" } } },
  { label: "library search: a non-search prompt is open", name: "onSearchLibraryCardToHand", args: ["seat-b-l0", "hand"], slots: rule({ kind: "discard_to_hand_size", requiredDiscards: 1 }) },
  { label: "library search: nothing open", name: "onSearchLibraryCardToHand", args: ["seat-b-l0", "hand"], slots: {} },
  { label: "miracle answer without an offer", name: "onAcceptMiracle", args: [0], slots: {} }
];

describe("answerRefusal: a friend's answer must match the prompt that is actually open", () => {
  for (const c of cases) {
    it(`${c.ok ? "accepts" : "refuses"}: ${c.label}`, () => {
      const result = answerRefusal(c.name, ME, c.args, { session, slots: c.slots });
      if (c.ok) expect(result).toBeUndefined();
      else expect(typeof result).toBe("string");
    });
  }

  it("the check never mutates the session or the prompt slots", () => {
    const before = JSON.stringify(session);
    const slots = rule({ kind: "discard_to_hand_size", requiredDiscards: 1 });
    const slotsBefore = JSON.stringify(slots);
    answerRefusal("onCompleteDiscardChoice", ME, [["seat-a-h0"]], { session, slots });
    expect(JSON.stringify(session)).toBe(before);
    expect(JSON.stringify(slots)).toBe(slotsBefore);
  });
});

describe("schema-level hostile arguments", () => {
  const hostile: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, "x".repeat(5000), Array.from({ length: 1000 }, (_, i) => `id${i}`)];

  it("every argument of every guest intent rejects NaN, Infinity, an oversize string and an oversize list", () => {
    for (const name of GUEST_INTENT_NAMES) {
      const arity = intentArity(name);
      for (let index = 0; index < arity; index += 1) {
        for (const bad of hostile) {
          const args: unknown[] = Array.from({ length: arity }, () => "ok");
          args[index] = bad;
          const parsed = (INTENT_SPECS[name].schema as { safeParse: (v: unknown) => { success: boolean } }).safeParse(args);
          expect(parsed.success, `${name} arg ${index} accepted ${typeof bad}`).toBe(false);
        }
      }
    }
  });

  it("an intent name from the prototype chain is unknown, never a handler", () => {
    const registry: IntentRegistry = { onKeepHand: { schema: INTENT_SPECS.onKeepHand.schema as never, call: () => undefined } };
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(dispatchIntent(registry, { fromSeatId: "guest-1", name, args: [], clientSeq: 1 }, () => ME)).toEqual({ ok: false, reason: `unknown intent ${name}` });
    }
  });

  it("a handler that throws costs the sender that action, not the host's queue", () => {
    const registry: IntentRegistry = { onKeepHand: { schema: INTENT_SPECS.onKeepHand.schema as never, call: () => { throw new Error("boom"); } } };
    const result = dispatchIntent(registry, { fromSeatId: "guest-1", name: "onKeepHand", args: [], clientSeq: 1 }, () => ME);
    expect(result.ok).toBe(false);
  });

  it("a phase stop only accepts a real turn phase (no unbounded settings keys)", () => {
    const schema = INTENT_SPECS.onTogglePhaseStop.schema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse(["upkeep step", 1]).success).toBe(true);
    expect(schema.safeParse(["__proto__", 1]).success).toBe(false);
    expect(schema.safeParse(["made up phase", 1]).success).toBe(false);
  });

  it("a seat id inside args must equal the sender's seat for every own-seat intent", () => {
    for (const name of GUEST_INTENT_NAMES) {
      const spec = INTENT_SPECS[name] as { seatArgs?: number[] };
      expect(spec.seatArgs === undefined || spec.seatArgs.every((i) => i === 0)).toBe(true);
    }
  });
});
