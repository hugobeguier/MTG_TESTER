// What a seated friend may ask the host to do, as data: wire name (= the table's `on*` callback name) -> zod args + which game states allow it. Pure and
// shared by BOTH sides: the guest's intent proxy (intentProxy.ts) takes the arity from the schema so only the declared args are ever sent (a click event
// object never goes on the wire), and the host's registry (components/game/mpIntents.ts) uses the same schema + `when` check before it calls a handler.
//
// Security model (unchanged): the acting seat is the sender's seat from the slot map, never an arg. A seat id that appears in args (`seatArgs`) must EQUAL
// the acting seat, so a friend can only touch their own cards/life/library. Ids of cards are validated by the engine handlers themselves (they look the
// card up in the acting seat's zones and no-op when it is not there).
import { z, type ZodTypeAny } from "zod";

const id = z.string().min(1).max(200);
const seatId = id;
const faceIndex = z.number().int().min(0).max(9);
const position = z.object({ x: z.number().finite(), z: z.number().finite() }).strict();
const manaColor = z.enum(["W", "U", "B", "R", "G", "C"]);
const idList = z.array(id).max(200);

/** Zod tuple that also accepts a SHORTER array (trailing optional args that JSON dropped) by padding with undefined. */
function tup(...items: ZodTypeAny[]) {
  return z.preprocess((value) => (Array.isArray(value) && value.length < items.length ? [...value, ...Array.from({ length: items.length - value.length }, () => undefined)] : value), z.tuple(items as [ZodTypeAny, ...ZodTypeAny[]]));
}
const none = z.tuple([]);

/** In which game states an intent is accepted. */
export type IntentWhen =
  | "mulligan" // opening-hand step, seat has not kept yet
  | "act" // playing, and no prompt belonging to ANOTHER seat is open (a seat's own prompt may still be open: it can tap mana to pay, ...)
  | "priority" // playing, something is on the stack and this seat holds priority
  | "turnIdle" // playing, it is this seat's turn, the stack is empty and no prompt is open
  | "attack" // turnIdle + the declare attackers step
  | "settings" // playing: the friend's own priority-stop controls (allowed at any moment, also while a prompt is open)
  | "answerRule" // this seat owns the open pendingRuleChoice
  | "answerLook" // ... the open library look
  | "answerBlock" // ... the open block choice (the defending seat)
  | "answerMana" // ... the open mana colour choice
  | "answerMyriadTap"
  | "answerMyriadSearch"
  | "answerBasicLand"
  | "answerManualSearch" // the manual "Search Library" box
  | "answerRuleOrManualSearch";

export interface IntentSpec {
  schema: ZodTypeAny;
  /** Indices of args that carry a seat id which must equal the acting seat. */
  seatArgs?: number[];
  when: IntentWhen;
}

const own = (...items: ZodTypeAny[]): Pick<IntentSpec, "schema" | "seatArgs"> => ({ schema: tup(...items), seatArgs: [0] });
const plain = (...items: ZodTypeAny[]): Pick<IntentSpec, "schema"> => ({ schema: tup(...items) });

const zoneForPlay = z.enum(["hand", "command", "exile", "graveyard", "library"]);
const effectTarget = z.union([z.object({ kind: z.literal("card"), seatId, cardId: id }).strict(), z.object({ kind: z.literal("player"), seatId }).strict()]);
const manaDistribution = z.record(z.string().max(2), z.number().int().min(0).max(1000));
const smallText = z.string().max(2000);

