import { describe, expect, it } from "vitest";
import { dispatchIntent } from "@/lib/multiplayer/intentDispatch";
import { GUEST_INTENT_NAMES, INTENT_SPECS, checkIntentWhen, type IntentGameState, type IntentWhen } from "@/lib/multiplayer/intentSpecs";
import { buildMpIntentRegistry } from "./mpIntents";

const S = "seat-b";
const POS = { x: 1, z: 2 };
// One valid argument list per intent (own seat id wherever the spec says so).
const SAMPLE: Record<string, unknown[]> = {
  onKeepHand: [], onMulligan: [], onToggleMulliganReturnCard: ["c1"],
  onPassPriority: [], onAdvanceTurn: [], onEndTurn: [],
  onPlayCard: [S, "c1", POS, "hand"], onPlayCardFace: [S, "c1", 1], onCycleCard: [S, "c1"], onCastFromExile: [S, "c1"], onCastFromGraveyard: [S, "c1"],
  onActivateGraveyardAbility: [S, "c1"], onCastCommander: [S, POS], onUnlockRoomDoor: [S, "c1", 0], onRespondWithSelectedCard: ["c1", "hand"],
  onTapForMana: [S, "c1"], onToggleTapCard: [S, "c1", "battlefield"], onClickPermanent: ["c1"],
  onActivateSacrificeAbility: [S, "c1", 0], onActivateTapAbility: [S, "c1", 0], onActivateSelfUntap: [S, "c1", 0], onActivateGenericMana: [S, "c1", 0],
  onActivateEquip: [S, "c1"], onActivateManlandAnimation: [S, "c1"], onActivateLoyalty: [S, "c1", -2, "text"], onResolveMyriadLandscape: [S, "c1"], onResolveBasicLandFetch: [S, "c1"],
  onDrawCard: [S], onShuffleLibrary: [S], onChangeLife: [S, -1], onChangeCounter: [S, "c1", "+1/+1", 1],
  onMoveCardToGraveyard: [S, "c1"], onMoveCardToExile: [S, "c1"], onMoveCardToHand: [S, "c1"], onMoveBattlefieldCard: [S, "c1", POS], onOpenLibrarySearch: [],
  onToggleFullControl: [], onStopNext: [], onTogglePhaseStop: ["declare blockers step", 2], onToggleStopOnStackResponse: [], onToggleStopOnAttacked: [], onToggleStopOnTargeted: [], onToggleStopOnChoicePrompt: [], onToggleYield: [],
  onDeclareAttack: ["c1", "seat-a"], onConfirmBlockers: [["bf1"]], onPassBlocks: [],
  onChooseMana: ["G"], onCancelManaChoice: [], onChooseMyriadTapMana: [], onChooseMyriadTapSearch: [], onCancelMyriadTapChoice: [], onCloseMyriadSearch: [],
  onCompleteMyriadSearch: [["c1"]], onCloseBasicLandFetchSearch: [], onCompleteBasicLandFetchSearch: ["c1"], onCloseLibrarySearch: [], onSearchLibraryCardToHand: ["c1", "hand"],
  onFinishLibrarySearch: [], onSacrificeRuleSource: [], onPayCumulativeUpkeep: [], onAcceptMiracle: [0], onDeclineMiracle: [], onAcceptOptionalTrigger: [], onDeclineOptionalTrigger: [],
  onAcceptCommanderZoneChoice: [], onDeclineCommanderZoneChoice: [], onCompleteDiscardChoice: [["c1"]], onCompletePutCardsOnLibrary: [["c1"]], onCompleteConniveDiscard: [["c1"]],
  onCompleteReturnLandToHand: [["c1"]], onCompleteChoosePermanentToBlink: [["c1"]], onChooseCreatureType: ["Elf"], onChooseColor: ["U"], onConfirmAttackTriggerManaColors: [{ R: 2 }],
  onChooseGraveyardReanimationTarget: ["seat-a", "c1"], onChooseSacrificeCostTarget: [S, "c1"], onChooseEachPlayerSacrifice: [S, "c1"], onChooseCreatureToSacrificeForCast: [S, "c1"],
  onChooseModalOption: [1], onChooseEffectTarget: [{ kind: "card", seatId: "seat-a", cardId: "c1" }], onDeclineEffectTarget: [], onConfirmProliferateTargets: [["c1"], ["seat-a"]],
  onChooseBattlefieldCreatureTarget: ["seat-a", "c1"], onChooseAuraRetarget: ["seat-a", "c1"], onChooseEquipTarget: ["c1"], onChooseNextTrigger: ["c1"],
  onKeepLibraryLookCardOnTop: ["c1"], onOrderLibraryLookCardOnTop: ["c1"], onPutLibraryLookCardOnBottom: ["c1"], onPutLibraryLookCardInGraveyard: ["c1"],
  onSendLibraryLookCardToHand: ["c1"], onRepeatVaultLook: [], onKeepVaultLookCards: [], onCloseLibraryLook: []
};

// A state in which `when` is satisfied for seat-b.
function stateFor(when: IntentWhen): IntentGameState {
  const base: IntentGameState = { gameStage: "playing", activeSeatId: S, prioritySeatId: S, hasPendingAction: false, phase: "declare attackers step", owners: {}, hasKept: () => false, battlefieldIds: () => ["bf1", "bf2"] };
  switch (when) {
    case "mulligan": return { ...base, gameStage: "mulligan" };
    case "priority": return { ...base, hasPendingAction: true };
    case "answerRule": return { ...base, owners: { rule: S } };
    case "answerLook": return { ...base, owners: { look: S } };
    case "answerBlock": return { ...base, owners: { block: S }, activeSeatId: "seat-a" };
    case "answerMana": return { ...base, owners: { mana: S } };
    case "answerMyriadTap": return { ...base, owners: { myriadTap: S } };
    case "answerMyriadSearch": return { ...base, owners: { myriadSearch: S } };
    case "answerBasicLand": return { ...base, owners: { basicLand: S } };
    case "answerManualSearch": return { ...base, owners: { manualSearch: S } };
    case "answerRuleOrManualSearch": return { ...base, owners: { manualSearch: S } };
    default: return base;
  }
}

function run(name: string, args: unknown[], state: IntentGameState, seat = S) {
  const calls: unknown[][] = [];
  const handlers = new Proxy({}, { get: (_t, key) => (...a: unknown[]) => void calls.push([String(key), ...a]) });
  const registry = buildMpIntentRegistry({ handlers: handlers as never, state });
  const result = dispatchIntent(registry, { fromSeatId: "guest-1", name, args, clientSeq: 1 }, () => seat);
  return { result, calls };
}

describe("every guest intent in the registry", () => {
  it("has a sample, and runs a handler in its own state", () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...GUEST_INTENT_NAMES].sort());
    for (const name of GUEST_INTENT_NAMES) {
      const { result, calls } = run(name, SAMPLE[name], stateFor(INTENT_SPECS[name].when));
      expect(result, name).toEqual({ ok: true });
      expect(calls.length, name).toBe(1);
    }
  });

  it("refuses a seat id argument that is not the sender's seat", () => {
    for (const name of GUEST_INTENT_NAMES) {
      const spec = INTENT_SPECS[name] as { seatArgs?: number[]; when: IntentWhen };
      for (const index of spec.seatArgs ?? []) {
        const args = [...SAMPLE[name]];
        args[index] = "seat-a";
        const { result, calls } = run(name, args, stateFor(spec.when));
        expect(result.ok, name).toBe(false);
        expect(calls, name).toEqual([]);
      }
    }
  });

  it("survives JSON: skipped optional args arrive as null and short arrays are padded", () => {
    const viaJson = JSON.parse(JSON.stringify([S, "c1", undefined, "library"]));
    expect(viaJson[2]).toBeNull();
    expect(run("onPlayCard", viaJson, stateFor("act")).calls).toEqual([["playCard", S, "c1", undefined, "library"]]);
    expect(run("onPlayCard", [S, "c1"], stateFor("act")).result).toEqual({ ok: true });
    expect(run("onCastCommander", [S], stateFor("act")).calls).toEqual([["castCommander", S, undefined]]);
  });

  it("rejects malformed args (wrong types, huge lists, extra keys)", () => {
    const s = stateFor("act");
    expect(run("onPlayCard", [S, 5], s).result.ok).toBe(false);
    expect(run("onChangeLife", [S, 10_000], s).result.ok).toBe(false);
    expect(run("onPlayCard", [S, "c1", { x: 1, z: 1, evil: true }], s).result.ok).toBe(false);
    expect(run("onCompleteDiscardChoice", [Array(500).fill("x")], stateFor("answerRule")).result.ok).toBe(false);
    expect(run("onChooseEffectTarget", [{ kind: "card", seatId: "a" }], stateFor("answerRule")).result.ok).toBe(false);
  });
});