export const INTENT_SPECS = {
  // opening hand
  onKeepHand: { schema: none, when: "mulligan" },
  onMulligan: { schema: none, when: "mulligan" },
  onToggleMulliganReturnCard: { schema: tup(id), when: "mulligan" },
  // turn flow
  onPassPriority: { schema: none, when: "priority" },
  onAdvanceTurn: { schema: none, when: "turnIdle" },
  onEndTurn: { schema: none, when: "turnIdle" },
  // casting, playing, zones
  onPlayCard: { ...own(seatId, id, position.optional(), zoneForPlay.optional()), when: "act" },
  onPlayCardFace: { ...own(seatId, id, faceIndex), when: "act" },
  onCycleCard: { ...own(seatId, id), when: "act" },
  onCastFromExile: { ...own(seatId, id), when: "act" },
  onCastFromGraveyard: { ...own(seatId, id), when: "act" },
  onActivateGraveyardAbility: { ...own(seatId, id), when: "act" },
  onCastCommander: { ...own(seatId, position.optional()), when: "act" },
  onUnlockRoomDoor: { ...own(seatId, id, faceIndex), when: "act" },
  /** Wire-only (the table's button has no args): respond to the stack with the selected hand card. */
  onRespondWithSelectedCard: { ...plain(id, z.enum(["hand", "exile"]).optional()), when: "priority" },
  // mana and permanents
  onTapForMana: { ...own(seatId, id), when: "act" },
  onToggleTapCard: { ...own(seatId, id, z.enum(["battlefield", "command"])), when: "act" },
  /** Wire-only: a click on one of the friend's own permanents that is a one-click mana source (their table decided locally that it is a tap, not an inspect). */
  onClickPermanent: { ...plain(id), when: "act" },
  onActivateSacrificeAbility: { ...own(seatId, id, z.number().int().min(0).max(20)), when: "act" },
  onActivateTapAbility: { ...own(seatId, id, z.number().int().min(0).max(20)), when: "act" },
  onActivateScriptedAbility: { ...own(seatId, id, z.string().min(1).max(60)), when: "act" },
  onActivateSelfUntap: { ...own(seatId, id, z.number().int().min(0).max(20)), when: "act" },
  onActivateGenericMana: { ...own(seatId, id, z.number().int().min(0).max(20)), when: "act" },
  onActivateEquip: { ...own(seatId, id), when: "act" },
  onActivateManlandAnimation: { ...own(seatId, id), when: "act" },
  onActivateLoyalty: { ...own(seatId, id, z.number().int().min(-50).max(50), smallText), when: "act" },
  onResolveMyriadLandscape: { ...own(seatId, id), when: "act" },
  onResolveBasicLandFetch: { ...own(seatId, id), when: "act" },
  // manual controls the host has
  onDrawCard: { ...own(seatId), when: "act" },
  onShuffleLibrary: { ...own(seatId), when: "act" },
  onChangeLife: { ...own(seatId, z.number().int().min(-100).max(100)), when: "act" },
  onChangeCounter: { ...own(seatId, id, z.string().min(1).max(40), z.number().int().min(-20).max(20)), when: "act" },
  onMoveCardToGraveyard: { ...own(seatId, id), when: "act" },
  onMoveCardToExile: { ...own(seatId, id), when: "act" },
  onMoveCardToHand: { ...own(seatId, id), when: "act" },
  onMoveBattlefieldCard: { ...own(z.string().min(1).max(200), id, position), when: "act" },
  onOpenLibrarySearch: { schema: none, when: "act" },
  // the friend's OWN priority-stop controls (same ones the host's table has; they change only the friend's seat settings)
  onToggleFullControl: { schema: none, when: "settings" },
  onStopNext: { schema: none, when: "settings" },
  onTogglePhaseStop: { schema: tup(z.string().min(1).max(60), z.number().int().min(0).max(9)), when: "settings" },
  onToggleStopOnStackResponse: { schema: none, when: "settings" },
  onToggleStopOnAttacked: { schema: none, when: "settings" },
  onToggleStopOnTargeted: { schema: none, when: "settings" },
  onToggleStopOnChoicePrompt: { schema: none, when: "settings" },
  /** "Yield until end of turn" (Shift+Space) for the friend's own seat: the host auto-passes that seat's priority windows for the rest of the turn (engine/yieldPolicy.ts). */
  onToggleYield: { schema: none, when: "settings" },
  // combat
  onDeclareAttack: { ...plain(id, id), when: "attack" },
  onConfirmBlockers: { ...plain(idList), when: "answerBlock" },
  onPassBlocks: { schema: none, when: "answerBlock" },
  // prompts addressed to this seat
  onChooseMana: { ...plain(manaColor), when: "answerMana" },
  onCancelManaChoice: { schema: none, when: "answerMana" },
  onChooseMyriadTapMana: { schema: none, when: "answerMyriadTap" },
  onChooseMyriadTapSearch: { schema: none, when: "answerMyriadTap" },
  onCancelMyriadTapChoice: { schema: none, when: "answerMyriadTap" },
  onCloseMyriadSearch: { schema: none, when: "answerMyriadSearch" },
  onCompleteMyriadSearch: { ...plain(idList), when: "answerMyriadSearch" },
  onCloseBasicLandFetchSearch: { schema: none, when: "answerBasicLand" },
  onCompleteBasicLandFetchSearch: { ...plain(id), when: "answerBasicLand" },
  onCloseLibrarySearch: { schema: none, when: "answerRuleOrManualSearch" },
  onSearchLibraryCardToHand: { ...plain(id, z.enum(["hand", "graveyard", "battlefield"]).optional()), when: "answerRuleOrManualSearch" },
  onFinishLibrarySearch: { schema: none, when: "answerRule" },
  onSacrificeRuleSource: { schema: none, when: "answerRule" },
  onPayCumulativeUpkeep: { schema: none, when: "answerRule" },
  onAcceptMiracle: { ...plain(faceIndex.optional()), when: "answerRule" },
  onDeclineMiracle: { schema: none, when: "answerRule" },
  onAcceptOptionalTrigger: { schema: none, when: "answerRule" },
  onDeclineOptionalTrigger: { schema: none, when: "answerRule" },
  onAcceptCommanderZoneChoice: { schema: none, when: "answerRule" },
  onDeclineCommanderZoneChoice: { schema: none, when: "answerRule" },
  onCompleteDiscardChoice: { ...plain(idList), when: "answerRule" },
  onCompletePutCardsOnLibrary: { ...plain(idList), when: "answerRule" },
  onCompleteConniveDiscard: { ...plain(idList), when: "answerRule" },
  onCompleteReturnLandToHand: { ...plain(idList), when: "answerRule" },
  onCompleteChoosePermanentToBlink: { ...plain(idList), when: "answerRule" },
  onChooseCreatureType: { ...plain(z.string().min(1).max(60)), when: "answerRule" },
  onChooseColor: { ...plain(manaColor), when: "answerRule" },
  onConfirmAttackTriggerManaColors: { ...plain(manaDistribution), when: "answerRule" },
  onChooseGraveyardReanimationTarget: { ...plain(seatId, id), when: "answerRule" },
  onChooseSacrificeCostTarget: { ...own(seatId, id), when: "answerRule" },
  onChooseEachPlayerSacrifice: { ...own(seatId, id), when: "answerRule" },
  onChooseCreatureToSacrificeForCast: { ...own(seatId, id), when: "answerRule" },
  onChooseModalOption: { ...plain(z.number().int().min(0).max(50)), when: "answerRule" },
  onChooseEffectTarget: { ...plain(effectTarget), when: "answerRule" },
  onDeclineEffectTarget: { schema: none, when: "answerRule" },
  onConfirmProliferateTargets: { ...plain(idList, idList), when: "answerRule" },
  onChooseBattlefieldCreatureTarget: { ...plain(seatId, id), when: "answerRule" },
  onChooseAuraRetarget: { ...plain(seatId, id), when: "answerRule" },
  onChooseEquipTarget: { ...plain(id), when: "answerRule" },
  onChooseNextTrigger: { ...plain(id), when: "answerRule" },
  onKeepLibraryLookCardOnTop: { ...plain(id), when: "answerLook" },
  onOrderLibraryLookCardOnTop: { ...plain(id), when: "answerLook" },
  onPutLibraryLookCardOnBottom: { ...plain(id), when: "answerLook" },
  onPutLibraryLookCardInGraveyard: { ...plain(id), when: "answerLook" },
  onSendLibraryLookCardToHand: { ...plain(id), when: "answerLook" },
  onRepeatVaultLook: { schema: none, when: "answerLook" },
  onKeepVaultLookCards: { schema: none, when: "answerLook" },
  onCloseLibraryLook: { schema: none, when: "answerLook" }
} satisfies Record<string, IntentSpec>;

export type GuestIntentName = keyof typeof INTENT_SPECS;
export const GUEST_INTENT_NAMES = Object.keys(INTENT_SPECS) as GuestIntentName[];

/** How many args an intent carries (the guest sends exactly that many; extra ones the table passes, like a click event, are dropped). */
export function intentArity(name: string): number {
  const spec = (INTENT_SPECS as Record<string, IntentSpec>)[name];
  if (!spec) return 0;
  // tup() wraps the tuple in a preprocess effect; a plain z.tuple([]) is the other shape.
  const inner = (spec.schema as { _def: { schema?: { _def: { items: unknown[] } }; items?: unknown[] } })._def;
  return inner.schema?._def.items.length ?? inner.items?.length ?? 0;
}

/** Which seat owns each open prompt of the host's game (pure view of the host's global prompt slots). */
export interface PromptOwners {
  rule?: string;
  look?: string;
  block?: string;
  mana?: string;
  myriadTap?: string;
  myriadSearch?: string;
  basicLand?: string;
  manualSearch?: string;
}

/** The slice of host state the `when` checks read. */
export interface IntentGameState {
  gameStage: "mulligan" | "playing";
  activeSeatId?: string;
  prioritySeatId?: string;
  hasPendingAction: boolean;
  phase: string;
  owners: PromptOwners;
  hasKept: (seatId: string) => boolean;
  /** Ids of the seat's creatures that may block (BlockChoice defender's battlefield), for validating declared blockers. */
  battlefieldIds: (seatId: string) => string[];
  /** Waiting for a disconnected friend: nothing a friend or the table could do should advance the game meanwhile. */
  paused?: boolean;
}