describe("state checks (checkIntentWhen)", () => {
  it("priority intents need the stack and priority", () => {
    expect(run("onPassPriority", [], { ...stateFor("priority"), prioritySeatId: "seat-a" }).result).toMatchObject({ ok: false });
    expect(run("onPassPriority", [], { ...stateFor("priority"), hasPendingAction: false }).result).toMatchObject({ ok: false });
  });
  it("turn intents need your own turn, an empty stack and no prompt; attack needs the declare attackers step", () => {
    expect(run("onAdvanceTurn", [], { ...stateFor("turnIdle"), activeSeatId: "seat-a" }).result.ok).toBe(false);
    expect(run("onEndTurn", [], { ...stateFor("turnIdle"), hasPendingAction: true }).result.ok).toBe(false);
    expect(run("onEndTurn", [], { ...stateFor("turnIdle"), owners: { rule: S } }).result.ok).toBe(false);
    expect(run("onDeclareAttack", ["c1", "seat-a"], { ...stateFor("attack"), phase: "precombat main phase" }).result.ok).toBe(false);
  });
  it("prompt answers need the prompt to be addressed to the sender (and never another seat's)", () => {
    expect(run("onChooseModalOption", [0], { ...stateFor("answerRule"), owners: { rule: "seat-a" } }).result.ok).toBe(false);
    expect(run("onChooseModalOption", [0], stateFor("act")).result.ok).toBe(false);
    expect(run("onCloseLibraryLook", [], { ...stateFor("answerLook"), owners: { look: "seat-a" } }).result.ok).toBe(false);
  });
  it("actions are refused while ANOTHER seat answers a prompt, but allowed while one's own prompt is open", () => {
    expect(run("onPlayCard", [S, "c1"], { ...stateFor("act"), owners: { rule: "seat-a" } }).result.ok).toBe(false);
    expect(run("onTapForMana", [S, "c1"], { ...stateFor("act"), owners: { rule: S } }).result.ok).toBe(true);
  });
  it("blockers must be the defender's own creatures", () => {
    expect(run("onConfirmBlockers", [["bf1", "stranger"]], stateFor("answerBlock")).result.ok).toBe(false);
    expect(run("onConfirmBlockers", [["bf1", "bf2"]], stateFor("answerBlock")).calls).toEqual([["confirmBlockersFor", ["bf1", "bf2"]]]);
  });
  it("nothing runs while the game is paused for a disconnected friend, or before it starts", () => {
    expect(run("onPlayCard", [S, "c1"], { ...stateFor("act"), paused: true }).result).toMatchObject({ ok: false });
    expect(checkIntentWhen("act", S, { ...stateFor("act"), gameStage: "mulligan" })).toMatch(/not started/);
    expect(run("onKeepHand", [], { ...stateFor("mulligan"), hasKept: () => true }).result.ok).toBe(false);
  });
  it("the friend's stop controls change THEIR seat's settings, work while a prompt is open or paused, and reject bad args", () => {
    expect(run("onToggleFullControl", [], stateFor("settings")).calls).toEqual([["updateSeatStops", S, { kind: "fullControl" }]]);
    expect(run("onTogglePhaseStop", ["end step", 0], stateFor("settings")).calls).toEqual([["updateSeatStops", S, { kind: "phase", phase: "end step", seatIndex: 0 }]]);
    expect(run("onStopNext", [], { ...stateFor("settings"), owners: { rule: "seat-a" }, paused: true }).result.ok).toBe(true);
    expect(run("onStopNext", [], { ...stateFor("settings"), gameStage: "mulligan" }).result.ok).toBe(false);
    expect(run("onTogglePhaseStop", ["end step", -1], stateFor("settings")).result.ok).toBe(false);
    expect(run("onTogglePhaseStop", [5, 0], stateFor("settings")).result.ok).toBe(false);
  });
  it("calls the handlers with the sender's seat", () => {
    expect(run("onEndTurn", [], stateFor("turnIdle")).calls).toEqual([["endTurn", S]]);
    expect(run("onDeclareAttack", ["c1", "seat-a"], stateFor("attack")).calls).toEqual([["declareHumanAttack", "c1", "seat-a", S]]);
    expect(run("onRespondWithSelectedCard", ["c1", "exile"], stateFor("priority")).calls).toEqual([["respondWithCard", "c1", "exile", undefined, undefined, undefined, S]]);
    expect(run("onPassPriority", [], stateFor("priority")).calls).toEqual([["passPriority"]]);
  });
});

describe("yield intent", () => {
  it("a friend's onToggleYield toggles only the sender's seat, works while a prompt is open or paused, and takes no args", () => {
    expect(run("onToggleYield", [], stateFor("settings")).calls).toEqual([["toggleSeatYield", S]]);
    expect(run("onToggleYield", [], { ...stateFor("settings"), owners: { rule: "seat-a" }, paused: true }).result.ok).toBe(true);
    expect(run("onToggleYield", [], { ...stateFor("settings"), gameStage: "mulligan" }).result.ok).toBe(false);
  });
});