const OWNER_FOR: Partial<Record<IntentWhen, keyof PromptOwners>> = {
  answerRule: "rule",
  answerLook: "look",
  answerBlock: "block",
  answerMana: "mana",
  answerMyriadTap: "myriadTap",
  answerMyriadSearch: "myriadSearch",
  answerBasicLand: "basicLand",
  answerManualSearch: "manualSearch"
};

export const promptOpen = (owners: PromptOwners): boolean => Object.values(owners).some((owner) => owner !== undefined);
const foreignPrompt = (owners: PromptOwners, seat: string): boolean => Object.values(owners).some((owner) => owner !== undefined && owner !== seat);

/** Refusal reason for a state/`when` mismatch, or undefined when the intent may run. Pure. */
export function checkIntentWhen(when: IntentWhen, seat: string, state: IntentGameState): string | undefined {
  if (when === "mulligan") return state.gameStage !== "mulligan" ? "not in the opening-hand step" : state.hasKept(seat) ? "already kept" : undefined;
  if (state.gameStage !== "playing") return "the game has not started yet";
  if (when === "settings") return undefined; // preferences only: never blocked by the pause or by another seat's prompt
  if (state.paused) return "the game is paused while a player reconnects";
  const answerKey = OWNER_FOR[when];
  if (answerKey) return state.owners[answerKey] === seat ? undefined : "no such prompt is waiting for you";
  if (when === "answerRuleOrManualSearch") return state.owners.rule === seat || state.owners.manualSearch === seat ? undefined : "no such prompt is waiting for you";
  if (when === "priority") {
    if (!state.hasPendingAction) return "nothing is on the stack";
    return state.prioritySeatId === seat ? (foreignPrompt(state.owners, seat) ? "another player is answering a prompt" : undefined) : "you do not have priority";
  }
  if (foreignPrompt(state.owners, seat)) return "another player is answering a prompt";
  if (when === "act") return undefined;
  if (promptOpen(state.owners)) return "finish your pending choice first";
  if (state.activeSeatId !== seat) return "it is not your turn";
  if (state.hasPendingAction) return "the stack is not empty";
  if (when === "attack" && state.phase !== "declare attackers step") return "it is not the declare attackers step";
  return undefined;
}

/** Extra arg-level checks (own seat ids, declared blockers belong to the defender). */
export function checkIntentArgs(name: string, seat: string, args: unknown[], state: IntentGameState): string | undefined {
  const spec = (INTENT_SPECS as Record<string, IntentSpec>)[name];
  for (const index of spec?.seatArgs ?? []) if (args[index] !== seat) return "you can only act for your own seat";
  if (name === "onConfirmBlockers") {
    const mine = new Set(state.battlefieldIds(seat));
    if (!(args[0] as string[]).every((cardId) => mine.has(cardId))) return "those creatures are not yours";
  }
  return undefined;
}
