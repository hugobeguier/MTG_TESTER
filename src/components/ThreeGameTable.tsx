"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import type { AgentReasoning, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import {
  parseGenericManaAbilities,
  parseGenericSacrificeAbilities,
  parseGenericTapAbilities,
  parseSelfUntapAbilities,
  type GenericManaAbility,
  type SacrificeAbility,
  type GenericTapAbility,
  type SelfUntapAbility
} from "@/lib/activatedAbilities";
import { equipCost, isEquipment } from "@/lib/attachments";
import { parseManlandAnimation } from "@/lib/activatedAbilities";
import { hasKeyword as hasOracleKeyword } from "@/lib/keywords";
import { isBasicLandFetchAbility } from "@/lib/oracleClauses";
import { DEFAULT_STOP_SETTINGS, stopKey, TURN_PHASES, type PriorityStopSettings } from "@/lib/priorityStops";
import { VisualCard } from "./VisualCard";

type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
type ManaPool = Record<ManaColor, number>;

// Real creature types found across the card catalog (data/commander-cards.json), for the
// choose_creature_type rule-choice picker (Cavern of Souls, Metallic Mimic, etc.) — non-creature
// card types/supertypes/subtypes that leak into a naive type-line scan (Artifact, Aura, Land,
// Saga, ...) are filtered out.
const CREATURE_TYPES = [
  "Advisor","Aetherborn","Alien","Ally","Angel","Antelope","Ape","Archer","Archon","Armadillo","Artificer","Assassin","Assembly-Worker","Astartes","Atog","Aurochs","Avatar","Azra","Badger","Barbarian","Bard","Basilisk","Bat","Bear","Beast","Beaver","Beeble","Beholder","Berserker","Bird","Bison","Boar","Bringer","Brushwagg","C'tan","Camel","Capybara","Carrier","Cat","Centaur","Child","Chimera","Citizen","Cleric","Clown","Cockatrice","Construct","Coward","Coyote","Crab","Crocodile","Custodes","Cyberman","Cyclops","Dalek","Dauthi","Demigod","Demon","Detective","Devil","Dinosaur","Djinn","Doctor","Dog","Dragon","Drake","Dreadnought","Drix","Drone","Druid","Dryad","Dwarf","Echidna","Efreet","Elder","Eldrazi","Elemental","Elephant","Elf","Elk","Employee","Eye","Faerie","Fish","Flagbearer","Fox","Fractal","Frog","Fungus","Gamer","Gamma","Gargoyle","Giant","Giraffe","Gith","Glimmer","Gnoll","Gnome","Goat","Goblin","God","Golem","Gorgon","Gremlin","Griffin","Guest","Hag","Halfling","Hamster","Harpy","Hedgehog","Hellion","Hero","Hippo","Hippogriff","Homarid","Homunculus","Horror","Horse","Human","Hydra","Hyena","Illusion","Imp","Incarnation","Inhuman","Inkling","Inquisitor","Insect","Jackal","Jellyfish","Juggernaut","Kangaroo","Kavu","Kirin","Kithkin","Knight","Kobold","Kor","Kraken","Kree","Lamia","Lammasu","Leech","Lemur","Leviathan","Lhurgoyf","Licid","Lizard","Lobster","Lord","Manticore","Masticore","Mercenary","Merfolk","Metathran","Minion","Minotaur","Mite","Mole","Monger","Mongoose","Monk","Monkey","Moogle","Moonfolk","Mount","Mouse","Mutant","Myr","Mystic","Nautilus","Necron","Nephilim","Nightmare","Nightstalker","Ninja","Noble","Noggle","Nomad","Nymph","Octopus","Ogre","Ooze","Orc","Orgg","Otter","Ouphe","Ox","Oyster","Pangolin","Peasant","Pegasus","Performer","Pest","Phelddagrif","Phoenix","Phyrexian","Pilot","Pirate","Plant","Platypus","Porcupine","Possum","Praetor","Primarch","Processor","Qu","Rabbit","Raccoon","Ranger","Rat","Rebel","Rhino","Rigger","Robot","Rogue","Sable","Salamander","Samurai","Sand","Saproling","Satyr","Scarecrow","Scientist","Scorpion","Scout","Seal","Serpent","Shade","Shaman","Shapeshifter","Shark","Sheep","Shi'ar","Siege","Siren","Skeleton","Skrull","Skunk","Slith","Sliver","Sloth","Slug","Snail","Snake","Soldier","Soltari","Sorcerer","Spawn","Specter","Spellshaper","Sphinx","Spider","Spike","Spirit","Sponge","Spy","Squid","Squirrel","Starfish","Surrakar","Survivor","Symbiote","Synth","Thalakos","Thopter","Thrull","Tiefling","Treefolk","Trilobite","Troll","Turtle","Tyranid","Unicorn","Utrom","Vampire","Varmint","Vedalken","Villain","Volver","Wall","Walrus","Warlock","Warrior","Weasel","Weird","Werewolf","Whale","Wizard","Wolf","Wolverine","Wombat","Worm","Wraith","Wurm","Yeti","Zombie","Zubera"
] as const;

interface ThreeGameTableProps {
  session: GameSession;
  prioritySeatId?: string;
  selectedCardId?: string;
  selectedCardCanRespond?: boolean;
  selectedCardFaceOptions?: Array<{ faceIndex: number; actionKind: "play_land" | "cast_spell"; label: string; payable: boolean }>;
  lockedRoomDoorFaceIndex?: number;
  humanAttackTargets?: Array<{ targetId: string; label: string }>;
  inspectedCard?: VisibleCard;
  libraryLook?: LibraryLookState;
  ruleChoice?: RuleChoiceView;
  blockChoice?: BlockChoiceView;
  myriadSearchCards?: VisibleCard[];
  basicLandFetchSearch?: {
    sourceCardName: string;
    cards: VisibleCard[];
  };
  urzaSagaSearchCards?: VisibleCard[];
  pendingAction?: PendingActionView;
  stackActions?: PendingActionView[];
  agentThinking?: Record<string, boolean>;
  agentReasoning?: Record<string, AgentReasoning>;
  manaPool?: ManaPool;
  manaChoice?: {
    cardName: string;
    choices: ManaColor[];
  };
  myriadTapChoice?: {
    cardName: string;
  };
  onInspectCard?: (card: VisibleCard) => void;
  onCloseInspectCard?: () => void;
  onSelectHandCard?: (card: VisibleCard) => void;
  onDrawCard?: (seatId: string) => void;
  onPlayCard?: (seatId: string, cardId: string, position?: { x: number; z: number }, sourceZone?: "hand" | "exile") => void;
  // Routes through AppFlow's respondWithCard when a response window is open, instead of onPlayCard
  // (which only handles main-phase casting and silently no-ops if something's already on the stack).
  onCastFromExile?: (seatId: string, cardId: string) => void;
  onPlayCardFace?: (seatId: string, cardId: string, faceIndex: number) => void;
  onUnlockRoomDoor?: (seatId: string, cardId: string, faceIndex: number) => void;
  onDeclareAttack?: (cardId: string, targetId: string) => void;
  onShuffleLibrary?: (seatId: string) => void;
  onOpenLibrarySearch?: () => void;
  onCloseLibrarySearch?: () => void;
  onSearchLibraryCardToHand?: (cardId: string) => void;
  onFinishLibrarySearch?: () => void;
  onChooseGraveyardReanimationTarget?: (seatId: string, cardId: string) => void;
  onChooseSacrificeCostTarget?: (seatId: string, cardId: string) => void;
  onChooseModalOption?: (index: number) => void;
  onChooseEffectTarget?: (target: { kind: "card"; seatId: string; cardId: string } | { kind: "player"; seatId: string }) => void;
  onDeclineEffectTarget?: () => void;
  onConfirmProliferateTargets?: (cardIds: string[], playerSeatIds: string[]) => void;
  onChooseBattlefieldCreatureTarget?: (seatId: string, cardId: string) => void;
  onChooseAuraRetarget?: (seatId: string, cardId: string) => void;
  // Cancel is handled generically by the existing onCloseLibrarySearch/cancelRuleChoice path (see
  // the targeting banner JSX) — no cost has been paid yet when this choice is open, so cancelling
  // is always free, same as every other non-choose_effect_target board-targeting choice.
  onChooseEquipTarget?: (cardId: string) => void;
  onChooseNextTrigger?: (sourceCardId: string) => void;
  onAcceptMiracle?: (faceIndex?: number) => void;
  onDeclineMiracle?: () => void;
  onAcceptOptionalTrigger?: () => void;
  onDeclineOptionalTrigger?: () => void;
  onAcceptCommanderZoneChoice?: () => void;
  onDeclineCommanderZoneChoice?: () => void;
  onCompleteDiscardChoice?: (cardIds: string[]) => void;
  onCompletePutCardsOnLibrary?: (cardIds: string[]) => void;
  onCompleteConniveDiscard?: (cardIds: string[]) => void;
  onCompleteReturnLandToHand?: (cardIds: string[]) => void;
  onChooseCreatureType?: (creatureType: string) => void;
  onChooseColor?: (color: ManaColor) => void;
  onConfirmAttackTriggerManaColors?: (distribution: Partial<Record<Exclude<ManaColor, "C">, number>>) => void;
  onCloseMyriadSearch?: () => void;
  onCompleteMyriadSearch?: (cardIds: string[]) => void;
  onCloseUrzaSagaSearch?: () => void;
  onCompleteUrzaSagaSearch?: (cardId: string) => void;
  onCloseBasicLandFetchSearch?: () => void;
  onCompleteBasicLandFetchSearch?: (cardId: string) => void;
  onMoveCardToGraveyard?: (seatId: string, cardId: string) => void;
  onMoveCardToExile?: (seatId: string, cardId: string) => void;
  onMoveCardToHand?: (seatId: string, cardId: string) => void;
  onMoveBattlefieldCard?: (seatId: string, cardId: string, position: { x: number; z: number }) => void;
  onTapForMana?: (seatId: string, cardId: string) => void;
  onChangeCounter?: (seatId: string, cardId: string, kind: string, delta: number) => void;
  onActivateLoyalty?: (seatId: string, cardId: string, loyaltyCost: number, abilityText: string) => void;
  onCastCommander?: (seatId: string, position?: { x: number; z: number }) => void;
  onResolveMyriadLandscape?: (seatId: string, cardId: string) => void;
  onResolveBasicLandFetch?: (seatId: string, cardId: string) => void;
  onActivateSacrificeAbility?: (seatId: string, cardId: string, abilityIndex: number) => void;
  onActivateTapAbility?: (seatId: string, cardId: string, abilityIndex: number) => void;
  onActivateSelfUntap?: (seatId: string, cardId: string, abilityIndex: number) => void;
  onActivateGenericMana?: (seatId: string, cardId: string, abilityIndex: number) => void;
  onActivateEquip?: (seatId: string, cardId: string) => void;
  onActivateManlandAnimation?: (seatId: string, cardId: string) => void;
  onChangeLife?: (seatId: string, delta: number) => void;
  onKeepLibraryLookCardOnTop?: (cardId: string) => void;
  onOrderLibraryLookCardOnTop?: (cardId: string) => void;
  onPutLibraryLookCardOnBottom?: (cardId: string) => void;
  onPutLibraryLookCardInGraveyard?: (cardId: string) => void;
  onSendLibraryLookCardToHand?: (cardId: string) => void;
  onRepeatVaultLook?: () => void;
  onKeepVaultLookCards?: () => void;
  onCloseLibraryLook?: () => void;
  onToggleTapCard?: (seatId: string, cardId: string, location: CardUserData["location"]) => void;
  onChooseMana?: (color: ManaColor) => void;
  onCancelManaChoice?: () => void;
  onChooseMyriadTapMana?: () => void;
  onChooseMyriadTapSearch?: () => void;
  onCancelMyriadTapChoice?: () => void;
  gameStage?: "mulligan" | "playing";
  humanMulligans?: number;
  mulliganReturnCardIds?: string[];
  mulliganReturnRequired?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onToggleMulliganReturnCard?: (card: VisibleCard) => void;
  onAdvanceTurn?: () => void;
  onEndTurn?: () => void;
  onPassPriority?: () => void;
  onRespond?: () => void;
  onRespondWithSelectedCard?: () => void;
  onResolvePendingTrigger?: () => void;
  onToggleBlocker?: (blockerCardId: string) => void;
  selectedBlockerIds?: string[];
  onConfirmBlockers?: () => void;
  onPassBlocks?: () => void;
  onPayCumulativeUpkeep?: () => void;
  onSacrificeRuleSource?: () => void;
  priorityStopSettings?: PriorityStopSettings;
  onTogglePhaseStop?: (phase: string, seatIndex: number) => void;
  onToggleStopOnStackResponse?: () => void;
  onToggleStopOnAttacked?: () => void;
  onToggleStopOnTargeted?: () => void;
  onToggleFullControl?: () => void;
  holdPriorityOnce?: boolean;
  onStopNext?: () => void;
}

type PendingActionView =
  | {
      id: string;
      type: "phase";
      actorSeatId: string;
      message: string;
    }
  | {
      id: string;
      type: "spell";
      actorSeatId: string;
      cardName: string;
      cardTypeLine?: string;
      message: string;
      // Live lookup of the actual card (see AppFlow.tsx's withPendingActionSourceCard) — lets the
      // stack HUD render real card art instead of just the name/type-line strings above. Can be
      // missing if the card already left the zone this was derived from (fizzled counterspell, ...).
      sourceCard?: VisibleCard;
    }
  | {
      id: string;
      type: "trigger";
      actorSeatId: string;
      controllerSeatId: string;
      sourceCardName: string;
      triggerKind: "common";
      message: string;
      sourceCard?: VisibleCard;
    };

type RuleChoiceView =
  | {
      kind: "choose_card_from_library";
      sourceCardName: string;
      prompt: string;
      cards: VisibleCard[];
      destination: "hand" | "battlefield" | "graveyard" | "library";
      allowedCardFilter?: string;
      // "Up to N"/"N" (Archaeomancer's Map's "up to two basic Plains cards," ...) — cards above
      // already excludes anything counted in chosenCount, so LibrarySearchModal can show "X of Y
      // chosen" and offer a Done button once at least one pick has been made instead of finalizing
      // (and closing) after the very first card regardless of maxChoices.
      maxChoices: number;
      chosenCount: number;
    }
  | {
      kind: "choose_creature_from_graveyards";
      sourceCardName: string;
      prompt: string;
      cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
      // Meren of Clan Nel Toth's own conditional destination (battlefield if affordable, hand
      // otherwise) makes the plain "Return to Battlefield" label actively wrong for that shape —
      // varies per card the same way choose_creature_on_battlefield's own actionLabel already does.
      actionLabel: string;
    }
  | {
      kind: "choose_creature_on_battlefield";
      sourceCardName: string;
      prompt: string;
      cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
      // "Put a coin counter on..." vs. some other future battlefield-target counter effect —
      // varies per card, so the label comes from the choice itself rather than being hardcoded in
      // the modal the way "Return to Battlefield" can be for the graveyard-sourced kind above.
      actionLabel: string;
    }
  | {
      kind: "choose_creature_to_sacrifice";
      sourceCardName: string;
      prompt: string;
      cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
      actionLabel: string;
    }
  | {
      kind: "choose_modal_option";
      sourceCardName: string;
      prompt: string;
      options: Array<{ index: number; label: string }>;
    }
  // The general "this effect says target and you control it" choice — see AppFlow.tsx's
  // choose_effect_target PendingRuleChoice for the full rationale. zone picks which UI this renders
  // as: "battlefield" uses the board-click ring highlight (see BoardTargetingChoice/
  // asBoardTargetingChoice below), "graveyard" reuses TargetPickerModal's card-art list, "player"
  // uses a small button-per-player modal — cards/players is populated for whichever zone applies,
  // empty for the other.
  | {
      kind: "choose_effect_target";
      sourceCardName: string;
      prompt: string;
      optional: boolean;
      zone: "battlefield" | "graveyard" | "player";
      cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
      players: Array<{ seatId: string; seatName: string }>;
    }
  | {
      kind: "choose_proliferate_targets";
      sourceCardName: string;
      prompt: string;
      cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
      players: Array<{ seatId: string; seatName: string; countersLabel: string }>;
    }
  | {
      kind: "choose_aura_attach_target";
      sourceCardName: string;
      prompt: string;
      cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
      actionLabel: string;
    }
  // Equip's real target choice — see AppFlow.tsx's choose_equip_target PendingRuleChoice. Always a
  // "creature you control" pool (no opponent half, unlike choose_aura_attach_target), rendered with
  // the same board-click ring highlight as a battlefield-zone choose_effect_target.
  | {
      kind: "choose_equip_target";
      sourceCardName: string;
      prompt: string;
      cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
      actionLabel: string;
    }
  | {
      kind: "manual_review";
      sourceCardId: string;
      sourceCardName: string;
      prompt: string;
      isCumulativeUpkeep?: boolean;
      cumulativeUpkeepCost?: number;
    }
  | {
      kind: "order_triggers";
      prompt: string;
      triggers: Array<{ sourceCardId: string; sourceCardName: string; text: string }>;
      orderedTriggers: Array<{ sourceCardId: string; sourceCardName: string; text: string }>;
    }
  | {
      kind: "miracle_offer";
      sourceCardName: string;
      prompt: string;
      miracleCost: number;
      // Set only when the offered card is a Room — MiracleOfferModal offers one accept button per
      // door instead of a single generic one, so the player's door choice is honored the same way
      // a normal cast already lets them choose which half to play.
      doorFaces?: [string, string];
    }
  | {
      kind: "optional_trigger";
      sourceCardName: string;
      prompt: string;
    }
  | {
      kind: "commander_zone_choice";
      sourceCardName: string;
      prompt: string;
    }
  | {
      kind: "discard_to_hand_size";
      prompt: string;
      hand: VisibleCard[];
      requiredDiscards: number;
    }
  | {
      kind: "put_cards_on_library";
      sourceCardName: string;
      prompt: string;
      hand: VisibleCard[];
      requiredCount: number;
    }
  | {
      kind: "connive_discard";
      sourceCardName: string;
      prompt: string;
      hand: VisibleCard[];
    }
  | {
      kind: "return_land_to_hand";
      sourceCardName: string;
      prompt: string;
      lands: VisibleCard[];
    }
  | {
      kind: "choose_creature_type";
      sourceCardName: string;
      prompt: string;
      currentChoice?: string;
    }
  | {
      kind: "choose_color";
      sourceCardName: string;
      prompt: string;
      currentChoice?: string;
      excludedColor?: string;
    }
  | {
      kind: "distribute_attack_trigger_mana";
      sourceCardName: string;
      prompt: string;
      amount: number;
    };

interface BlockChoiceView {
  attackerName: string;
  defenderName: string;
  attackingCard: VisibleCard;
  blockers: VisibleCard[];
}

interface LibraryLookState {
  seatId: string;
  mode: "scry" | "surveil" | "reorder" | "choose_one" | "vault_look";
  cards: VisibleCard[];
  remaining: number;
  orderedCards?: VisibleCard[];
}

type DraggedZone = "hand" | "graveyard" | "exile";
type TableZone = "graveyard" | "exile";

interface CardUserData {
  kind: "card";
  card: VisibleCard;
  seatId: string;
  location: "battlefield" | "command";
}

interface ZoneUserData {
  kind: "zone";
  seatId: string;
  zone: TableZone;
}

interface PlayerUserData {
  kind: "player";
  seatId: string;
}

type InteractionUserData = CardUserData | ZoneUserData | PlayerUserData;

// Rule choices whose legal targets already live on the battlefield (Athreos-style battlefield
// counter placement, the Aura post-hoc attach retarget, and a choose_effect_target whose spec.zone
// is "battlefield" — a plain destroy/exile/bounce/damage-to-creature effect) — these are answered
// by clicking the board directly instead of a text-list modal. choose_creature_from_graveyards (and
// a choose_effect_target whose zone is "graveyard") has no battlefield presence (graveyards aren't
// rendered per-card in the 3D scene), so those keep a modal — see TargetPickerModal.
type BoardTargetingChoice =
  | Extract<RuleChoiceView, { kind: "choose_creature_on_battlefield" | "choose_aura_attach_target" | "choose_equip_target" }>
  | Extract<RuleChoiceView, { kind: "choose_effect_target" }>;

function asBoardTargetingChoice(choice: RuleChoiceView | undefined): BoardTargetingChoice | undefined {
  if (choice?.kind === "choose_creature_on_battlefield" || choice?.kind === "choose_aura_attach_target" || choice?.kind === "choose_equip_target") return choice;
  if (choice?.kind === "choose_effect_target" && choice.zone === "battlefield") return choice;
  return undefined;
}

// Sized to give each player's battlefield rectangle (see PLAYER_AREAS) real room before permanents
// start crowding, plus a side strip outside each rectangle for the non-battlefield zones (see
// zoneStripX) and margin beyond the near edge for the hand-count label (see zoneStripPosition and
// the "Hand N" placement in rebuildDynamicScene) — both used to be squeezed inside the battlefield
// rectangle itself, competing with permanents for the same space.
const TABLE_WIDTH = 40;
const TABLE_DEPTH = 16;

// Ordered as a clockwise walk around the table's perimeter (front-left -> back-left -> back-right
// -> front-right), not just "left column then right column" — this array is indexed by seat position
// in the turn-order array (session.seats), so the walk order here IS the visual turn order. Getting
// this wrong doesn't break legality (turns still advance by array index either way), but it makes
// play visibly hop diagonally across the table instead of proceeding around it like a real game.
// The default camera (see cameraState's yaw:0 initial value in the component below) sits on the
// positive-Z side looking toward the table center, i.e. +Z is "front"/near the viewer and -Z is
// "back"/far — walking front-left(-X,+Z) -> front-right(+X,+Z) -> back-right(+X,-Z) -> back-left
// (-X,-Z), the array's PREVIOUS order, is actually counter-clockwise under that convention (reported
// live as "turn order is going counter-clockwise"); front-right and back-left are swapped from that
// order here to make the walk genuinely clockwise instead.
const PLAYER_AREAS = [
  { x: -8.6, z: 3.35, rot: 0, minX: -15.8, maxX: -1.4, minZ: 0.6, maxZ: 6.1 },
  { x: -8.6, z: -3.35, rot: Math.PI, minX: -15.8, maxX: -1.4, minZ: -6.1, maxZ: -0.6 },
  { x: 8.6, z: -3.35, rot: Math.PI, minX: 1.4, maxX: 15.8, minZ: -6.1, maxZ: -0.6 },
  { x: 8.6, z: 3.35, rot: 0, minX: 1.4, maxX: 15.8, minZ: 0.6, maxZ: 6.1 }
];

const imageTextureLoader = new THREE.TextureLoader();
imageTextureLoader.setCrossOrigin("anonymous");
const cardImageTextureCache = new Map<string, THREE.Texture>();
const cardImageTexturePending = new Map<string, Promise<THREE.Texture>>();
const failedCardImageUrls = new Set<string>();
const counterBadgeTextureCache = new Map<string, THREE.Texture>();

export function ThreeGameTable(props: ThreeGameTableProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const dynamicGroupRef = useRef<THREE.Group | null>(null);
  const targetHighlightGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cardMeshesRef = useRef<THREE.Object3D[]>([]);
  const frameRef = useRef<number | undefined>(undefined);
  const propsRef = useRef(props);
  const cameraState = useRef({ yaw: 0, pitch: -0.85, distance: 26, target: new THREE.Vector3(0, 0, 0) });
  const movementKeys = useRef({ forward: false, left: false, back: false, right: false });
  const boardInputActive = useRef(false);
  const pointer = useRef({ down: false, button: 0, x: 0, y: 0, moved: false });
  const hoveredCardRef = useRef<CardUserData | undefined>(undefined);
  const draggedBattlefieldCardRef = useRef<CardUserData | undefined>(undefined);
  const draggedHandCardRef = useRef<VisibleCard | undefined>(undefined);
  const dropGhostRef = useRef<THREE.Group | null>(null);
  // Screen-space anchors for the agent-hand overlays (see the animate() loop) — kept out of React
  // state and written directly to each div's style every frame, the same way camera movement itself
  // is imperative, so tracking a moving/orbiting camera doesn't mean a state update (and full
  // reconciliation) 60 times a second.
  const agentHandAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [draggingHandCardId, setDraggingHandCardId] = useState<string | undefined>();
  const [draggingZone, setDraggingZone] = useState<DraggedZone | undefined>();
  const [zoneView, setZoneView] = useState<{ seatId: string; zone: TableZone } | undefined>();
  // Toggles the 3D life-total plates (addLifeTotalPlate) between life totals and commander damage
  // taken — a button flips this, and it's threaded into rebuildDynamicScene the same way
  // selectedCardId already is, since both need a full scene rebuild to actually change what's drawn
  // on those plates.
  const [showCommanderDamage, setShowCommanderDamage] = useState(false);
  // The agent-hand-anchor panels below render every AI seat's actual hand face-up as a debug/
  // observer view (see that block's own aria-label) — not something a real opponent could see.
  // Purely a DOM-visibility toggle (unlike showCommanderDamage above), so it doesn't need to touch
  // rebuildDynamicScene or trigger a scene rebuild at all.
  const [showAgentHands, setShowAgentHands] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityPosition, setActivityPosition] = useState({ x: 24, y: 144 });
  const [activityDragOffset, setActivityDragOffset] = useState<{ x: number; y: number } | undefined>();
  // Same drag/position pattern as the Agent Activity panel above, kept as its own independent
  // instance (not a shared/generalized one) so both panels can be open and dragged around
  // separately — a different default position (offset right) keeps them from opening stacked on
  // top of each other.
  const [actionLogOpen, setActionLogOpen] = useState(false);
  const [actionLogPosition, setActionLogPosition] = useState({ x: 400, y: 144 });
  const [priorityStopsOpen, setPriorityStopsOpen] = useState(false);
  // Now that most priority windows auto-pass instead of stopping the human (see priorityStops.ts),
  // props.pendingAction often goes from set to undefined within the same tick an agent's decision
  // resolves — the stack HUD below used to key directly off props.pendingAction, so a spell an agent
  // cast with nothing to respond to flashed by faster than a human could read it. This mirrors the
  // last live pendingAction/stackActions for a minimum visible duration instead, only replacing it
  // early when a NEW action actually arrives (never extending an old one past a new one).
  const STACK_HUD_MIN_VISIBLE_MS = 4000;
  const [displayedAction, setDisplayedAction] = useState<PendingActionView | undefined>(props.pendingAction);
  const [displayedStack, setDisplayedStack] = useState<PendingActionView[]>(props.stackActions ?? []);
  const stackHudHideTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (props.pendingAction) {
      if (stackHudHideTimer.current !== undefined) {
        window.clearTimeout(stackHudHideTimer.current);
        stackHudHideTimer.current = undefined;
      }
      setDisplayedAction(props.pendingAction);
      setDisplayedStack(props.stackActions ?? []);
      return;
    }
    if (displayedAction && stackHudHideTimer.current === undefined) {
      stackHudHideTimer.current = window.setTimeout(() => {
        setDisplayedAction(undefined);
        setDisplayedStack([]);
        stackHudHideTimer.current = undefined;
      }, STACK_HUD_MIN_VISIBLE_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingAction, props.stackActions]);
  useEffect(
    () => () => {
      if (stackHudHideTimer.current !== undefined) window.clearTimeout(stackHudHideTimer.current);
    },
    []
  );
  const [actionLogDragOffset, setActionLogDragOffset] = useState<{ x: number; y: number } | undefined>();
  const [reasoningSeatId, setReasoningSeatId] = useState<string | undefined>();
  const human = props.session.seats.find((seat) => seat.kind === "human") ?? props.session.seats[0];
  const agentSeats = props.session.seats.filter((seat) => seat.kind === "agent");
  const latest = props.session.events[0];
  const phaseNotice = latest?.detail === "Phase change" ? latest : undefined;
  const recentEvents = props.session.events.slice(0, 8);
  // "What card was played by who, and what triggers happened" (the user's own framing) — every
  // real board-state change (casts, land plays, trigger resolutions, zone/life/counter changes,
  // combat) is already logged with detail "Stack"/"Trigger"/"Rules action" via addEvent's many call
  // sites in AppFlow.tsx; this excludes only the noisiest bookkeeping categories (per-land-tap mana
  // logging, raw LLM rules-advisor commentary, and the redundant "passes to X" phase-change ticker
  // already shown live in the top-left HUD) rather than requiring a second, separate logging system.
  // Unlike Agent Activity's last-8 slice, this keeps the full session.events history so it reads as
  // a complete record of the game so far, not just a rolling ticker.
  const actionLogEvents = props.session.events.filter(
    (event) => event.detail !== "Mana" && event.detail !== "Rules advisor" && event.detail !== "Timing" && event.detail !== "Phase change"
  );
  const prioritySeat = props.session.seats.find((seat) => seat.id === props.prioritySeatId);
  const humanSeatIndex = Math.max(0, props.session.seats.findIndex((seat) => seat.id === human.id));
  const humanHasPriority = props.prioritySeatId === human.id;
  const humanIsActive = props.session.activePlayerId === human.id;
  const stackTopFirst = [...displayedStack].reverse();
  const mulliganSelectedCount = props.mulliganReturnCardIds?.length ?? 0;
  const mulliganRequired = props.mulliganReturnRequired ?? 0;
  const tableRenderKey = useMemo(() => buildTableRenderKey(props.session, props.selectedCardId), [props.session, props.selectedCardId]);
  const boardTargetingChoice = asBoardTargetingChoice(props.ruleChoice);
  // A plain string rather than the choice object itself, since ruleChoiceView derives a fresh
  // object every render — using the object as a dependency would rebuild the highlight rings every
  // render instead of only when the actual legal-target set changes.
  const boardTargetingKey = boardTargetingChoice ? `${boardTargetingChoice.kind}:${boardTargetingChoice.cards.map((entry) => entry.card.id).join(",")}` : "";

  propsRef.current = props;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d100d");
    sceneRef.current = scene;

    const dynamicGroup = new THREE.Group();
    dynamicGroupRef.current = dynamicGroup;
    scene.add(dynamicGroup);

    // Landing-spot preview for a permanent being dragged from hand — lives outside dynamicGroup so
    // it survives rebuildDynamicScene's group.clear() and can be repositioned every dragover
    // without waiting on a session-driven re-render.
    const dropGhost = new THREE.Group();
    dropGhost.visible = false;
    dropGhost.rotation.x = -Math.PI / 2;
    dropGhost.position.y = 0.09;
    const dropGhostFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 1.02),
      new THREE.MeshBasicMaterial({ color: "#f4c95d", transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })
    );
    const dropGhostOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.72, 1.02)),
      new THREE.LineBasicMaterial({ color: "#f4c95d", transparent: true, opacity: 0.85 })
    );
    dropGhost.add(dropGhostFill, dropGhostOutline);
    scene.add(dropGhost);
    dropGhostRef.current = dropGhost;

    // Legal-target rings for the active board-targeting choice (see asBoardTargetingChoice) — a
    // sibling of dynamicGroup, not a child of it, so rebuildDynamicScene's group.clear() (called on
    // every session change) can't wipe it out from under an in-progress choice; rebuilt by its own
    // effect below instead, keyed on both the scene and the choice's legal-target set.
    const targetHighlightGroup = new THREE.Group();
    scene.add(targetHighlightGroup);
    targetHighlightGroupRef.current = targetHighlightGroup;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.tabIndex = 0;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight("#d8d0b7", 1.8));
    const directional = new THREE.DirectionalLight("#fff4d6", 2.5);
    directional.position.set(3, 8, 4);
    scene.add(directional);

    const table = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE_WIDTH, 0.35, TABLE_DEPTH),
      new THREE.MeshStandardMaterial({ color: "#17301f", roughness: 0.88, metalness: 0.05 })
    );
    table.position.y = -0.22;
    scene.add(table);

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    const updateCamera = () => {
      const state = cameraState.current;
      const x = state.target.x + Math.sin(state.yaw) * Math.cos(state.pitch) * state.distance;
      const y = state.target.y + Math.sin(-state.pitch) * state.distance + 2;
      const z = state.target.z + Math.cos(state.yaw) * Math.cos(state.pitch) * state.distance;
      camera.position.set(x, y, z);
      camera.lookAt(state.target);
    };

    let lastFrameTime = performance.now();

    const updateKeyboardMovement = (deltaSeconds: number) => {
      const keys = movementKeys.current;
      const forwardInput = Number(keys.forward) - Number(keys.back);
      const rightInput = Number(keys.right) - Number(keys.left);
      if (forwardInput === 0 && rightInput === 0) return;

      const state = cameraState.current;
      const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
      const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
      const movement = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(rightInput));
      if (movement.lengthSq() === 0) return;

      movement.normalize().multiplyScalar(7 * deltaSeconds);
      state.target.add(movement);
    };

    // Anchors each agent's hand overlay (a real DOM box, so it can have a real scrollbar) to that
    // agent's name-label position in the 3D scene, re-projected to screen space every frame so it
    // sits next to that player's own board as the camera orbits/pans/zooms — restored after a fully
    // static per-corner layout was tried instead (it stopped the drift but lost the actual
    // board-relative placement, reported live as "the hands should be by each player's board like
    // before"). The heavy smoothing below is specifically to tame the front-row/near-camera parallax
    // that made the original version feel like it was drifting.
    const projected = new THREE.Vector3();
    // Hand panels are a fixed 468px wide (see .agent-hand-anchor in globals.css). Perspective
    // foreshortens seats that sit far from the camera, so two agents' name-label anchors can
    // project close together on screen even though they're nowhere near each other on the table —
    // left uncorrected, their boxes draw on top of each other. Collect every visible anchor first,
    // then push overlapping ones apart left-to-right before writing any position to the DOM.
    const HAND_ANCHOR_MIN_GAP = 468 + 16;
    // Malik (back-right) and Sable (front-right) share the same table x-coordinate (see
    // PLAYER_AREAS), so their raw projected "left" values cross over repeatedly as the camera
    // orbits. Sorting by that raw value every frame let the overlap push-apart above flip which
    // seat it treats as "first", snapping the other one sideways by a full HAND_ANCHOR_MIN_GAP —
    // reported live as "Sable's hand jumping right for no reason" whenever the camera moved.
    // Sorting by each seat's fixed array index instead keeps a stable left-to-right order (Veyra,
    // Malik, Sable) regardless of camera angle, so the push-apart never flip-flops, and lerping
    // toward the target position below (rather than snapping straight to it) smooths out whatever
    // real parallax motion remains.
    const pendingHandAnchors: { el: HTMLElement; seatIndex: number; left: number; top: number }[] = [];
    const handAnchorRenderPositions = new Map<HTMLElement, { left: number; top: number }>();
    const updateAgentHandAnchors = (deltaSeconds: number) => {
      const currentSeats = propsRef.current.session.seats;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
      pendingHandAnchors.length = 0;
      currentSeats.forEach((seat, index) => {
        if (seat.kind !== "agent") return;
        const el = agentHandAnchorRefs.current[seat.id];
        if (!el) return;
        const area = PLAYER_AREAS[index] ?? PLAYER_AREAS[0];
        const z = area.rot === 0 ? area.maxZ + 0.35 : area.minZ - 0.35;
        projected.set(area.x, 0.1, z).project(camera);
        if (projected.z > 1) {
          el.style.display = "none";
          return;
        }
        pendingHandAnchors.push({
          el,
          seatIndex: index,
          left: (projected.x * 0.5 + 0.5) * width,
          top: (-projected.y * 0.5 + 0.5) * height
        });
      });
      pendingHandAnchors.sort((a, b) => a.seatIndex - b.seatIndex);
      for (let i = 1; i < pendingHandAnchors.length; i += 1) {
        const minLeft = pendingHandAnchors[i - 1].left + HAND_ANCHOR_MIN_GAP;
        if (pendingHandAnchors[i].left < minLeft) pendingHandAnchors[i].left = minLeft;
      }
      // The push-apart above only ever pushes further RIGHT to resolve an overlap — nothing pulled
      // a box back once that push (or the raw projection itself, for a front-row seat like Sable
      // whose anchor point sits close to the camera and near a screen edge) carried it past the
      // viewport's own right or top edge. `left`/`top` mark the box's bottom-CENTER (see
      // .agent-hand-anchor's translate(-50%, -100%)), so half its 468px width must stay clear of
      // both edges, and its full height must stay clear of the top edge. Reported live as Sable's
      // hand box hanging half off the right side of the screen while Veyra/Malik's stayed in view.
      const HAND_ANCHOR_HALF_WIDTH = 234;
      const HAND_ANCHOR_EDGE_MARGIN = 8;
      const HAND_ANCHOR_MIN_TOP = 150;
      for (const anchor of pendingHandAnchors) {
        anchor.left = Math.min(Math.max(anchor.left, HAND_ANCHOR_HALF_WIDTH + HAND_ANCHOR_EDGE_MARGIN), width - HAND_ANCHOR_HALF_WIDTH - HAND_ANCHOR_EDGE_MARGIN);
        anchor.top = Math.max(anchor.top, HAND_ANCHOR_MIN_TOP);
      }
      // A much lower time-constant than a typical UI lerp (10 was the original value, before this
      // restoration) — front-row seats swing through a wide screen-space arc per degree of camera
      // orbit (basic motion parallax; see the comment above this function), and that raw swing read
      // as "drift"/"jumping" even once the ordering flip-flop was fixed. 3 makes the box glide well
      // behind the target position instead of chasing it exactly, trading a little responsiveness
      // for a lot less perceived jitter.
      const smoothing = 1 - Math.exp(-3 * deltaSeconds);
      pendingHandAnchors.forEach(({ el, left, top }) => {
        el.style.display = "grid";
        const previous = handAnchorRenderPositions.get(el) ?? { left, top };
        const nextLeft = previous.left + (left - previous.left) * smoothing;
        const nextTop = previous.top + (top - previous.top) * smoothing;
        handAnchorRenderPositions.set(el, { left: nextLeft, top: nextTop });
        el.style.left = `${nextLeft}px`;
        el.style.top = `${nextTop}px`;
      });
    };

    const animate = () => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      updateKeyboardMovement(deltaSeconds);
      updateCamera();
      updateAgentHandAnchors(deltaSeconds);
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(animate);
    };

    const raycastCard = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      return raycaster.intersectObjects(cardMeshesRef.current, true)[0];
    };

    const pickCard = (event: PointerEvent) => {
      const hit = raycastCard(event);
      const data = hit?.object.userData as Partial<InteractionUserData> | undefined;

      // While a board-targeting choice is open, every click is consumed by targeting — a legal hit
      // resolves the choice, an illegal one (or empty space) is simply ignored, rather than opening
      // the card inspector underneath. Cancel is a separate explicit button (see the targeting
      // banner in the JSX below), not a click-elsewhere gesture, since the camera pan/orbit already
      // uses empty-space drags.
      const targeting = asBoardTargetingChoice(propsRef.current.ruleChoice);
      if (targeting) {
        if (data?.kind === "card" && data.card) {
          const entry = targeting.cards.find((candidate) => candidate.card.id === data.card!.id);
          if (entry) {
            if (targeting.kind === "choose_creature_on_battlefield") propsRef.current.onChooseBattlefieldCreatureTarget?.(entry.seatId, entry.card.id);
            else if (targeting.kind === "choose_aura_attach_target") propsRef.current.onChooseAuraRetarget?.(entry.seatId, entry.card.id);
            else if (targeting.kind === "choose_equip_target") propsRef.current.onChooseEquipTarget?.(entry.card.id);
            else propsRef.current.onChooseEffectTarget?.({ kind: "card", seatId: entry.seatId, cardId: entry.card.id });
          }
        }
        return;
      }

      if (data?.kind === "card" && data.card) {
        propsRef.current.onInspectCard?.(data.card);
        return;
      }
      if (data?.kind === "zone" && data.seatId && data.zone) {
        setZoneView({ seatId: data.seatId, zone: data.zone });
      }
    };

    const updateHoveredCard = (event: PointerEvent) => {
      const hit = raycastCard(event);
      const data = hit?.object.userData as Partial<InteractionUserData> | undefined;

      const targeting = asBoardTargetingChoice(propsRef.current.ruleChoice);
      if (targeting) {
        hoveredCardRef.current = undefined;
        const isLegalTarget = data?.kind === "card" && data.card && targeting.cards.some((candidate) => candidate.card.id === data.card!.id);
        renderer.domElement.style.cursor = isLegalTarget ? "crosshair" : "not-allowed";
        return;
      }

      hoveredCardRef.current = data?.kind === "card" && data.card && data.seatId && data.location ? (data as CardUserData) : undefined;
      const hovered = hoveredCardRef.current;
      renderer.domElement.style.cursor = hovered?.location === "battlefield" && hovered.seatId === propsRef.current.session.seats.find((seat) => seat.kind === "human")?.id ? "grab" : hovered || data?.kind === "zone" ? "pointer" : "";
    };

    const getTablePosition = (event: PointerEvent, seatId: string) => {
      const seatIndex = Math.max(0, propsRef.current.session.seats.findIndex((seat) => seat.id === seatId));
      const area = PLAYER_AREAS[seatIndex] ?? PLAYER_AREAS[0];
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08), new THREE.Vector3());
      if (!point) return { x: area.x, z: area.z };
      return {
        x: THREE.MathUtils.clamp(point.x, area.minX + 0.45, area.maxX - 0.45),
        z: THREE.MathUtils.clamp(point.z, area.minZ + 0.6, area.maxZ - 0.6)
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      boardInputActive.current = true;
      renderer.domElement.focus();
      pointer.current = { down: true, button: event.button, x: event.clientX, y: event.clientY, moved: false };
      updateHoveredCard(event);
      const hovered = hoveredCardRef.current;
      const humanId = propsRef.current.session.seats.find((seat) => seat.kind === "human")?.id;
      const targeting = asBoardTargetingChoice(propsRef.current.ruleChoice);
      draggedBattlefieldCardRef.current =
        !targeting && event.button === 0 && !event.shiftKey && hovered?.location === "battlefield" && hovered.seatId === humanId ? hovered : undefined;
      if (draggedBattlefieldCardRef.current) {
        renderer.domElement.style.cursor = "grabbing";
      }
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      updateHoveredCard(event);
      if (!pointer.current.down) return;
      const dx = event.clientX - pointer.current.x;
      const dy = event.clientY - pointer.current.y;
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointer.current.moved = true;
      const draggedCard = draggedBattlefieldCardRef.current;
      if (draggedCard) {
        propsRef.current.onMoveBattlefieldCard?.(draggedCard.seatId, draggedCard.card.id, getTablePosition(event, draggedCard.seatId));
        return;
      }
      if (pointer.current.button === 2 || event.shiftKey) {
        cameraState.current.target.x -= dx * 0.025;
        cameraState.current.target.z -= dy * 0.025;
      } else {
        cameraState.current.yaw -= dx * 0.006;
        cameraState.current.pitch = THREE.MathUtils.clamp(cameraState.current.pitch - dy * 0.004, -1.25, -0.25);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const draggedCard = draggedBattlefieldCardRef.current;
      // A pointerdown on one of the human's own battlefield cards always arms drag-to-reposition
      // (see onPointerDown), even for what's really just a click with no intent to move anything —
      // real mice rarely report zero movement between down and up. Gate on pointer.current.moved so
      // a plain click still opens the inspector (attack targets, tap abilities, equip, ...) instead
      // of being swallowed as a no-op reposition every time.
      if (draggedCard && pointer.current.moved) {
        propsRef.current.onMoveBattlefieldCard?.(draggedCard.seatId, draggedCard.card.id, getTablePosition(event, draggedCard.seatId));
        draggedBattlefieldCardRef.current = undefined;
        updateHoveredCard(event);
      } else {
        draggedBattlefieldCardRef.current = undefined;
        if (!pointer.current.moved) pickCard(event);
      }
      pointer.current.down = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.current.distance = THREE.MathUtils.clamp(cameraState.current.distance + event.deltaY * 0.015, 2.5, 50);
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const clearMovementKeys = () => {
      movementKeys.current = { forward: false, left: false, back: false, right: false };
    };

    const onPointerEnter = () => {
      boardInputActive.current = true;
    };

    const onPointerLeave = () => {
      hoveredCardRef.current = undefined;
      draggedBattlefieldCardRef.current = undefined;
      renderer.domElement.style.cursor = "";
      boardInputActive.current = document.activeElement === renderer.domElement;
      if (!boardInputActive.current) clearMovementKeys();
    };

    const onCanvasBlur = () => {
      boardInputActive.current = false;
      clearMovementKeys();
    };

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
    };

    const setMovementKey = (event: KeyboardEvent, active: boolean) => {
      if (!boardInputActive.current && document.activeElement !== renderer.domElement) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "t" && active) {
        const hovered = hoveredCardRef.current;
        if (!hovered) return;
        propsRef.current.onToggleTapCard?.(hovered.seatId, hovered.card.id, hovered.location);
      } else if (key === "w") movementKeys.current.forward = active;
      else if (key === "a") movementKeys.current.left = active;
      else if (key === "s") movementKeys.current.back = active;
      else if (key === "d") movementKeys.current.right = active;
      else return;
      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => setMovementKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => setMovementKey(event, false);
    const onBlur = () => {
      boardInputActive.current = false;
      clearMovementKeys();
    };

    resize();
    animate();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerenter", onPointerEnter);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("blur", onCanvasBlur);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerenter", onPointerEnter);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("blur", onCanvasBlur);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    rebuildDynamicScene(dynamicGroupRef.current, propsRef.current.session, propsRef.current.selectedCardId, cardMeshesRef, showCommanderDamage);
  }, [tableRenderKey, showCommanderDamage]);

  // Legal-target ring meshes for the active board-targeting choice — runs after the scene rebuild
  // effect above (React fires same-commit effects in declaration order) so cardMeshesRef already
  // reflects the current session by the time this reads it. Kept as its own effect, and the group
  // itself kept outside dynamicGroup (see its creation in the mount effect), so opening/closing a
  // targeting choice doesn't force a full board rebuild.
  useEffect(() => {
    const group = targetHighlightGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) group.remove(group.children[0]);
    if (!boardTargetingChoice) return;
    const legalCardIds = new Set(boardTargetingChoice.cards.map((entry) => entry.card.id));
    for (const mesh of cardMeshesRef.current) {
      const data = mesh.userData as Partial<InteractionUserData>;
      if (data.kind !== "card" || !data.card || !legalCardIds.has(data.card.id)) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.5, 32),
        new THREE.MeshBasicMaterial({ color: "#f4c95d", transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy((mesh as THREE.Mesh).position);
      ring.position.y += 0.02;
      group.add(ring);
    }
  }, [tableRenderKey, boardTargetingKey]);

  const activeName = useMemo(
    () => props.session.seats.find((seat) => seat.id === props.session.activePlayerId)?.name ?? "Active player",
    [props.session]
  );

  function onCardDragStart(event: DragEvent<HTMLElement>, card: VisibleCard, zone: DraggedZone) {
    if (props.gameStage !== "playing") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id);
    event.dataTransfer.setData("application/x-mtg-card", JSON.stringify({ cardId: card.id, zone }));
    setDraggingHandCardId(card.id);
    setDraggingZone(zone);
    draggedHandCardRef.current = zone === "hand" ? card : undefined;
    if (zone === "hand") props.onSelectHandCard?.(card);
  }

  function beginActivityDrag(event: ReactPointerEvent<HTMLElement>) {
    const panel = event.currentTarget.closest<HTMLElement>(".activity-panel");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setActivityDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveActivityPanel(event: ReactPointerEvent<HTMLElement>) {
    if (!activityDragOffset) return;
    const width = 360;
    const height = 260;
    setActivityPosition({
      x: Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - activityDragOffset.x)),
      y: Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY - activityDragOffset.y))
    });
  }

  function endActivityDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!activityDragOffset) return;
    setActivityDragOffset(undefined);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function beginActionLogDrag(event: ReactPointerEvent<HTMLElement>) {
    const panel = event.currentTarget.closest<HTMLElement>(".activity-panel");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setActionLogDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveActionLogPanel(event: ReactPointerEvent<HTMLElement>) {
    if (!actionLogDragOffset) return;
    const width = 360;
    const height = 260;
    setActionLogPosition({
      x: Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - actionLogDragOffset.x)),
      y: Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY - actionLogDragOffset.y))
    });
  }

  function endActionLogDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!actionLogDragOffset) return;
    setActionLogDragOffset(undefined);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onCardDragEnd() {
    setDraggingHandCardId(undefined);
    setDraggingZone(undefined);
    draggedHandCardRef.current = undefined;
    hideDropGhost();
  }

  function hideDropGhost() {
    if (dropGhostRef.current) dropGhostRef.current.visible = false;
  }

  function onBoardDragOver(event: DragEvent<HTMLDivElement>) {
    if (props.gameStage !== "playing") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const draggedCard = draggedHandCardRef.current;
    const ghost = dropGhostRef.current;
    // Only permanents (and lands, which aren't "spells" but land on the battlefield the same way)
    // have a landing spot worth previewing — instants/sorceries resolve straight to the graveyard.
    if (!draggedCard || !ghost || draggedCard.typeLine.includes("Instant") || draggedCard.typeLine.includes("Sorcery")) {
      hideDropGhost();
      return;
    }
    const position = getClampedDropPosition(event);
    const humanIndex = Math.max(0, props.session.seats.findIndex((seat) => seat.id === human.id));
    const rot = PLAYER_AREAS[humanIndex]?.rot ?? 0;
    ghost.position.x = position.x;
    ghost.position.z = position.z;
    ghost.rotation.z = rot;
    ghost.visible = true;
  }

  function onBoardDragLeave() {
    hideDropGhost();
  }

  function getClampedDropPosition(event: DragEvent<HTMLDivElement>) {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const humanIndex = Math.max(0, props.session.seats.findIndex((seat) => seat.id === human.id));
    const area = PLAYER_AREAS[humanIndex] ?? PLAYER_AREAS[0];
    if (!renderer || !camera) return { x: area.x, z: area.z };

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08), new THREE.Vector3());
    if (!point) return { x: area.x, z: area.z };

    return {
      x: THREE.MathUtils.clamp(point.x, area.minX + 0.45, area.maxX - 0.45),
      z: THREE.MathUtils.clamp(point.z, area.minZ + 0.6, area.maxZ - 0.6)
    };
  }

  function onBoardDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const { cardId, zone } = getDraggedCard(event);
    setDraggingHandCardId(undefined);
    setDraggingZone(undefined);
    draggedHandCardRef.current = undefined;
    hideDropGhost();
    if (!cardId || props.gameStage !== "playing" || zone !== "hand") return;
    const position = getClampedDropPosition(event);
    const tableZone = tableZoneAtPosition(props.session, human.id, position);
    if (tableZone === "graveyard") {
      props.onMoveCardToGraveyard?.(human.id, cardId);
      return;
    }
    if (tableZone === "exile") {
      props.onMoveCardToExile?.(human.id, cardId);
      return;
    }
    props.onPlayCard?.(human.id, cardId, position);
  }

  function onHandDragOver(event: DragEvent<HTMLDivElement>) {
    if (props.gameStage !== "playing") return;
    const { zone } = getDraggedCard(event);
    if (zone !== "graveyard") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onHandDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const { cardId, zone } = getDraggedCard(event);
    setDraggingHandCardId(undefined);
    setDraggingZone(undefined);
    if (!cardId || zone !== "graveyard") return;
    props.onMoveCardToHand?.(human.id, cardId);
  }

  const inspectedOwner = props.inspectedCard ? findCardOwner(props.session, props.inspectedCard.id) : undefined;

  return (
    <section className="three-game-shell">
      <div
        className={`three-board ${draggingHandCardId ? "is-drop-target" : ""}`}
        ref={mountRef}
        onDragOver={onBoardDragOver}
        onDragLeave={onBoardDragLeave}
        onDrop={onBoardDrop}
      />
      {phaseNotice ? (
        <div className="phase-popup" role="status" aria-live="polite">
          <span>Phase</span>
          <strong>{phaseNotice.message}</strong>
        </div>
      ) : null}
      <div className="three-hud top-left">
        {/* session.turn increments once per individual player's turn (a 4-player round spans
            turns 1-4), not once per round — divide it back down to the round number players
            actually mean by "turn N". */}
        <span>Turn {Math.max(1, Math.ceil(props.session.turn / Math.max(1, props.session.seats.length)))}</span>
        <strong>{activeName}</strong>
        <small>{props.session.phase}</small>
        <small>Priority: {prioritySeat?.name ?? "None"}</small>
      </div>
      <div className="three-hud top-right">
        <button type="button" onClick={() => setActivityOpen((current) => !current)}>Agent Activity</button>
        <button type="button" onClick={() => setActionLogOpen((current) => !current)}>Action Log</button>
        <button type="button" onClick={() => setPriorityStopsOpen(true)}>Stops</button>
        <button
          type="button"
          className={showCommanderDamage ? "is-active" : undefined}
          onClick={() => setShowCommanderDamage((current) => !current)}
          aria-pressed={showCommanderDamage}
        >
          {showCommanderDamage ? "Show Life Totals" : "Show Commander Damage"}
        </button>
        <button
          type="button"
          className={showAgentHands ? "is-active" : undefined}
          onClick={() => setShowAgentHands((current) => !current)}
          aria-pressed={showAgentHands}
        >
          {showAgentHands ? "Hide Agent Hands" : "Show Agent Hands"}
        </button>
      </div>
      {showAgentHands && agentSeats.map((seat) => (
        <div
          className="agent-hand-anchor"
          key={seat.id}
          ref={(el) => {
            agentHandAnchorRefs.current[seat.id] = el;
          }}
          aria-label={`${seat.name}'s hand (observer view)`}
        >
          <header>
            <strong>{seat.name}</strong>
            <span>{seat.board.hand.length} cards</span>
          </header>
          <div className="agent-hand-row">
            {seat.board.hand.length === 0 ? (
              <p className="agent-hand-empty">Empty hand</p>
            ) : (
              seat.board.hand.map((card) => (
                <article
                  className="agent-hand-card"
                  key={card.id}
                  title={`${card.name}\n${card.typeLine}\n${card.oracleText}`}
                  onClick={() => props.onInspectCard?.(card)}
                >
                  {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" draggable={false} /> : <FallbackHandCard card={card} />}
                </article>
              ))
            )}
          </div>
        </div>
      ))}
      <div className="three-hud agent-thinking-strip" aria-label="Agent thinking indicators">
        {agentSeats.map((seat) => {
          const thinking = Boolean(props.agentThinking?.[seat.id]);
          const reasoning = props.agentReasoning?.[seat.id];
          const stateClass = thinking ? "is-thinking" : reasoning ? "is-ready" : "is-empty";
          return (
            <button
              key={seat.id}
              type="button"
              className={`agent-thinking-badge ${stateClass}`}
              onClick={() => setReasoningSeatId(seat.id)}
              aria-label={`${seat.name} thinking indicator${thinking ? " (deciding)" : ""}`}
            >
              <span className="agent-thinking-icon" aria-hidden="true">🧠</span>
              <span className="agent-thinking-name">{seat.name}</span>
            </button>
          );
        })}
      </div>
      {activityOpen ? (
        <aside className="activity-panel" style={{ left: activityPosition.x, top: activityPosition.y }}>
          <header
            onPointerDown={beginActivityDrag}
            onPointerMove={moveActivityPanel}
            onPointerUp={endActivityDrag}
            onPointerCancel={endActivityDrag}
          >
            <span className="activity-panel-title">
              <strong>Agent Activity</strong>
              <small>Newest first</small>
            </span>
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setActivityOpen(false)}>x</button>
          </header>
          <div className="activity-feed">
            {recentEvents.map((event) => (
              <p key={event.id}>{event.message}</p>
            ))}
          </div>
        </aside>
      ) : null}
      {actionLogOpen ? (
        <aside className="activity-panel" style={{ left: actionLogPosition.x, top: actionLogPosition.y }}>
          <header
            onPointerDown={beginActionLogDrag}
            onPointerMove={moveActionLogPanel}
            onPointerUp={endActionLogDrag}
            onPointerCancel={endActionLogDrag}
          >
            <span className="activity-panel-title">
              <strong>Action Log</strong>
              <small>Newest first</small>
            </span>
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setActionLogOpen(false)}>x</button>
          </header>
          {/* Newest first, matching session.events' own order (every addEvent call prepends) and
              Agent Activity's feed above — a reader watching live wants the newest line at the top
              without having to scroll down to it. This label exists because that ordering reads as
              a plausible-but-wrong chronology otherwise: e.g. a spell's "resolves" line sits above
              its own "casts ..." line, which looks like the permanent resolved before it was even
              cast unless the reader knows to read bottom-up. Reported live as exactly that
              confusion, over a real (and correctly ordered) cast-then-resolve sequence. */}
          <div className="activity-feed">
            {actionLogEvents.length === 0 ? (
              <p>No actions yet this game.</p>
            ) : (
              actionLogEvents.map((event) => <p key={event.id}>{event.message}</p>)
            )}
          </div>
        </aside>
      ) : null}
      <div className="three-hud bottom-left">
        {props.gameStage === "mulligan" ? (
          <div className="hud-actions">
            <strong>{human.board.hand.length} cards</strong>
            <small>
              {mulliganRequired > 0
                ? `Choose ${mulliganRequired} card${mulliganRequired === 1 ? "" : "s"} to shuffle into your library. Selected ${mulliganSelectedCount}/${mulliganRequired}.`
                : "You may keep 7. First mulligan is free."}
            </small>
            <button type="button" disabled={mulliganSelectedCount !== mulliganRequired} onClick={props.onKeepHand}>Keep</button>
            <button type="button" onClick={props.onMulligan}>Mulligan</button>
          </div>
        ) : (
          <div className="hud-actions">
            <div className="mana-pool" aria-label="Floating mana">
              {(["W", "U", "B", "R", "G", "C"] as ManaColor[]).map((color) => (
                <span className={`mana-symbol mana-${color.toLowerCase()}`} key={color}>
                  {color} {props.manaPool?.[color] ?? 0}
                </span>
              ))}
            </div>
            <button type="button" onClick={() => props.onDrawCard?.(human.id)}>Draw</button>
            <button type="button" onClick={() => props.onShuffleLibrary?.(human.id)}>Shuffle</button>
            <button type="button" onClick={props.onOpenLibrarySearch}>Search Library</button>
            <div className="life-adjuster" aria-label="Life total controls">
              <button type="button" onClick={() => props.onChangeLife?.(human.id, -1)}>-</button>
              <strong>{human.life}</strong>
              <button type="button" onClick={() => props.onChangeLife?.(human.id, 1)}>+</button>
            </div>
            {props.selectedCardFaceOptions && props.selectedCardFaceOptions.length > 0 ? (
              props.selectedCardFaceOptions.map((option) => (
                <button
                  key={option.faceIndex}
                  type="button"
                  disabled={!option.payable}
                  onClick={() => props.selectedCardId && props.onPlayCardFace?.(human.id, props.selectedCardId, option.faceIndex)}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <button type="button" disabled={!props.selectedCardId} onClick={() => props.selectedCardId && props.onPlayCard?.(human.id, props.selectedCardId)}>
                Play Selected
              </button>
            )}
            <button
              type="button"
              className={props.priorityStopSettings?.fullControl ? "is-active" : undefined}
              aria-pressed={props.priorityStopSettings?.fullControl}
              onClick={props.onToggleFullControl}
            >
              Full Control
            </button>
            <button
              type="button"
              className={props.holdPriorityOnce ? "is-active" : undefined}
              aria-pressed={props.holdPriorityOnce}
              disabled={props.holdPriorityOnce}
              onClick={props.onStopNext}
            >
              Stop Next
            </button>
            <button type="button" disabled={Boolean(props.pendingAction) || !humanIsActive} onClick={props.onAdvanceTurn}>
              {humanIsActive && !props.pendingAction ? "Continue" : "Advance Phase"}
            </button>
            <button type="button" disabled={Boolean(props.pendingAction) || !humanIsActive} onClick={props.onEndTurn}>End Turn</button>
            <button type="button" disabled={!props.pendingAction || !humanHasPriority} onClick={props.onRespond}>Review Response</button>
            <button type="button" disabled={!props.pendingAction || !humanHasPriority || !props.selectedCardCanRespond} onClick={props.onRespondWithSelectedCard}>
              Respond Selected
            </button>
            <button type="button" disabled={props.pendingAction?.type !== "trigger" || !humanHasPriority} onClick={props.onResolvePendingTrigger}>
              Resolve Trigger
            </button>
            <button type="button" disabled={!props.pendingAction || !humanHasPriority} onClick={props.onPassPriority}>Pass Priority</button>
          </div>
        )}
      </div>
      {displayedAction ? (
        <div className="three-hud bottom-right">
          <div className="hud-card-detail stack-detail">
            <strong>{displayedAction.type === "spell" ? "Stack" : displayedAction.type === "trigger" ? "Trigger" : "Phase Change"}</strong>
            {displayedAction.type !== "phase" && displayedAction.sourceCard ? (
              <VisualCard card={displayedAction.sourceCard} compact />
            ) : null}
            <p>{displayedAction.message}</p>
            {displayedAction.type === "spell" && displayedAction.cardTypeLine ? (
              <p className="stack-type-line">{displayedAction.cardTypeLine}</p>
            ) : null}
            {stackTopFirst.length > 0 ? (
              <div className="stack-list" aria-label="Current stack">
                <span>Top of stack</span>
                {stackTopFirst.map((action, index) => (
                  <div className="stack-item" key={action.id}>
                    <small>{index === 0 ? "Resolving next" : "Below"}</small>
                    {action.type !== "phase" && action.sourceCard ? (
                      <VisualCard card={action.sourceCard} compact />
                    ) : (
                      <>
                        <strong>{action.type === "spell" ? action.cardName : action.type === "trigger" ? `${action.sourceCardName} trigger` : "Phase change"}</strong>
                        {action.type === "spell" && action.cardTypeLine ? <small>{action.cardTypeLine}</small> : null}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
            {/* Only shown while props.pendingAction is genuinely still live — once the panel is just
                lingering after auto-resolving (see the display-persistence effect above), priority
                has typically already moved elsewhere, and repeating a stale "X has priority" line
                here would be actively misleading rather than merely uninformative. */}
            {props.pendingAction ? (
              <span>{humanHasPriority ? "You have priority." : `${prioritySeat?.name ?? "An agent"} has priority.`}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {props.inspectedCard ? (
        <CardInspector
          card={props.inspectedCard}
          owner={inspectedOwner}
          onClose={props.onCloseInspectCard}
          onMoveToGraveyard={
            inspectedOwner?.seat.kind === "human" && (inspectedOwner.zone === "hand" || inspectedOwner.zone === "battlefield" || inspectedOwner.zone === "exile")
              ? () => props.onMoveCardToGraveyard?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          onMoveToExile={
            inspectedOwner?.seat.kind === "human" && (inspectedOwner.zone === "hand" || inspectedOwner.zone === "battlefield" || inspectedOwner.zone === "graveyard")
              ? () => props.onMoveCardToExile?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          onResolveMyriadLandscape={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.inspectedCard.name === "Myriad Landscape"
              ? () => props.onResolveMyriadLandscape?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          onResolveBasicLandFetch={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && isBasicLandFetchAbility(props.inspectedCard)
              ? () => props.onResolveBasicLandFetch?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          sacrificeAbilities={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield"
              ? parseGenericSacrificeAbilities(props.inspectedCard.oracleText)
              : []
          }
          onActivateSacrificeAbility={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield"
              ? (abilityIndex) => props.onActivateSacrificeAbility?.(inspectedOwner.seat.id, props.inspectedCard!.id, abilityIndex)
              : undefined
          }
          tapAbilities={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && !props.inspectedCard.tapped
              ? parseGenericTapAbilities(props.inspectedCard.oracleText)
              : []
          }
          onActivateTapAbility={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield"
              ? (abilityIndex) => props.onActivateTapAbility?.(inspectedOwner.seat.id, props.inspectedCard!.id, abilityIndex)
              : undefined
          }
          selfUntapAbilities={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.inspectedCard.tapped
              ? parseSelfUntapAbilities(props.inspectedCard.oracleText)
              : []
          }
          onActivateSelfUntap={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield"
              ? (abilityIndex) => props.onActivateSelfUntap?.(inspectedOwner.seat.id, props.inspectedCard!.id, abilityIndex)
              : undefined
          }
          genericManaAbilities={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield"
              ? parseGenericManaAbilities(props.inspectedCard.oracleText)
              : []
          }
          onActivateGenericMana={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield"
              ? (abilityIndex) => props.onActivateGenericMana?.(inspectedOwner.seat.id, props.inspectedCard!.id, abilityIndex)
              : undefined
          }
          onUnlockRoomDoor={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.lockedRoomDoorFaceIndex !== undefined
              ? () => props.onUnlockRoomDoor?.(inspectedOwner.seat.id, props.inspectedCard!.id, props.lockedRoomDoorFaceIndex!)
              : undefined
          }
          onActivateEquip={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && isEquipment(props.inspectedCard) && equipCost(props.inspectedCard.oracleText) !== undefined
              ? () => props.onActivateEquip?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          onActivateManlandAnimation={
            inspectedOwner?.seat.kind === "human" &&
            inspectedOwner.zone === "battlefield" &&
            !props.inspectedCard.temporaryAnimatedAsCreature &&
            parseManlandAnimation(props.inspectedCard.oracleText) !== undefined
              ? () => props.onActivateManlandAnimation?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          // A plain "{T}: Add ..." button for a permanent that ALSO has some other ability the
          // inspector is shown for (Mind Stone's sacrifice-draw, a generic tap ability, ...) — real
          // legality (including board-state-dependent producers like Reflecting Pool/Exotic Orchard)
          // is re-checked and enforced by AppFlow's tapPermanentForMana itself, so this is only a
          // display heuristic (producedMana + a literal "{T}:" clause) for whether to show the
          // button at all; a false positive here just no-ops on click rather than acting illegally.
          onTapForMana={
            inspectedOwner?.seat.kind === "human" &&
            inspectedOwner.zone === "battlefield" &&
            !props.inspectedCard.tapped &&
            (props.inspectedCard.producedMana?.length ?? 0) > 0 &&
            /\{t\}\s*:/i.test(props.inspectedCard.oracleText)
              ? () => props.onTapForMana?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          attackTargets={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.humanAttackTargets && props.humanAttackTargets.length > 0
              ? props.humanAttackTargets
              : undefined
          }
          onDeclareAttack={
            props.onDeclareAttack ? (targetId) => props.onDeclareAttack?.(props.inspectedCard!.id, targetId) : undefined
          }
          onCastCommander={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "command"
              ? () => props.onCastCommander?.(inspectedOwner.seat.id)
              : undefined
          }
          onCastFromExile={
            inspectedOwner?.seat.kind === "human" &&
            inspectedOwner.zone === "exile" &&
            props.inspectedCard.exiledPlayableBySeatId === inspectedOwner.seat.id &&
            (props.inspectedCard.exiledPlayableUntilTurn === undefined || props.session.turn <= props.inspectedCard.exiledPlayableUntilTurn) &&
            // If a response window is open, only an instant/flash card is actually castable —
            // main-phase casting (no pendingAction) has no such restriction.
            (!props.pendingAction || canCastAtInstantSpeed(props.inspectedCard, seatHasFlashGrant(inspectedOwner.seat)))
              ? () => props.onCastFromExile?.(inspectedOwner.seat.id, props.inspectedCard!.id)
              : undefined
          }
          onChangeCounter={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.inspectedCard.typeLine.includes("Creature")
              ? (delta) => props.onChangeCounter?.(inspectedOwner.seat.id, props.inspectedCard!.id, "+1/+1", delta)
              : undefined
          }
          onChangeLoyalty={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.inspectedCard.typeLine.includes("Planeswalker")
              ? (delta) => props.onChangeCounter?.(inspectedOwner.seat.id, props.inspectedCard!.id, "loyalty", delta)
              : undefined
          }
          onActivateLoyalty={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.inspectedCard.typeLine.includes("Planeswalker")
              ? (cost, text) => props.onActivateLoyalty?.(inspectedOwner.seat.id, props.inspectedCard!.id, cost, text)
              : undefined
          }
        />
      ) : null}
      {props.manaChoice ? <ManaChoiceModal choice={props.manaChoice} onChoose={props.onChooseMana} onClose={props.onCancelManaChoice} /> : null}
      {props.myriadTapChoice ? (
        <MyriadTapChoiceModal
          choice={props.myriadTapChoice}
          onTapMana={props.onChooseMyriadTapMana}
          onSearch={props.onChooseMyriadTapSearch}
          onClose={props.onCancelMyriadTapChoice}
        />
      ) : null}
      {props.libraryLook ? (
        <LibraryLookModal
          look={props.libraryLook}
          onClose={props.onCloseLibraryLook}
          onKeepTop={props.onKeepLibraryLookCardOnTop}
          onOrderTop={props.onOrderLibraryLookCardOnTop}
          onBottom={props.onPutLibraryLookCardOnBottom}
          onGraveyard={props.onPutLibraryLookCardInGraveyard}
          onToHand={props.onSendLibraryLookCardToHand}
          onRepeatVaultLook={props.onRepeatVaultLook}
          onKeepVaultLookCards={props.onKeepVaultLookCards}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_card_from_library" ? (
        <LibrarySearchModal
          cards={props.ruleChoice.cards}
          destination={props.ruleChoice.destination}
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          allowedCardFilter={props.ruleChoice.allowedCardFilter}
          maxChoices={props.ruleChoice.maxChoices}
          chosenCount={props.ruleChoice.chosenCount}
          onFinish={props.onFinishLibrarySearch}
          onClose={props.onCloseLibrarySearch}
          onChoose={props.onSearchLibraryCardToHand}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_creature_from_graveyards" ? (
        <TargetPickerModal
          cards={props.ruleChoice.cards}
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          actionLabel={props.ruleChoice.actionLabel}
          emptyLabel="No creature cards in any graveyard."
          onClose={props.onCloseLibrarySearch}
          onChoose={props.onChooseGraveyardReanimationTarget}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_creature_to_sacrifice" ? (
        <TargetPickerModal
          cards={props.ruleChoice.cards}
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          actionLabel={props.ruleChoice.actionLabel}
          emptyLabel="No legal creature to sacrifice."
          onClose={props.onCloseLibrarySearch}
          onChoose={props.onChooseSacrificeCostTarget}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_modal_option" ? (
        <ModalOptionModal
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          options={props.ruleChoice.options}
          onChoose={props.onChooseModalOption}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_effect_target" && props.ruleChoice.zone === "graveyard" ? (
        // An optional ("you may") graveyard-zone effect (Eternal Witness's real wording) can be
        // closed/declined via the same X/backdrop every other cancelable modal uses; this phase
        // never produces a MANDATORY graveyard-zone choose_effect_target (see targetSpecs.ts), so
        // this is always safe to wire to Decline rather than the generic cancelRuleChoice.
        <TargetPickerModal
          cards={props.ruleChoice.cards}
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          actionLabel="Choose"
          emptyLabel="No legal target."
          onClose={props.onDeclineEffectTarget}
          onChoose={(seatId, cardId) => props.onChooseEffectTarget?.({ kind: "card", seatId, cardId })}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_effect_target" && props.ruleChoice.zone === "player" ? (
        <PlayerTargetModal
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          players={props.ruleChoice.players}
          onChoose={(seatId) => props.onChooseEffectTarget?.({ kind: "player", seatId })}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_proliferate_targets" ? (
        <ProliferateModal
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          cards={props.ruleChoice.cards}
          players={props.ruleChoice.players}
          onClose={props.onCloseLibrarySearch}
          onConfirm={props.onConfirmProliferateTargets}
        />
      ) : null}
      {boardTargetingChoice ? (
        // choose_creature_on_battlefield, choose_aura_attach_target, and a battlefield-zone
        // choose_effect_target are answered by clicking a highlighted card directly on the board
        // (see asBoardTargetingChoice/pickCard) rather than a modal — this banner is just the
        // prompt + a cancel/decline affordance, the board stays visible and interactive underneath
        // it. A MANDATORY choose_effect_target (rule 601.2c: a legal target exists, so one must be
        // chosen — this banner only ever opens once maybeRequestTarget already confirmed one does)
        // gets no button at all, forcing a real click instead of silently dropping the effect;
        // Decline only ever appears for an optional ("you may") one.
        <div className="targeting-banner" role="status" aria-live="polite">
          <span>{boardTargetingChoice.sourceCardName}</span>
          <strong>{boardTargetingChoice.prompt}</strong>
          {boardTargetingChoice.cards.length === 0 ? <p>No legal target.</p> : null}
          {boardTargetingChoice.kind !== "choose_effect_target" ? (
            <button type="button" onClick={props.onCloseLibrarySearch}>Cancel</button>
          ) : boardTargetingChoice.optional ? (
            <button type="button" onClick={props.onDeclineEffectTarget}>Decline</button>
          ) : null}
        </div>
      ) : null}
      {props.ruleChoice?.kind === "manual_review" ? (
        <ManualRuleChoiceModal
          choice={props.ruleChoice}
          onClose={props.onCloseLibrarySearch}
          onPayCumulativeUpkeep={props.onPayCumulativeUpkeep}
          onSacrificeSource={props.onSacrificeRuleSource}
        />
      ) : null}
      {props.ruleChoice?.kind === "order_triggers" ? (
        <OrderTriggersModal choice={props.ruleChoice} onChoose={props.onChooseNextTrigger} onClose={props.onCloseLibrarySearch} />
      ) : null}
      {props.ruleChoice?.kind === "miracle_offer" ? (
        <MiracleOfferModal choice={props.ruleChoice} onAccept={props.onAcceptMiracle} onDecline={props.onDeclineMiracle} />
      ) : null}
      {props.ruleChoice?.kind === "optional_trigger" ? (
        <OptionalTriggerModal choice={props.ruleChoice} onAccept={props.onAcceptOptionalTrigger} onDecline={props.onDeclineOptionalTrigger} />
      ) : null}
      {props.ruleChoice?.kind === "commander_zone_choice" ? (
        <CommanderZoneChoiceModal choice={props.ruleChoice} onAccept={props.onAcceptCommanderZoneChoice} onDecline={props.onDeclineCommanderZoneChoice} />
      ) : null}
      {props.ruleChoice?.kind === "discard_to_hand_size" ? (
        <DiscardToHandSizeModal choice={props.ruleChoice} onConfirm={props.onCompleteDiscardChoice} />
      ) : null}
      {props.ruleChoice?.kind === "put_cards_on_library" ? (
        <PutCardsOnLibraryModal choice={props.ruleChoice} onConfirm={props.onCompletePutCardsOnLibrary} />
      ) : null}
      {props.ruleChoice?.kind === "connive_discard" ? (
        <ConniveDiscardModal choice={props.ruleChoice} onConfirm={props.onCompleteConniveDiscard} />
      ) : null}
      {props.ruleChoice?.kind === "return_land_to_hand" ? (
        <ReturnLandToHandModal choice={props.ruleChoice} onConfirm={props.onCompleteReturnLandToHand} />
      ) : null}
      {props.ruleChoice?.kind === "choose_creature_type" ? (
        <ChooseCreatureTypeModal choice={props.ruleChoice} onChoose={props.onChooseCreatureType} />
      ) : null}
      {props.ruleChoice?.kind === "choose_color" ? (
        <ChooseColorModal choice={props.ruleChoice} onChoose={props.onChooseColor} />
      ) : null}
      {props.ruleChoice?.kind === "distribute_attack_trigger_mana" ? (
        <DistributeManaModal choice={props.ruleChoice} onConfirm={props.onConfirmAttackTriggerManaColors} />
      ) : null}
      {props.blockChoice ? (
        <BlockChoiceModal
          choice={props.blockChoice}
          selectedBlockerIds={props.selectedBlockerIds ?? []}
          onToggle={props.onToggleBlocker}
          onConfirm={props.onConfirmBlockers}
          onPass={props.onPassBlocks}
        />
      ) : null}
      {reasoningSeatId ? (
        <AgentReasoningModal
          seat={props.session.seats.find((seat) => seat.id === reasoningSeatId)}
          reasoning={props.agentReasoning?.[reasoningSeatId]}
          thinking={Boolean(props.agentThinking?.[reasoningSeatId])}
          onClose={() => setReasoningSeatId(undefined)}
        />
      ) : null}
      {props.myriadSearchCards ? (
        <MyriadSearchModal cards={props.myriadSearchCards} onClose={props.onCloseMyriadSearch} onChoose={props.onCompleteMyriadSearch} />
      ) : null}
      {props.urzaSagaSearchCards ? (
        <UrzaSagaSearchModal cards={props.urzaSagaSearchCards} onClose={props.onCloseUrzaSagaSearch} onChoose={props.onCompleteUrzaSagaSearch} />
      ) : null}
      {props.basicLandFetchSearch ? (
        <BasicLandFetchModal
          sourceCardName={props.basicLandFetchSearch.sourceCardName}
          cards={props.basicLandFetchSearch.cards}
          onClose={props.onCloseBasicLandFetchSearch}
          onChoose={props.onCompleteBasicLandFetchSearch}
        />
      ) : null}
      {zoneView ? (
        <ZoneViewerModal
          seat={props.session.seats.find((seat) => seat.id === zoneView.seatId)}
          zone={zoneView.zone}
          turn={props.session.turn}
          hasOpenResponseWindow={Boolean(props.pendingAction)}
          onClose={() => setZoneView(undefined)}
          onInspect={(card) => {
            setZoneView(undefined);
            props.onInspectCard?.(card);
          }}
          onMoveToHand={(cardId) => {
            props.onMoveCardToHand?.(zoneView.seatId, cardId);
            setZoneView(undefined);
          }}
          onCastFromExile={(cardId) => {
            props.onCastFromExile?.(zoneView.seatId, cardId);
            setZoneView(undefined);
          }}
        />
      ) : null}
      {priorityStopsOpen ? (
        <PriorityStopsModal
          settings={props.priorityStopSettings ?? DEFAULT_STOP_SETTINGS}
          seats={props.session.seats}
          onClose={() => setPriorityStopsOpen(false)}
          onTogglePhaseStop={props.onTogglePhaseStop}
          onToggleStopOnStackResponse={props.onToggleStopOnStackResponse}
          onToggleStopOnAttacked={props.onToggleStopOnAttacked}
          onToggleStopOnTargeted={props.onToggleStopOnTargeted}
        />
      ) : null}
      <div className="three-hand-panel" aria-label="Your hand">
        <div className="three-zone-strip">
          <div className="three-hand-heading">
            <strong>Your hand</strong>
            <span>{human.board.hand.length} cards</span>
          </div>
          <div className="three-hand-row" onDragOver={onHandDragOver} onDrop={onHandDrop}>
            {human.board.hand.map((card) => (
              <article
                className={`three-hand-card ${props.selectedCardId === card.id || props.mulliganReturnCardIds?.includes(card.id) ? "selected" : ""} ${draggingHandCardId === card.id ? "dragging" : ""}`}
                draggable={props.gameStage === "playing"}
                key={card.id}
                onClick={() => {
                  if (props.gameStage === "mulligan" && mulliganRequired > 0) {
                    props.onToggleMulliganReturnCard?.(card);
                    return;
                  }
                  props.onInspectCard?.(card);
                  props.onSelectHandCard?.(card);
                }}
                onDragStart={(event) => onCardDragStart(event, card, "hand")}
                onDragEnd={onCardDragEnd}
                title={`${card.name}\n${card.typeLine}\n${card.oracleText}`}
              >
                {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" draggable={false} /> : <FallbackHandCard card={card} />}
                <span className="sr-only">{card.name}</span>
              </article>
            ))}
            {draggingZone === "graveyard" ? <div className="zone-drop-hint">Drop here to return to hand</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function getDraggedCard(event: DragEvent<HTMLElement>) {
  const raw = event.dataTransfer.getData("application/x-mtg-card");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<{ cardId: string; zone: DraggedZone }>;
      if (parsed.cardId && (parsed.zone === "hand" || parsed.zone === "graveyard" || parsed.zone === "exile")) return { cardId: parsed.cardId, zone: parsed.zone };
    } catch {
      return { cardId: "", zone: undefined };
    }
  }
  return { cardId: event.dataTransfer.getData("text/plain"), zone: undefined };
}

function findCardOwner(session: GameSession, cardId: string) {
  for (const seat of session.seats) {
    if (seat.board.commander?.id === cardId) return { seat, zone: "command" as const };
    if (seat.board.hand.some((card) => card.id === cardId)) return { seat, zone: "hand" as const };
    if (seat.board.battlefield.some((card) => card.id === cardId)) return { seat, zone: "battlefield" as const };
    if ((seat.board.graveyard ?? []).some((card) => card.id === cardId)) return { seat, zone: "graveyard" as const };
    if ((seat.board.exile ?? []).some((card) => card.id === cardId)) return { seat, zone: "exile" as const };
  }
  return undefined;
}

function CardInspector({
  card,
  owner,
  onClose,
  onMoveToGraveyard,
  onMoveToExile,
  onResolveMyriadLandscape,
  onResolveBasicLandFetch,
  onUnlockRoomDoor,
  sacrificeAbilities,
  onActivateSacrificeAbility,
  tapAbilities,
  onActivateTapAbility,
  selfUntapAbilities,
  onActivateSelfUntap,
  genericManaAbilities,
  onActivateGenericMana,
  onActivateEquip,
  onActivateManlandAnimation,
  onTapForMana,
  attackTargets,
  onDeclareAttack,
  onCastCommander,
  onChangeCounter,
  onChangeLoyalty,
  onActivateLoyalty,
  onCastFromExile
}: {
  card: VisibleCard;
  owner?: ReturnType<typeof findCardOwner>;
  onClose?: () => void;
  onMoveToGraveyard?: () => void;
  onMoveToExile?: () => void;
  onResolveMyriadLandscape?: () => void;
  onResolveBasicLandFetch?: () => void;
  onUnlockRoomDoor?: () => void;
  sacrificeAbilities?: SacrificeAbility[];
  onActivateSacrificeAbility?: (abilityIndex: number) => void;
  tapAbilities?: GenericTapAbility[];
  onActivateTapAbility?: (abilityIndex: number) => void;
  selfUntapAbilities?: SelfUntapAbility[];
  onActivateSelfUntap?: (abilityIndex: number) => void;
  genericManaAbilities?: GenericManaAbility[];
  onActivateGenericMana?: (abilityIndex: number) => void;
  onActivateEquip?: () => void;
  onActivateManlandAnimation?: () => void;
  onTapForMana?: () => void;
  attackTargets?: Array<{ targetId: string; label: string }>;
  onDeclareAttack?: (targetId: string) => void;
  onCastCommander?: () => void;
  onChangeCounter?: (delta: number) => void;
  onChangeLoyalty?: (delta: number) => void;
  onActivateLoyalty?: (loyaltyCost: number, abilityText: string) => void;
  onCastFromExile?: () => void;
}) {
  const imageUrl = card.imageUris?.large ?? card.imageUris?.normal ?? card.imageUris?.png ?? card.faces?.[0]?.imageUris?.large ?? card.faces?.[0]?.imageUris?.normal;
  const colorText = card.colors.length > 0 ? card.colors.join("") : "Colorless";
  const identityText = card.colorIdentity && card.colorIdentity.length > 0 ? card.colorIdentity.join("") : colorText;
  const faces = card.faces?.filter((face) => face.name !== card.name) ?? [];
  const plusCounters = card.counters?.find((counter) => counter.kind === "+1/+1")?.count ?? 0;
  const loyaltyCounters = card.counters?.find((counter) => counter.kind === "loyalty")?.count ?? 0;
  const loyaltyAbilities = parseLoyaltyAbilities(card.oracleText);

  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`${card.name} card detail`} onClick={onClose}>
      <article className="card-inspector" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close card detail">
          x
        </button>
        <div className="card-inspector-image">
          {imageUrl ? <img src={imageUrl} alt="" /> : <FallbackLargeCard card={card} />}
        </div>
        <div className="card-inspector-detail">
          <div>
            <p className="eyebrow">{owner?.zone ?? card.zone}</p>
            <h2>{card.name}</h2>
            <span>{card.typeLine}</span>
          </div>
          {onMoveToGraveyard ? (
            <button className="inspector-action" type="button" onClick={onMoveToGraveyard}>
              Move To Graveyard
            </button>
          ) : null}
          {onMoveToExile ? (
            <button className="inspector-action" type="button" onClick={onMoveToExile}>
              Move To Exile
            </button>
          ) : null}
          {onResolveMyriadLandscape ? (
            <button className="inspector-action" type="button" onClick={onResolveMyriadLandscape}>
              Resolve Myriad Landscape
            </button>
          ) : null}
          {onResolveBasicLandFetch ? (
            <button className="inspector-action" type="button" onClick={onResolveBasicLandFetch}>
              Resolve {card.name}
            </button>
          ) : null}
          {onUnlockRoomDoor ? (
            <button className="inspector-action" type="button" onClick={onUnlockRoomDoor}>
              Unlock Other Door
            </button>
          ) : null}
          {onTapForMana ? (
            <button className="inspector-action" type="button" onClick={onTapForMana}>
              Tap for Mana
            </button>
          ) : null}
          {onActivateEquip ? (
            <button className="inspector-action" type="button" onClick={onActivateEquip}>
              Equip {card.name}
            </button>
          ) : null}
          {onActivateManlandAnimation ? (
            <button className="inspector-action" type="button" onClick={onActivateManlandAnimation}>
              Become a creature
            </button>
          ) : null}
          {sacrificeAbilities && sacrificeAbilities.length > 0 ? (
            <div className="modal-actions" aria-label="Sacrifice ability options">
              {sacrificeAbilities.map((ability, abilityIndex) => (
                <button key={abilityIndex} className="inspector-action" type="button" onClick={() => onActivateSacrificeAbility?.(abilityIndex)}>
                  {ability.clause}
                </button>
              ))}
            </div>
          ) : null}
          {tapAbilities && tapAbilities.length > 0 ? (
            <div className="modal-actions" aria-label="Tap ability options">
              {tapAbilities.map((ability, abilityIndex) => (
                <button key={abilityIndex} className="inspector-action" type="button" onClick={() => onActivateTapAbility?.(abilityIndex)}>
                  {ability.clause}
                </button>
              ))}
            </div>
          ) : null}
          {selfUntapAbilities && selfUntapAbilities.length > 0 ? (
            <div className="modal-actions" aria-label="Untap ability options">
              {selfUntapAbilities.map((ability, abilityIndex) => (
                <button key={abilityIndex} className="inspector-action" type="button" onClick={() => onActivateSelfUntap?.(abilityIndex)}>
                  {ability.clause}
                </button>
              ))}
            </div>
          ) : null}
          {genericManaAbilities && genericManaAbilities.length > 0 ? (
            <div className="modal-actions" aria-label="Activated ability options">
              {genericManaAbilities.map((ability, abilityIndex) => (
                <button key={abilityIndex} className="inspector-action" type="button" onClick={() => onActivateGenericMana?.(abilityIndex)}>
                  {ability.clause}
                </button>
              ))}
            </div>
          ) : null}
          {attackTargets && attackTargets.length > 0 ? (
            <div className="modal-actions" aria-label="Attack target options">
              {attackTargets.map((target) => (
                <button key={target.targetId} className="inspector-action" type="button" onClick={() => onDeclareAttack?.(target.targetId)}>
                  {target.label}
                </button>
              ))}
            </div>
          ) : null}
          {onCastCommander ? (
            <button className="inspector-action" type="button" onClick={onCastCommander}>
              Cast Commander{card.commanderTax ? ` (+${card.commanderTax})` : ""}
            </button>
          ) : null}
          {onCastFromExile ? (
            <button className="inspector-action" type="button" onClick={onCastFromExile}>
              Cast from Exile
            </button>
          ) : null}
          {onChangeCounter ? (
            <div className="counter-controls" aria-label="+1/+1 counter controls">
              <button className="inspector-action" type="button" onClick={() => onChangeCounter(-1)} disabled={plusCounters === 0}>
                Remove +1/+1
              </button>
              <strong>+1/+1: {plusCounters}</strong>
              <button className="inspector-action" type="button" onClick={() => onChangeCounter(1)}>
                +1/+1
              </button>
            </div>
          ) : null}
          {onChangeLoyalty ? (
            <div className="counter-controls" aria-label="loyalty counter controls">
              <button className="inspector-action" type="button" onClick={() => onChangeLoyalty(-1)} disabled={loyaltyCounters === 0}>
                Remove Loyalty
              </button>
              <strong>Loyalty: {loyaltyCounters}</strong>
              <button className="inspector-action" type="button" onClick={() => onChangeLoyalty(1)}>
                + Loyalty
              </button>
            </div>
          ) : null}
          {onActivateLoyalty && loyaltyAbilities.length > 0 ? (
            <div className="counter-controls" aria-label="loyalty ability controls">
              {loyaltyAbilities.map((ability) => (
                <button className="inspector-action" type="button" key={`${ability.cost}:${ability.text}`} onClick={() => onActivateLoyalty(ability.cost, ability.text)}>
                  {formatLoyaltyCost(ability.cost)}: {ability.text}
                </button>
              ))}
            </div>
          ) : null}
          <p>{card.oracleText}</p>
          {faces.length > 0 ? (
            <div className="card-inspector-faces">
              {faces.map((face) => (
                <section key={face.name}>
                  <strong>{face.name}</strong>
                  <span>{face.typeLine}</span>
                  <p>{face.oracleText}</p>
                </section>
              ))}
            </div>
          ) : null}
          <dl>
            <div>
              <dt>Mana Value</dt>
              <dd>{card.manaValue}</dd>
            </div>
            <div>
              <dt>Colors</dt>
              <dd>{colorText}</dd>
            </div>
            <div>
              <dt>Identity</dt>
              <dd>{identityText}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{card.role}</dd>
            </div>
            {card.power && card.toughness ? (
              <div>
                <dt>Power / Toughness</dt>
                <dd>{effectivePower(card)}/{effectiveToughness(card)}</dd>
              </div>
            ) : null}
            {card.counters && card.counters.length > 0 ? (
              <div>
                <dt>Counters</dt>
                <dd>{card.counters.map((counter) => `${counter.count} ${counter.kind}`).join(", ")}</dd>
              </div>
            ) : null}
            {card.commander ? (
              <div>
                <dt>Commander</dt>
                <dd>Yes</dd>
              </div>
            ) : null}
            {card.typeLine.includes("Planeswalker") ? (
              <div>
                <dt>Loyalty</dt>
                <dd>{loyaltyCounters}</dd>
              </div>
            ) : null}
            {card.zone === "battlefield" ? (
              <div>
                <dt>Status</dt>
                <dd>{battlefieldStatusText(card) || "Ready"}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </article>
    </div>
  );
}

function ManaChoiceModal({
  choice,
  onChoose,
  onClose
}: {
  choice: { cardName: string; choices: ManaColor[] };
  onChoose?: (color: ManaColor) => void;
  onClose?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Choose mana for ${choice.cardName}`} onClick={onClose}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close mana choice">
          x
        </button>
        <header>
          <p className="eyebrow">Tap for mana</p>
          <h2>{choice.cardName}</h2>
        </header>
        <div className="mana-choice-grid">
          {choice.choices.map((color) => (
            <button className={`mana-choice-button mana-${color.toLowerCase()}`} type="button" key={color} onClick={() => onChoose?.(color)}>
              {color}
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

function MyriadTapChoiceModal({
  choice,
  onTapMana,
  onSearch,
  onClose
}: {
  choice: { cardName: string };
  onTapMana?: () => void;
  onSearch?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Choose ability for ${choice.cardName}`} onClick={onClose}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close ability choice">
          x
        </button>
        <header>
          <p className="eyebrow">Choose an ability</p>
          <h2>{choice.cardName}</h2>
        </header>
        <div className="mode-switch" role="group" aria-label="Myriad Landscape ability">
          <button className="inspector-action" type="button" onClick={onTapMana}>
            Tap for {"{C}"}
          </button>
          <button className="inspector-action" type="button" onClick={onSearch}>
            {"{2}"}, Sacrifice: Search two basic lands
          </button>
        </div>
      </article>
    </div>
  );
}

function LibraryLookModal({
  look,
  onClose,
  onKeepTop,
  onOrderTop,
  onBottom,
  onGraveyard,
  onToHand,
  onRepeatVaultLook,
  onKeepVaultLookCards
}: {
  look: LibraryLookState;
  onClose?: () => void;
  onKeepTop?: (cardId: string) => void;
  onOrderTop?: (cardId: string) => void;
  onBottom?: (cardId: string) => void;
  onGraveyard?: (cardId: string) => void;
  onToHand?: (cardId: string) => void;
  onRepeatVaultLook?: () => void;
  onKeepVaultLookCards?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`${look.mode} library cards`} onClick={onClose}>
      <article className="library-look-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close library look">
          x
        </button>
        <header>
          <p className="eyebrow">{look.mode}</p>
          <h2>
            {look.mode === "scry"
              ? `Scry ${look.remaining}`
              : look.mode === "reorder"
                ? "Choose Order"
                : look.mode === "choose_one"
                  ? `Top ${look.cards.length}`
                  : look.mode === "vault_look"
                    ? `Top ${look.cards.length}`
                    : "Top of library"}
          </h2>
          <p>
            {look.mode === "surveil"
              ? "Choose each card for the top of your library or your graveyard. The last card you put on top will be the top card."
              : look.mode === "reorder"
                ? "Place the cards back in any order you like — the last one you place ends up on top of your library."
                : look.mode === "choose_one"
                  ? "Choose one card to put into your hand. The rest go back on top — you'll then order them."
                  : look.mode === "vault_look"
                    ? "Pay 1 life to put these on the bottom and look at the next 5, as many times as you like — or keep these and choose the order to put them back on top."
                    : "Choose Top to keep this card and finish scrying, or Bottom to look at the next card."}
          </p>
          {look.mode === "reorder" && look.orderedCards?.length ? (
            <span>Chosen: {look.orderedCards.map((card) => card.name).join(" -> ")}</span>
          ) : null}
          {look.mode === "vault_look" ? (
            <div className="modal-actions">
              <button type="button" onClick={onRepeatVaultLook} disabled={look.cards.length === 0}>
                Pay 1 life, look at next 5
              </button>
              <button type="button" onClick={onKeepVaultLookCards}>
                Keep these, choose order
              </button>
            </div>
          ) : null}
        </header>
        <div className="library-look-row">
          {look.cards.length === 0 ? <p>No cards to look at.</p> : null}
          {look.cards.map((card) => (
            <article className="library-look-card" key={card.id}>
              <div className="library-look-image">
                {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" /> : <FallbackLargeCard card={card} />}
              </div>
              <strong>{card.name}</strong>
              <span>{card.typeLine}</span>
              {look.mode === "vault_look" ? null : (
                <div className="library-look-actions">
                  {look.mode === "reorder" ? (
                    <button type="button" onClick={() => onOrderTop?.(card.id)}>Place Next</button>
                  ) : look.mode === "choose_one" ? (
                    <button type="button" onClick={() => onToHand?.(card.id)}>To Hand</button>
                  ) : (
                    <button type="button" onClick={() => onKeepTop?.(card.id)}>Top</button>
                  )}
                  {look.mode === "scry" ? <button type="button" onClick={() => onBottom?.(card.id)}>Bottom</button> : null}
                  {look.mode === "surveil" ? <button type="button" onClick={() => onGraveyard?.(card.id)}>Graveyard</button> : null}
                </div>
              )}
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

function LibrarySearchModal({
  cards,
  destination,
  prompt,
  sourceCardName,
  allowedCardFilter,
  maxChoices,
  chosenCount,
  onClose,
  onChoose,
  onFinish
}: {
  cards: VisibleCard[];
  destination: "hand" | "battlefield" | "graveyard" | "library";
  prompt?: string;
  sourceCardName?: string;
  allowedCardFilter?: string;
  maxChoices?: number;
  chosenCount?: number;
  onClose?: () => void;
  onChoose?: (cardId: string) => void;
  onFinish?: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCards = normalizedQuery
    ? cards.filter((card) => `${card.name} ${card.typeLine} ${card.oracleText}`.toLowerCase().includes(normalizedQuery))
    : cards;
  // "Up to N"/"N" (Archaeomancer's Map's "up to two basic Plains cards," ...) — only relevant once
  // there's actually more than one to pick; a plain single-card search (maxChoices undefined or 1)
  // keeps its old one-click-and-done behavior with no progress/Done UI at all.
  const isMultiPick = (maxChoices ?? 1) > 1;

  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Search library" onClick={onClose}>
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close library search">
          x
        </button>
        <header>
          <p className="eyebrow">{sourceCardName ?? "Library"}</p>
          <h2>Search Library</h2>
          {prompt ? <p>{prompt}</p> : null}
          {allowedCardFilter ? <span>{allowedCardFilter}</span> : null}
          {isMultiPick ? (
            <p>
              Chosen {chosenCount ?? 0} of up to {maxChoices}.
              {(chosenCount ?? 0) > 0 ? (
                <button type="button" onClick={onFinish}>
                  Done
                </button>
              ) : null}
            </p>
          ) : null}
        </header>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by card name, type, or text" />
        <div className="library-search-results">
          {filteredCards.length === 0 ? <p>No matching cards.</p> : null}
          {filteredCards.map((card) => (
            <article className="library-search-card" key={card.id}>
              <div>
                <strong>{card.name}</strong>
                <span>{card.typeLine}</span>
              </div>
              <button type="button" onClick={() => onChoose?.(card.id)}>
                {destination === "battlefield"
                  ? "To Battlefield"
                  : destination === "graveyard"
                    ? "To Graveyard"
                    : destination === "library"
                      ? "To Top of Library"
                      : "To Hand"}
              </button>
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

// Virtue of Persistence's "put target creature card from a graveyard onto the battlefield under
// your control" — pooled across every player's graveyard (see ruleChoiceView's own comment), so
// each card carries which seat it's actually sitting in, shown as an owner label since the same
// card name could otherwise appear from two different graveyards at once.
// Shared by both graveyard-sourced (Virtue of Persistence's "creature card from a graveyard") and
// battlefield-sourced (Athreos's "another target creature") target choices — same list-and-pick
// shape either way, just a different pool, zone label, and action-button wording.
// Card-art target picker for choices whose legal pool has no battlefield presence to click
// directly (graveyards and libraries aren't rendered per-card in the 3D scene — see
// asBoardTargetingChoice's comment). Reuses VisualCard (previously only wired to the legacy 2D
// board) instead of a plain name-and-button list, so the player can actually read the card they're
// picking the same way they can on the board.
function TargetPickerModal({
  cards,
  prompt,
  sourceCardName,
  actionLabel,
  emptyLabel,
  onClose,
  onChoose
}: {
  cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
  prompt?: string;
  sourceCardName?: string;
  actionLabel: string;
  emptyLabel: string;
  onClose?: () => void;
  onChoose?: (seatId: string, cardId: string) => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={sourceCardName ?? "Choose a target"} onClick={onClose}>
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close target choice">
          x
        </button>
        <header>
          <p className="eyebrow">{sourceCardName ?? "Choose a target"}</p>
          <h2>Choose a Target</h2>
          {prompt ? <p>{prompt}</p> : null}
        </header>
        <div className="target-picker-row">
          {cards.length === 0 ? <p>{emptyLabel}</p> : null}
          {cards.map(({ card, seatId, seatName }) => (
            <div className="target-picker-entry" key={card.id}>
              <VisualCard card={card} compact onClick={() => onChoose?.(seatId, card.id)} />
              <span>{seatName}</span>
              <button type="button" onClick={() => onChoose?.(seatId, card.id)}>
                {actionLabel}
              </button>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

// "Choose one —" mode picker (Cankerbloom's Destroy Artifact / Destroy Enchantment / Proliferate,
// and any other modal removal-shaped ability) — one button per currently-legal mode, same
// .card-inspector-backdrop + panel pattern as ManualRuleChoiceModal below.
function ModalOptionModal({
  prompt,
  sourceCardName,
  options,
  onChoose
}: {
  prompt?: string;
  sourceCardName?: string;
  options: Array<{ index: number; label: string }>;
  onChoose?: (index: number) => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={sourceCardName ?? "Choose one"}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{sourceCardName ?? "Choose one"}</p>
          <h2>Choose One</h2>
          {prompt ? <p>{prompt}</p> : null}
        </header>
        <div className="modal-actions">
          {options.map((option) => (
            <button key={option.index} className="inspector-action" type="button" onClick={() => onChoose?.(option.index)}>
              {option.label}
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

// A single-target-player choice (choose_effect_target with spec.zone "player" — currently just a
// direct-damage spell's "target player" mode) — one button per legal player, same
// .card-inspector-backdrop + panel pattern as ModalOptionModal just above.
function PlayerTargetModal({
  prompt,
  sourceCardName,
  players,
  onChoose
}: {
  prompt?: string;
  sourceCardName?: string;
  players: Array<{ seatId: string; seatName: string }>;
  onChoose?: (seatId: string) => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={sourceCardName ?? "Choose a target"}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{sourceCardName ?? "Choose a target"}</p>
          <h2>Choose a Target</h2>
          {prompt ? <p>{prompt}</p> : null}
        </header>
        <div className="modal-actions">
          {players.map((player) => (
            <button key={player.seatId} className="inspector-action" type="button" onClick={() => onChoose?.(player.seatId)}>
              {player.seatName}
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

// "Choose any number of permanents and/or players that have a counter on them" (real Proliferate,
// rule 121.9) — unlike TargetPickerModal's single-click-to-choose interaction, this accumulates a
// selection (checkboxes) and applies it all at once via a Confirm button; choosing zero of anything
// is legal ("any number" includes none), so Confirm is never disabled.
function ProliferateModal({
  prompt,
  sourceCardName,
  cards,
  players,
  onClose,
  onConfirm
}: {
  prompt?: string;
  sourceCardName?: string;
  cards: Array<{ card: VisibleCard; seatId: string; seatName: string }>;
  players: Array<{ seatId: string; seatName: string; countersLabel: string }>;
  onClose?: () => void;
  onConfirm?: (cardIds: string[], playerSeatIds: string[]) => void;
}) {
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const toggleCard = (cardId: string) =>
    setSelectedCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  const togglePlayer = (seatId: string) =>
    setSelectedPlayerIds((current) => {
      const next = new Set(current);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={sourceCardName ?? "Proliferate"} onClick={onClose}>
      <article className="library-look-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close proliferate choice">
          x
        </button>
        <header>
          <p className="eyebrow">{sourceCardName ?? "Proliferate"}</p>
          <h2>Proliferate</h2>
          {prompt ? <p>{prompt}</p> : null}
        </header>
        {players.length > 0 ? (
          <div className="modal-actions" aria-label="Players with counters">
            {players.map((player) => (
              <label key={player.seatId} className="inspector-action">
                <input type="checkbox" checked={selectedPlayerIds.has(player.seatId)} onChange={() => togglePlayer(player.seatId)} />
                {player.seatName} ({player.countersLabel})
              </label>
            ))}
          </div>
        ) : null}
        <div className="target-picker-row">
          {cards.length === 0 && players.length === 0 ? <p>No permanents or players have a counter.</p> : null}
          {cards.map(({ card, seatName }) => (
            <div className="target-picker-entry" key={card.id}>
              <VisualCard card={card} compact selected={selectedCardIds.has(card.id)} onClick={() => toggleCard(card.id)} />
              <span>{seatName}</span>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => onConfirm?.([...selectedCardIds], [...selectedPlayerIds])}>
          Proliferate Selected ({selectedCardIds.size + selectedPlayerIds.size})
        </button>
      </article>
    </div>
  );
}

function ManualRuleChoiceModal({
  choice,
  onClose,
  onPayCumulativeUpkeep,
  onSacrificeSource
}: {
  choice: Extract<RuleChoiceView, { kind: "manual_review" }>;
  onClose?: () => void;
  onPayCumulativeUpkeep?: () => void;
  onSacrificeSource?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Rules review for ${choice.sourceCardName}`} onClick={onClose}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close rules review">
          x
        </button>
        <header>
          <p className="eyebrow">Rules choice</p>
          <h2>{choice.sourceCardName}</h2>
        </header>
        <p>{choice.prompt}</p>
        {choice.isCumulativeUpkeep ? (
          <div className="modal-actions">
            <button className="inspector-action" type="button" onClick={onPayCumulativeUpkeep}>
              Pay {choice.cumulativeUpkeepCost ?? 1}
            </button>
            <button className="inspector-action" type="button" onClick={onSacrificeSource}>
              Sacrifice
            </button>
          </div>
        ) : null}
        <button type="button" onClick={onClose}>Acknowledge</button>
      </article>
    </div>
  );
}

function PriorityStopsModal({
  settings,
  seats,
  onClose,
  onTogglePhaseStop,
  onToggleStopOnStackResponse,
  onToggleStopOnAttacked,
  onToggleStopOnTargeted
}: {
  settings: PriorityStopSettings;
  seats: PlayerSeat[];
  onClose?: () => void;
  onTogglePhaseStop?: (phase: string, seatIndex: number) => void;
  onToggleStopOnStackResponse?: () => void;
  onToggleStopOnAttacked?: () => void;
  onToggleStopOnTargeted?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Priority stops" onClick={onClose}>
      <article className="library-look-modal priority-stops-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close priority stops">
          x
        </button>
        <header>
          <p className="eyebrow">Priority</p>
          <h2>Priority Stops</h2>
        </header>
        <p>Tick a phase to always get priority there. Everything else auto-passes unless you have a real response to something.</p>
        <div className="priority-stops-grid-wrap">
          <table className="priority-stops-grid">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                {seats.map((seat) => (
                  <th scope="col" key={seat.id}>
                    {seat.kind === "human" ? "My turn" : seat.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TURN_PHASES.map((phase) => (
                <tr key={phase}>
                  <th scope="row">{phase}</th>
                  {seats.map((seat, seatIndex) => (
                    <td key={seat.id}>
                      <input
                        type="checkbox"
                        aria-label={`Stop at ${phase} on ${seat.kind === "human" ? "my turn" : `${seat.name}'s turn`}`}
                        checked={Boolean(settings.phaseStops[stopKey(phase, seatIndex)])}
                        onChange={() => onTogglePhaseStop?.(phase, seatIndex)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="priority-stops-toggles">
          <label>
            <input type="checkbox" checked={settings.stopOnStackResponse} onChange={onToggleStopOnStackResponse} />
            Stop when I have a response to something on the stack
          </label>
          <label>
            <input type="checkbox" checked={settings.stopOnAttacked} onChange={onToggleStopOnAttacked} />
            Stop when I&apos;m attacked
          </label>
          <label>
            <input type="checkbox" checked={settings.stopOnTargeted} onChange={onToggleStopOnTargeted} />
            Stop when I or my permanents are targeted
          </label>
        </div>
        <button type="button" onClick={onClose}>Done</button>
      </article>
    </div>
  );
}

function MiracleOfferModal({
  choice,
  onAccept,
  onDecline
}: {
  choice: Extract<RuleChoiceView, { kind: "miracle_offer" }>;
  onAccept?: (faceIndex?: number) => void;
  onDecline?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Miracle offer for ${choice.sourceCardName}`} onClick={onDecline}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">Miracle</p>
          <h2>{choice.sourceCardName}</h2>
        </header>
        <p>{choice.prompt}</p>
        <div className="modal-actions">
          {choice.doorFaces ? (
            choice.doorFaces.map((doorName, faceIndex) => (
              <button key={doorName} className="inspector-action" type="button" onClick={() => onAccept?.(faceIndex)}>
                Cast {doorName} ({choice.miracleCost})
              </button>
            ))
          ) : (
            <button className="inspector-action" type="button" onClick={() => onAccept?.()}>
              Cast for Miracle Cost ({choice.miracleCost})
            </button>
          )}
          <button className="inspector-action" type="button" onClick={onDecline}>
            Decline
          </button>
        </div>
      </article>
    </div>
  );
}

const AGENT_REASONING_PURPOSE_LABELS: Record<string, string> = {
  main_phase: "Main phase",
  declare_attackers: "Declaring attackers",
  priority_response: "Responding to the stack",
  declare_blockers: "Declaring blockers"
};

function AgentReasoningModal({
  seat,
  reasoning,
  thinking,
  onClose
}: {
  seat?: PlayerSeat;
  reasoning?: AgentReasoning;
  thinking: boolean;
  onClose?: () => void;
}) {
  const seatName = seat?.name ?? "Agent";
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`${seatName} thinking`} onClick={onClose}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">🧠 Thinking</p>
          <h2>{seatName}</h2>
        </header>
        {thinking ? (
          <p>{seatName} is deciding{reasoning ? " again" : ""}...</p>
        ) : reasoning ? (
          <>
            <p className="agent-reasoning-purpose">{AGENT_REASONING_PURPOSE_LABELS[reasoning.purpose] ?? reasoning.purpose}</p>
            {reasoning.deliberation ? (
              <div className="agent-reasoning-deliberation">
                <p className="agent-reasoning-deliberation-label">Arguing it out</p>
                <p className="agent-reasoning-deliberation-text">{reasoning.deliberation}</p>
              </div>
            ) : null}
            <p className="agent-reasoning-label">Chose: {reasoning.label}</p>
            <p>{reasoning.reason || "No reasoning was given for this decision."}</p>
          </>
        ) : (
          <p>No decision yet this game.</p>
        )}
        <div className="modal-actions">
          <button className="inspector-action" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </article>
    </div>
  );
}

function OptionalTriggerModal({
  choice,
  onAccept,
  onDecline
}: {
  choice: Extract<RuleChoiceView, { kind: "optional_trigger" }>;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Optional trigger for ${choice.sourceCardName}`} onClick={onDecline}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">You may</p>
          <h2>{choice.sourceCardName}</h2>
        </header>
        <p>{choice.prompt}</p>
        <div className="modal-actions">
          <button className="inspector-action" type="button" onClick={onAccept}>
            Yes
          </button>
          <button className="inspector-action" type="button" onClick={onDecline}>
            No
          </button>
        </div>
      </article>
    </div>
  );
}

// Rule 903.9a: a commander that would go to the graveyard may be put into the command zone
// instead — owner's choice, not automatic. Same shape as OptionalTriggerModal above, just its own
// component since RuleChoiceView keys the two kinds separately.
function CommanderZoneChoiceModal({
  choice,
  onAccept,
  onDecline
}: {
  choice: Extract<RuleChoiceView, { kind: "commander_zone_choice" }>;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Command zone choice for ${choice.sourceCardName}`} onClick={onDecline}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">Commander in graveyard</p>
          <h2>{choice.sourceCardName}</h2>
        </header>
        <p>{choice.prompt}</p>
        <div className="modal-actions">
          <button className="inspector-action" type="button" onClick={onAccept}>
            Move to command zone
          </button>
          <button className="inspector-action" type="button" onClick={onDecline}>
            Leave in graveyard
          </button>
        </div>
      </article>
    </div>
  );
}

function DiscardToHandSizeModal({
  choice,
  onConfirm
}: {
  choice: Extract<RuleChoiceView, { kind: "discard_to_hand_size" }>;
  onConfirm?: (cardIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(cardId: string) {
    setSelected((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      if (current.length >= choice.requiredDiscards) return current;
      return [...current, cardId];
    });
  }

  // No backdrop-dismiss: cleanup-step discard is a required action (rule 514.2), not an optional
  // review, so unlike the other rule-choice modals this one has nothing for onClick to call.
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Discard to hand size">
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">Cleanup step</p>
          <h2>Discard to hand size</h2>
        </header>
        <p>{choice.prompt}</p>
        <p>
          Selected {selected.length}/{choice.requiredDiscards}
        </p>
        <div className="modal-actions discard-hand-list">
          {choice.hand.map((card) => (
            <button
              key={card.id}
              type="button"
              className="inspector-action"
              aria-pressed={selected.includes(card.id)}
              onClick={() => toggle(card.id)}
            >
              {selected.includes(card.id) ? "✓ " : ""}
              {card.name}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button
            className="inspector-action"
            type="button"
            disabled={selected.length !== choice.requiredDiscards}
            onClick={() => onConfirm?.(selected)}
          >
            Discard {choice.requiredDiscards} card{choice.requiredDiscards === 1 ? "" : "s"}
          </button>
        </div>
      </article>
    </div>
  );
}

function PutCardsOnLibraryModal({
  choice,
  onConfirm
}: {
  choice: Extract<RuleChoiceView, { kind: "put_cards_on_library" }>;
  onConfirm?: (cardIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(cardId: string) {
    setSelected((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      if (current.length >= choice.requiredCount) return current;
      return [...current, cardId];
    });
  }

  // No backdrop-dismiss: this is a mandatory part of resolving the source ability (e.g. Aminatou,
  // the Fateshifter's +1), not an optional review — same reasoning as DiscardToHandSizeModal.
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Put cards on top of library for ${choice.sourceCardName}`}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{choice.sourceCardName}</p>
          <h2>Put cards on top of library</h2>
        </header>
        <p>{choice.prompt}</p>
        <p>
          Selected {selected.length}/{choice.requiredCount}
        </p>
        <div className="modal-actions discard-hand-list">
          {choice.hand.map((card) => (
            <button
              key={card.id}
              type="button"
              className="inspector-action"
              aria-pressed={selected.includes(card.id)}
              onClick={() => toggle(card.id)}
            >
              {selected.includes(card.id) ? "✓ " : ""}
              {card.name}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button
            className="inspector-action"
            type="button"
            disabled={selected.length !== choice.requiredCount}
            onClick={() => onConfirm?.(selected)}
          >
            Put {choice.requiredCount} card{choice.requiredCount === 1 ? "" : "s"} on top
          </button>
        </div>
      </article>
    </div>
  );
}

function ConniveDiscardModal({
  choice,
  onConfirm
}: {
  choice: Extract<RuleChoiceView, { kind: "connive_discard" }>;
  onConfirm?: (cardIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  // No backdrop-dismiss: connive's discard is a mandatory part of resolving the source ability,
  // not an optional review — same reasoning as PutCardsOnLibraryModal/DiscardToHandSizeModal.
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`${choice.sourceCardName} connives`}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{choice.sourceCardName}</p>
          <h2>Connive: choose a card to discard</h2>
        </header>
        <p>{choice.prompt}</p>
        <div className="modal-actions discard-hand-list">
          {choice.hand.map((card) => (
            <button
              key={card.id}
              type="button"
              className="inspector-action"
              aria-pressed={selected === card.id}
              onClick={() => setSelected(card.id)}
            >
              {selected === card.id ? "✓ " : ""}
              {card.name}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="inspector-action" type="button" disabled={!selected} onClick={() => onConfirm?.(selected ? [selected] : [])}>
            Discard
          </button>
        </div>
      </article>
    </div>
  );
}

function ReturnLandToHandModal({
  choice,
  onConfirm
}: {
  choice: Extract<RuleChoiceView, { kind: "return_land_to_hand" }>;
  onConfirm?: (cardIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  // No backdrop-dismiss: this bounce is a mandatory part of resolving the source land, not an
  // optional review — same reasoning as ConniveDiscardModal.
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`${choice.sourceCardName}: return a land`}>
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{choice.sourceCardName}</p>
          <h2>Return a land to your hand</h2>
        </header>
        <p>{choice.prompt}</p>
        <div className="modal-actions discard-hand-list">
          {choice.lands.map((card) => (
            <button
              key={card.id}
              type="button"
              className="inspector-action"
              aria-pressed={selected === card.id}
              onClick={() => setSelected(card.id)}
            >
              {selected === card.id ? "✓ " : ""}
              {card.name}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="inspector-action" type="button" disabled={!selected} onClick={() => onConfirm?.(selected ? [selected] : [])}>
            Return to hand
          </button>
        </div>
      </article>
    </div>
  );
}

function ChooseCreatureTypeModal({
  choice,
  onChoose
}: {
  choice: Extract<RuleChoiceView, { kind: "choose_creature_type" }>;
  onChoose?: (creatureType: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(choice.currentChoice ?? "");
  const options = useMemo(
    () => (filter.trim() ? CREATURE_TYPES.filter((type) => type.toLowerCase().includes(filter.trim().toLowerCase())) : CREATURE_TYPES),
    [filter]
  );

  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Choose a creature type">
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{choice.sourceCardName}</p>
          <h2>Choose a creature type</h2>
        </header>
        <p>{choice.prompt}</p>
        <input
          type="text"
          placeholder="Search creature types..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          autoFocus
        />
        <div className="modal-actions discard-hand-list creature-type-list">
          {options.map((type) => (
            <button
              key={type}
              type="button"
              className="inspector-action"
              aria-pressed={selected === type}
              onClick={() => setSelected(type)}
            >
              {selected === type ? "✓ " : ""}
              {type}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="inspector-action" type="button" disabled={!selected} onClick={() => onChoose?.(selected)}>
            Confirm {selected || "creature type"}
          </button>
        </div>
      </article>
    </div>
  );
}

const MANA_COLORS: ManaColor[] = ["W", "U", "B", "R", "G"];
const MANA_COLOR_LABELS: Record<ManaColor, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };

function ChooseColorModal({
  choice,
  onChoose
}: {
  choice: Extract<RuleChoiceView, { kind: "choose_color" }>;
  onChoose?: (color: ManaColor) => void;
}) {
  const options = MANA_COLORS.filter((color) => color !== choice.excludedColor);

  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Choose a color">
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{choice.sourceCardName}</p>
          <h2>Choose a color</h2>
        </header>
        <p>{choice.prompt}</p>
        <div className="modal-actions">
          {options.map((color) => (
            <button
              key={color}
              type="button"
              className="inspector-action"
              aria-pressed={choice.currentChoice === color}
              onClick={() => onChoose?.(color)}
            >
              {choice.currentChoice === color ? "✓ " : ""}
              {MANA_COLOR_LABELS[color]}
            </button>
          ))}
        </div>
      </article>
    </div>
  );
}

// Klauth, Unrivaled Ancient's "add X mana in any combination of colors" — a running-total, tap-to-
// add-one-per-color picker (unlike ChooseColorModal's pick-exactly-one), since the whole point is a
// free split across as many colors as the player wants. No cancel/decline — this is a mandatory
// trigger with a fixed X, not a "may" effect (see the targeting banner's own mandatory-gets-no-
// button convention for choose_effect_target).
type DistributableColor = Exclude<ManaColor, "C">;
const DISTRIBUTABLE_COLORS = MANA_COLORS as DistributableColor[];

function DistributeManaModal({
  choice,
  onConfirm
}: {
  choice: Extract<RuleChoiceView, { kind: "distribute_attack_trigger_mana" }>;
  onConfirm?: (distribution: Partial<Record<DistributableColor, number>>) => void;
}) {
  const [distribution, setDistribution] = useState<Partial<Record<DistributableColor, number>>>({});
  const total = DISTRIBUTABLE_COLORS.reduce((sum, color) => sum + (distribution[color] ?? 0), 0);
  const remaining = choice.amount - total;

  const add = (color: DistributableColor) => {
    if (remaining <= 0) return;
    setDistribution((current) => ({ ...current, [color]: (current[color] ?? 0) + 1 }));
  };
  const subtract = (color: DistributableColor) => {
    setDistribution((current) => (current[color] ? { ...current, [color]: current[color]! - 1 } : current));
  };

  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Distribute mana">
      <article className="mana-choice-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">{choice.sourceCardName}</p>
          <h2>Distribute {choice.amount} mana</h2>
        </header>
        <p>{choice.prompt}</p>
        <p>{remaining} remaining</p>
        <div className="modal-actions">
          {DISTRIBUTABLE_COLORS.map((color) => (
            <button key={color} type="button" className="inspector-action" onClick={() => add(color)} disabled={remaining <= 0}>
              +1 {MANA_COLOR_LABELS[color]} ({distribution[color] ?? 0})
            </button>
          ))}
        </div>
        <div className="modal-actions">
          {DISTRIBUTABLE_COLORS.filter((color) => distribution[color]).map((color) => (
            <button key={color} type="button" className="inspector-action" onClick={() => subtract(color)}>
              -1 {MANA_COLOR_LABELS[color]}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="inspector-action" disabled={remaining !== 0} onClick={() => onConfirm?.(distribution)}>
            Confirm
          </button>
        </div>
      </article>
    </div>
  );
}

function OrderTriggersModal({
  choice,
  onChoose,
  onClose
}: {
  choice: Extract<RuleChoiceView, { kind: "order_triggers" }>;
  onChoose?: (sourceCardId: string) => void;
  onClose?: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Order phase triggers" onClick={onClose}>
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close trigger order">
          x
        </button>
        <header>
          <p className="eyebrow">Phase triggers</p>
          <h2>Choose Order</h2>
          <p>{choice.prompt}</p>
          {choice.orderedTriggers.length > 0 ? <span>Chosen: {choice.orderedTriggers.map((trigger) => trigger.sourceCardName).join(" -> ")}</span> : null}
        </header>
        <div className="library-search-results">
          {choice.triggers.map((trigger) => (
            <article className="library-search-card" key={trigger.sourceCardId}>
              <div>
                <strong>{trigger.sourceCardName}</strong>
                <span>{trigger.text}</span>
              </div>
              <button type="button" onClick={() => onChoose?.(trigger.sourceCardId)}>Next</button>
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

function MyriadSearchModal({
  cards,
  onClose,
  onChoose
}: {
  cards: VisibleCard[];
  onClose?: () => void;
  onChoose?: (cardIds: string[]) => void;
}) {
  const availableTypes = basicLandTypeOrder.filter((type) => cards.some((card) => cardBasicLandTypes(card).includes(type)));
  const [selectedType, setSelectedType] = useState(availableTypes[0] ?? "Plains");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const filteredCards = cards.filter((card) => cardBasicLandTypes(card).includes(selectedType));
  const canConfirm = selectedIds.length > 0 && selectedIds.length <= 2;

  function toggleCard(cardId: string) {
    setSelectedIds((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      if (current.length >= 2) return current;
      return [...current, cardId];
    });
  }

  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Resolve Myriad Landscape" onClick={onClose}>
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close Myriad Landscape search">
          x
        </button>
        <header>
          <p className="eyebrow">Myriad Landscape</p>
          <h2>Choose Basic Lands</h2>
        </header>
        <div className="mode-switch" role="group" aria-label="Basic land type">
          {availableTypes.map((type) => (
            <button
              className={selectedType === type ? "selected" : ""}
              key={type}
              type="button"
              onClick={() => {
                setSelectedType(type);
                setSelectedIds([]);
              }}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="library-search-results">
          {filteredCards.length === 0 ? <p>No matching basic lands.</p> : null}
          {filteredCards.map((card) => (
            <article className={`library-search-card ${selectedIds.includes(card.id) ? "selected" : ""}`} key={card.id}>
              <div>
                <strong>{card.name}</strong>
                <span>{card.typeLine}</span>
              </div>
              <button type="button" onClick={() => toggleCard(card.id)}>
                {selectedIds.includes(card.id) ? "Selected" : "Select"}
              </button>
            </article>
          ))}
        </div>
        <button type="button" disabled={!canConfirm} onClick={() => onChoose?.(selectedIds)}>
          Put Selected Onto Battlefield Tapped
        </button>
      </article>
    </div>
  );
}

function BasicLandFetchModal({
  sourceCardName,
  cards,
  onClose,
  onChoose
}: {
  sourceCardName: string;
  cards: VisibleCard[];
  onClose?: () => void;
  onChoose?: (cardId: string) => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`Resolve ${sourceCardName}`} onClick={onClose}>
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label={`Close ${sourceCardName} search`}>
          x
        </button>
        <header>
          <p className="eyebrow">{sourceCardName}</p>
          <h2>Choose Basic Land</h2>
        </header>
        <div className="library-search-results">
          {cards.length === 0 ? <p>No basic lands found.</p> : null}
          {cards.map((card) => (
            <article className="library-search-card" key={card.id}>
              <div>
                <strong>{card.name}</strong>
                <span>{card.typeLine}</span>
              </div>
              <button type="button" onClick={() => onChoose?.(card.id)}>
                Put Onto Battlefield Tapped
              </button>
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

function UrzaSagaSearchModal({
  cards,
  onClose,
  onChoose
}: {
  cards: VisibleCard[];
  onClose?: () => void;
  onChoose?: (cardId: string) => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Resolve Urza's Saga chapter III" onClick={onClose}>
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close Urza's Saga search">
          x
        </button>
        <header>
          <p className="eyebrow">{"Urza's Saga — Chapter III"}</p>
          <h2>Choose an Artifact (Mana Value 0 or 1)</h2>
        </header>
        <div className="library-search-results">
          {cards.length === 0 ? <p>No artifact card with mana value 0 or 1 was found.</p> : null}
          {cards.map((card) => (
            <article className="library-search-card" key={card.id}>
              <div>
                <strong>{card.name}</strong>
                <span>{card.typeLine}</span>
              </div>
              <button type="button" onClick={() => onChoose?.(card.id)}>
                Put Onto Battlefield
              </button>
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

const basicLandTypeOrder = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];

function cardBasicLandTypes(card: VisibleCard) {
  return basicLandTypeOrder.filter((type) => card.name === type || card.typeLine.includes(type));
}

function parseLoyaltyAbilities(oracleText: string) {
  return oracleText
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^([+\u2212-]?\d+):\s*(.+)$/);
      if (!match) return undefined;
      return {
        cost: Number.parseInt(match[1].replace("\u2212", "-"), 10),
        text: match[2]
      };
    })
    .filter((ability): ability is { cost: number; text: string } => Boolean(ability && Number.isFinite(ability.cost) && ability.text));
}

function formatLoyaltyCost(cost: number) {
  return cost > 0 ? `+${cost}` : `${cost}`;
}

// Mirrors AppFlow.tsx's canCastAtInstantSpeed — used only to decide whether to show a "Cast from
// Exile" button during an open response window (a sorcery sitting in exile still isn't castable
// there, only an instant/flash card is). flashGranted mirrors AppFlow's seatHasFlashGrant (a
// battlefield Vedalken Orrery/Leyline of Anticipation) — without it this button would stay hidden
// for a card AppFlow's own respondWithCard would actually allow.
function canCastAtInstantSpeed(card: VisibleCard, flashGranted = false) {
  return card.typeLine.includes("Instant") || /\bflash\b/i.test(card.oracleText) || flashGranted;
}

function seatHasFlashGrant(seat: PlayerSeat | undefined) {
  if (!seat) return false;
  return seat.board.battlefield.some(
    (card) => /as though (it|they) had flash/i.test(card.oracleText) || /any time you could cast an instant/i.test(card.oracleText)
  );
}

function FallbackLargeCard({ card }: { card: VisibleCard }) {
  return (
    <div className="card-inspector-fallback">
      <strong>{card.name}</strong>
      <span>{card.typeLine}</span>
      <p>{card.oracleText}</p>
      {card.power && card.toughness ? <em>{effectivePower(card)}/{effectiveToughness(card)}</em> : null}
    </div>
  );
}

function BlockChoiceModal({
  choice,
  selectedBlockerIds,
  onToggle,
  onConfirm,
  onPass
}: {
  choice: BlockChoiceView;
  selectedBlockerIds: string[];
  onToggle?: (blockerCardId: string) => void;
  onConfirm?: () => void;
  onPass?: () => void;
}) {
  const selectedCount = selectedBlockerIds.length;
  return (
    <aside className="block-assign-panel" role="dialog" aria-label="Choose blockers">
      <header>
        <p className="eyebrow">Blockers</p>
        <h2>
          {choice.attackerName} attacks with {choice.attackingCard.name} ({effectivePowerText(choice.attackingCard)})
        </h2>
      </header>
      <div className="block-assign-actions">
        <button className="inspector-action block-confirm" type="button" onClick={onConfirm} disabled={selectedCount === 0}>
          {selectedCount === 0 ? "Confirm (no blocks)" : `Confirm ${selectedCount} Blocker${selectedCount === 1 ? "" : "s"}`}
        </button>
        <button className="inspector-action" type="button" onClick={onPass}>
          Do Not Block
        </button>
      </div>
      {choice.blockers.length > 0 ? (
        <>
          <p className="block-assign-hint">
            Tap creatures to add them as blockers{selectedCount > 1 ? " — first tapped takes damage first" : ""}.
          </p>
          <div className="block-assign-list">
            {choice.blockers.map((card) => {
              const order = selectedBlockerIds.indexOf(card.id);
              const selected = order >= 0;
              return (
                <button
                  key={card.id}
                  type="button"
                  className={`block-assign-card ${selected ? "selected" : ""}`}
                  onClick={() => onToggle?.(card.id)}
                >
                  {selected ? <span className="block-assign-order">{order + 1}</span> : null}
                  <span className="block-assign-name">{card.name}</span>
                  <span className="block-assign-stats">{effectivePowerText(card)}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="block-assign-hint">No legal blockers are available.</p>
      )}
    </aside>
  );
}

// Surfaces why a creature can't currently attack/tap — the engine itself always enforces this
// correctly (see canAttack/legalAttackActions in AppFlow.tsx), but nothing in the UI ever told a
// human *why* a just-played creature was sitting idle, which reads as the game "not knowing" about
// summoning sickness even though it's tracked and enforced under the hood.
function battlefieldStatusText(card: VisibleCard): string {
  const parts: string[] = [];
  if (card.tapped) parts.push("Tapped");
  const hasHaste = hasOracleKeyword(card.oracleText, "haste") || Boolean(card.grantedKeywords?.includes("haste"));
  if (card.typeLine.includes("Creature") && card.summoningSick && !hasHaste) parts.push("Summoning sick");
  if (card.attacking) parts.push("Attacking");
  if (card.blocking) parts.push("Blocking");
  if (card.chosenCreatureType) parts.push(`Chosen type: ${card.chosenCreatureType}`);
  if (card.chosenColor) parts.push(`Chosen color: ${card.chosenColor}`);
  return parts.join(", ");
}

function effectivePowerText(card: VisibleCard) {
  return card.power !== undefined && card.toughness !== undefined ? `${effectivePower(card)}/${effectiveToughness(card)}` : card.typeLine;
}

function ZoneViewerModal({
  seat,
  zone,
  turn,
  hasOpenResponseWindow,
  onClose,
  onInspect,
  onMoveToHand,
  onCastFromExile
}: {
  seat?: PlayerSeat;
  zone: TableZone;
  turn: number;
  hasOpenResponseWindow: boolean;
  onClose?: () => void;
  onInspect?: (card: VisibleCard) => void;
  onMoveToHand?: (cardId: string) => void;
  onCastFromExile?: (cardId: string) => void;
}) {
  const cards = zone === "graveyard" ? (seat?.board.graveyard ?? []) : (seat?.board.exile ?? []);
  const title = zone === "graveyard" ? "Graveyard" : "Exile";
  const canReturnToHand = seat?.kind === "human" && zone === "graveyard";
  // Impulse-draw/steal-and-play effects (see zoneEffects.ts) grant temporary or indefinite
  // permission to cast a card straight out of exile — only the seat that was granted it, only
  // while any time limit hasn't expired, and only an instant/flash card if a response window is
  // currently open (main-phase casting has no speed restriction).
  const canCastFromExile = (card: VisibleCard) =>
    seat?.kind === "human" &&
    zone === "exile" &&
    card.exiledPlayableBySeatId === seat.id &&
    (card.exiledPlayableUntilTurn === undefined || turn <= card.exiledPlayableUntilTurn) &&
    (!hasOpenResponseWindow || canCastAtInstantSpeed(card, seatHasFlashGrant(seat)));

  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`${seat?.name ?? "Player"} ${title}`} onClick={onClose}>
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label={`Close ${title}`}>
          x
        </button>
        <header>
          <p className="eyebrow">{seat?.name ?? "Player"}</p>
          <h2>{title}</h2>
          <p>{cards.length} card{cards.length === 1 ? "" : "s"}</p>
        </header>
        <div className="library-search-results">
          {cards.length === 0 ? <p>No cards in {title.toLowerCase()}.</p> : null}
          {cards.map((card) => (
            <article className="library-search-card" key={card.id}>
              {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" /> : <FallbackHandCard card={card} />}
              <div>
                <strong>{card.name}</strong>
                <span>{card.typeLine}</span>
              </div>
              <button type="button" onClick={() => onInspect?.(card)}>Inspect</button>
              {canReturnToHand ? <button type="button" onClick={() => onMoveToHand?.(card.id)}>To Hand</button> : null}
              {canCastFromExile(card) ? <button type="button" onClick={() => onCastFromExile?.(card.id)}>Cast</button> : null}
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

function FallbackHandCard({ card }: { card: VisibleCard }) {
  return (
    <div className="three-hand-fallback">
      <strong>{card.name}</strong>
      <span>{card.typeLine}</span>
    </div>
  );
}

function buildTableRenderKey(session: GameSession, selectedCardId: string | undefined) {
  return JSON.stringify({
    active: session.activePlayerId,
    selected: selectedCardId,
    seats: session.seats.map((seat) => ({
      id: seat.id,
      life: seat.life,
      zones: {
        library: seat.zones.library,
        hand: seat.zones.hand,
        graveyard: seat.zones.graveyard,
        exile: seat.zones.exile,
        command: seat.zones.command
      },
      commander: seat.board.commander ? cardRenderKey(seat.board.commander) : undefined,
      battlefield: seat.board.battlefield.map(cardRenderKey)
    }))
  });
}

function cardRenderKey(card: VisibleCard) {
  return {
    id: card.id,
    name: card.name,
    tapped: Boolean(card.tapped),
    attacking: Boolean(card.attacking),
    blocking: Boolean(card.blocking),
    image: battlefieldImageUrls(card)[0],
    x: card.battlefieldPosition?.x,
    z: card.battlefieldPosition?.z,
    counters: card.counters?.map((counter) => `${counter.kind}:${counter.count}`).join("|")
  };
}

function rebuildDynamicScene(
  group: THREE.Group | null,
  session: GameSession,
  selectedCardId: string | undefined,
  cardMeshesRef: MutableRefObject<THREE.Object3D[]>,
  showCommanderDamage: boolean
) {
  if (!group) return;
  group.clear();
  cardMeshesRef.current = [];

  session.seats.forEach((seat, index) => {
    const area = PLAYER_AREAS[index] ?? PLAYER_AREAS[0];
    addBattlefieldArea(group, area, seat.kind === "human");
    const commanderSlot = zoneStripPosition(area, 0);
    const librarySlot = zoneStripPosition(area, 1);
    const graveyardSlot = zoneStripPosition(area, 2);
    const exileSlot = zoneStripPosition(area, 3);
    addZonePile(group, "Deck", seat.zones.library, librarySlot.x, librarySlot.z, area.rot);
    addZonePile(group, "Grave", seat.zones.graveyard, graveyardSlot.x, graveyardSlot.z, area.rot, cardMeshesRef, seat.id, "graveyard");
    addZonePile(group, "Exile", seat.zones.exile, exileSlot.x, exileSlot.z, area.rot, cardMeshesRef, seat.id, "exile");

    if (seat.board.commander) {
      addCard(group, seat.board.commander, seat.id, "command", commanderSlot.x, commanderSlot.z, area.rot, selectedCardId, cardMeshesRef);
    }

    // Two passes so an attached Equipment can be tucked against its creature instead of getting its
    // own independent grid slot (Auras are left alone — scoped to Equipment only, per the original
    // report). First pass resolves/renders everything else and records where each landed; second
    // pass looks up its target's resolved spot and renders the Equipment at a small fixed offset
    // from it instead. Applies uniformly through this same shared function for every seat, so an
    // agent's equipped creatures get the same treatment automatically. Falls back to the normal
    // independent slot if the target's position wasn't found (shouldn't happen — attachedToId is
    // already cleared once its target leaves the battlefield).
    const resolvedBattlefieldPositions = new Map<string, { x: number; z: number }>();
    const attachedEquipmentByTarget = new Map<string, VisibleCard[]>();
    const unattachedCards: VisibleCard[] = [];
    for (const card of seat.board.battlefield) {
      if (isEquipment(card) && card.attachedToId) {
        const siblings = attachedEquipmentByTarget.get(card.attachedToId) ?? [];
        siblings.push(card);
        attachedEquipmentByTarget.set(card.attachedToId, siblings);
      } else {
        unattachedCards.push(card);
      }
    }

    unattachedCards.forEach((card) => {
      const point = card.battlefieldPosition ?? defaultBattlefieldPosition(area, card, seat.board.battlefield);
      resolvedBattlefieldPositions.set(card.id, point);
      addCard(group, card, seat.id, "battlefield", point.x, point.z, area.rot, selectedCardId, cardMeshesRef);
    });

    attachedEquipmentByTarget.forEach((equipmentCards, targetId) => {
      const targetPoint = resolvedBattlefieldPositions.get(targetId);
      equipmentCards.forEach((card, siblingIndex) => {
        const point = targetPoint
          ? { x: targetPoint.x + 0.15 + siblingIndex * 0.12, z: targetPoint.z + 0.14 }
          : card.battlefieldPosition ?? defaultBattlefieldPosition(area, card, seat.board.battlefield);
        addCard(group, card, seat.id, "battlefield", point.x, point.z, area.rot, selectedCardId, cardMeshesRef);
      });
    });

    // Life total (plus hand count) as a small 3D plate near the table's center, in this seat's own
    // quadrant direction — explicitly requested as "a 3D object like the card counter for the
    // library, graveyard and exile pile" (addLifeTotalPlate's own comment covers the tradeoff this
    // reintroduces relative to a screen-space overlay). A full-width per-seat plate on the table
    // surface was tried and removed once already for a similar "bothered by the camera" report; kept
    // small and clustered at center this time to keep any perspective skew as minor as possible.
    addLifeTotalPlate(group, seat, area.x > 0 ? 0.38 : -0.38, area.z > 0 ? 0.27 : -0.27, showCommanderDamage, cardMeshesRef);
  });
}

function addBattlefieldArea(
  group: THREE.Group,
  area: (typeof PLAYER_AREAS)[number],
  active: boolean
) {
  const width = area.maxX - area.minX;
  const depth = area.maxZ - area.minZ;
  const geometry = new THREE.PlaneGeometry(width, depth);
  const material = new THREE.MeshBasicMaterial({
    color: active ? "#24452e" : "#1a3523",
    transparent: true,
    opacity: active ? 0.34 : 0.22,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((area.minX + area.maxX) / 2, 0.015, (area.minZ + area.maxZ) / 2);
  group.add(mesh);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, depth)),
    new THREE.LineBasicMaterial({ color: active ? "#f4c95d" : "#61745c", transparent: true, opacity: active ? 0.9 : 0.55 })
  );
  border.rotation.x = -Math.PI / 2;
  border.position.copy(mesh.position);
  border.position.y = 0.025;
  group.add(border);
}

// Groups a permanent into one of three rendering bands: lands read as "mana base" and creatures/
// planeswalkers read as "board state," which is what a player actually scans for at a glance — see
// defaultBattlefieldPosition for how each band is laid out.
function battlefieldCardCategory(card: VisibleCard): "land" | "creature" | "other" {
  if (card.typeLine.includes("Land")) return "land";
  if (card.typeLine.includes("Creature") || card.typeLine.includes("Planeswalker")) return "creature";
  return "other";
}

// A Commander board routinely grows past what a static 5-wide/2-row grid can hold without overlap —
// this used to be papered over by hard-capping rendering at 12 permanents (see git history), which
// made anything beyond that literally invisible and unclickable rather than just cramped. Instead,
// grow the column count (and shrink row spacing) with the actual permanent count so everything still
// gets a mesh and a screen position, even if cards sit closer together once a board gets very wide.
// minX/maxX/edgeZ/dir/depth describe an arbitrary sub-rectangle (a "band") rather than the whole
// player area, so defaultBattlefieldPosition can carve the area into per-role bands below.
// spreadWide (the land band's own bandGridPosition call below) skips the sqrt clustering formula
// and just uses every column the available width allows before wrapping to a second row — the
// square-ish cluster the sqrt formula produces makes sense for the creature/artifact bands sitting
// in a comparatively deep area, but the land strip is shallow and wide (landDepth is only 40% of a
// player's total depth) and was piling lands up 3-4 to a column, with mostly-empty width beside
// them, well before it needed to (reported live as lands "clipping through" other permanents).
function bandGridPosition(minX: number, maxX: number, edgeZ: number, dir: 1 | -1, depth: number, cardIndex: number, totalCards: number, spreadWide = false) {
  const availableWidth = Math.max(0.1, maxX - minX);
  const availableDepth = Math.max(0.1, depth);
  const maxColumnsByWidth = Math.max(1, Math.floor(availableWidth / 0.85) + 1);
  const columns = spreadWide ? Math.min(maxColumnsByWidth, Math.max(1, totalCards)) : Math.min(maxColumnsByWidth, Math.max(2, Math.ceil(Math.sqrt(Math.max(1, totalCards) * 2.2))));
  const rows = Math.max(1, Math.ceil(totalCards / columns));
  const xStep = columns > 1 ? Math.min(1.15, availableWidth / (columns - 1)) : 0;
  const zStep = rows > 1 ? Math.min(1.25, availableDepth / (rows - 1)) : 0;

  const col = cardIndex % columns;
  const row = Math.floor(cardIndex / columns);
  const x = THREE.MathUtils.clamp(minX + col * xStep, minX, maxX);
  const farZ = edgeZ + dir * availableDepth;
  const z = THREE.MathUtils.clamp(edgeZ + row * dir * zStep, Math.min(edgeZ, farZ), Math.max(edgeZ, farZ));
  return { x, z };
}

// Auto-arranges a player's permanents by role instead of raw play order, so lands sit as a strip
// along this player's own near edge (their mana base — least urgent to track), creatures and
// planeswalkers sit front-and-center toward the table's middle (the board state a player actually
// needs to read at a glance), and artifacts/enchantments flank them on the left/right rather than
// mixing into either — mirroring how a player organizes a real tabletop board. Only used for
// permanents that have never been manually dragged (battlefieldPosition undefined); once a player
// drags a card, that explicit position always wins over this, for every seat including agents.
function defaultBattlefieldPosition(area: (typeof PLAYER_AREAS)[number], card: VisibleCard, battlefield: VisibleCard[]) {
  const category = battlefieldCardCategory(card);
  const sameCategory = battlefield.filter((item) => battlefieldCardCategory(item) === category);
  const cardIndex = Math.max(0, sameCategory.findIndex((item) => item.id === card.id));
  const totalInCategory = sameCategory.length;

  // outerZ is this player's own near edge (where lands live); innerZ is the far edge toward the
  // table's middle (where creatures/planeswalkers live) — rot flips which raw Z value that is.
  const outerZ = area.rot === 0 ? area.maxZ - 0.55 : area.minZ + 0.55;
  const innerZ = area.rot === 0 ? area.minZ + 0.55 : area.maxZ - 0.55;
  const dir: 1 | -1 = innerZ >= outerZ ? 1 : -1;
  const totalDepth = Math.abs(innerZ - outerZ);
  const landDepth = totalDepth * 0.4;
  const frontDepth = totalDepth - landDepth;
  const frontEdgeZ = outerZ + dir * landDepth;

  if (category === "land") {
    return bandGridPosition(area.minX + 0.55, area.maxX - 0.55, outerZ, dir, landDepth, cardIndex, totalInCategory, true);
  }

  const width = area.maxX - area.minX;
  const sideWidth = width * 0.22;
  if (category === "other") {
    // Alternate left/right so artifacts and enchantments split evenly across both flanks instead of
    // piling onto one side.
    const onLeft = cardIndex % 2 === 0;
    const minX = onLeft ? area.minX + 0.5 : area.maxX - sideWidth + 0.15;
    const maxX = onLeft ? area.minX + sideWidth - 0.15 : area.maxX - 0.5;
    const sideIndex = Math.floor(cardIndex / 2);
    const sideTotal = Math.max(1, Math.ceil(totalInCategory / 2));
    return bandGridPosition(minX, maxX, frontEdgeZ, dir, frontDepth, sideIndex, sideTotal);
  }

  return bandGridPosition(area.minX + sideWidth, area.maxX - sideWidth, frontEdgeZ, dir, frontDepth, cardIndex, totalInCategory);
}

// Just past the outer (away-from-center) edge of this player's battlefield rectangle — left of
// minX for a left-side player, right of maxX for a right-side player — so the non-battlefield
// zones (see zoneStripPosition) never sit on top of, or compete for space with, actual permanents.
function zoneStripX(area: (typeof PLAYER_AREAS)[number]) {
  return area.x < 0 ? area.minX - 1.3 : area.maxX + 1.3;
}

// Stacks the four non-battlefield zones (commander, library, graveyard, exile — slots 0-3) along
// this player's own near/far axis, at a single x just outside their battlefield rectangle. Order is
// arbitrary (any consistent order works) but keeps command zone nearest the table's center and
// exile nearest the player, roughly mirroring where they used to sit before both were moved out of
// the battlefield rectangle itself.
function zoneStripPosition(area: (typeof PLAYER_AREAS)[number], slot: 0 | 1 | 2 | 3) {
  const depth = area.maxZ - area.minZ;
  return { x: zoneStripX(area), z: area.minZ + depth * ((slot + 0.5) / 4) };
}

function zonePilePosition(area: (typeof PLAYER_AREAS)[number], zone: TableZone) {
  return zoneStripPosition(area, zone === "graveyard" ? 2 : 3);
}

function tableZoneAtPosition(session: GameSession, seatId: string, position: { x: number; z: number }): TableZone | undefined {
  const seatIndex = session.seats.findIndex((seat) => seat.id === seatId);
  const area = PLAYER_AREAS[seatIndex] ?? PLAYER_AREAS[0];
  for (const zone of ["graveyard", "exile"] as TableZone[]) {
    const pile = zonePilePosition(area, zone);
    const dx = position.x - pile.x;
    const dz = position.z - pile.z;
    if (Math.sqrt(dx * dx + dz * dz) <= 0.9) return zone;
  }
  return undefined;
}

function addCard(
  group: THREE.Group,
  card: VisibleCard,
  seatId: string,
  location: CardUserData["location"],
  x: number,
  z: number,
  rot: number,
  selectedCardId: string | undefined,
  cardMeshesRef: MutableRefObject<THREE.Object3D[]>
) {
  const texture = makeCardTexture(card, selectedCardId === card.id);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.02), material);
  const imageUrls = battlefieldImageUrls(card);
  if (imageUrls.length > 0) {
    applyImageTexture(imageUrls, material);
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rot + (card.tapped ? Math.PI / 2 : 0);
  mesh.position.set(x, 0.08, z);
  mesh.userData = { kind: "card", card, seatId, location } satisfies CardUserData;
  group.add(mesh);
  cardMeshesRef.current.push(mesh);
  addCounterBadges(group, card, x, z);
}

interface CounterBadge {
  text: string;
  color: string;
}

// +1/+1 and -1/-1 net into a single "+N"/"-N" badge (they always move together — a permanent never
// visibly carries both), loyalty gets its own badge since it's the primary stat to track for a
// planeswalker, and every other counter kind (charge, age, ice, ...) gets a plain count badge —
// this is a glance-level readout, not a full breakdown; the exact kind names are still in the
// card inspector.
function describeCounterBadges(card: VisibleCard): CounterBadge[] {
  const counters = card.counters ?? [];
  const badges: CounterBadge[] = [];
  const plusMinus = (counters.find((counter) => counter.kind === "+1/+1")?.count ?? 0) - (counters.find((counter) => counter.kind === "-1/-1")?.count ?? 0);
  if (plusMinus !== 0) badges.push({ text: plusMinus > 0 ? `+${plusMinus}` : `${plusMinus}`, color: plusMinus > 0 ? "#2f9e44" : "#c92a2a" });
  const loyalty = counters.find((counter) => counter.kind === "loyalty")?.count;
  if (loyalty !== undefined) badges.push({ text: `${loyalty}`, color: "#4263eb" });
  for (const counter of counters) {
    if (counter.kind === "+1/+1" || counter.kind === "-1/-1" || counter.kind === "loyalty" || counter.count <= 0) continue;
    badges.push({ text: `${counter.count}`, color: "#c98a2b" });
  }
  return badges;
}

// Billboard sprites (always face the camera) rather than flat card-aligned planes, since this
// camera can orbit and a flat badge would go edge-on and unreadable from a low angle.
function addCounterBadges(group: THREE.Group, card: VisibleCard, x: number, z: number) {
  const badges = describeCounterBadges(card);
  if (badges.length === 0) return;
  badges.forEach((badge, index) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: counterBadgeTexture(badge), transparent: true, depthTest: false }));
    sprite.scale.set(0.26, 0.26, 1);
    sprite.position.set(x + (index - (badges.length - 1) / 2) * 0.28, 0.32, z);
    sprite.renderOrder = 10;
    group.add(sprite);
  });
}

function counterBadgeTexture(badge: CounterBadge): THREE.Texture {
  const key = `${badge.text}|${badge.color}`;
  const cached = counterBadgeTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();

  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = badge.color;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 52px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badge.text, 64, 68);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  counterBadgeTextureCache.set(key, texture);
  return texture;
}

function applyImageTexture(urls: string[], material: THREE.MeshBasicMaterial) {
  const [url, ...fallbacks] = urls.filter((item) => !failedCardImageUrls.has(item));
  if (!url) return;
  const cached = cardImageTextureCache.get(url);
  if (cached) {
    material.map = cached;
    material.needsUpdate = true;
    return;
  }

  loadCardImageTexture(url)
    .then((texture) => {
      material.map = texture;
      material.needsUpdate = true;
    })
    .catch(() => {
      if (fallbacks.length > 0) applyImageTexture(fallbacks, material);
    });
}

function loadCardImageTexture(url: string) {
  const cached = cardImageTextureCache.get(url);
  if (cached) return Promise.resolve(cached);

  const pending = cardImageTexturePending.get(url);
  if (pending) return pending;

  const request = new Promise<THREE.Texture>((resolve, reject) => {
    imageTextureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        cardImageTextureCache.set(url, texture);
        cardImageTexturePending.delete(url);
        resolve(texture);
      },
      undefined,
      () => {
        failedCardImageUrls.add(url);
        cardImageTextureCache.delete(url);
        cardImageTexturePending.delete(url);
        reject(new Error(`Card image failed to load: ${url}`));
      }
    );
  });

  cardImageTexturePending.set(url, request);
  return request;
}

function battlefieldImageUrls(card: VisibleCard) {
  return Array.from(new Set([
    card.imageUris?.normal ??
      card.imageUris?.large ??
      card.imageUris?.png ??
      card.faces?.[0]?.imageUris?.normal ??
      card.faces?.[0]?.imageUris?.large ??
      card.imageUris?.borderCrop ??
      card.faces?.[0]?.imageUris?.borderCrop,
    card.imageUris?.large,
    card.imageUris?.png,
    card.faces?.[0]?.imageUris?.normal,
    card.faces?.[0]?.imageUris?.large,
    card.imageUris?.borderCrop,
    card.faces?.[0]?.imageUris?.borderCrop
  ].filter((url): url is string => Boolean(url))));
}

function addZonePile(
  group: THREE.Group,
  label: string,
  count: number,
  x: number,
  z: number,
  rot: number,
  interactionMeshesRef?: MutableRefObject<THREE.Object3D[]>,
  seatId?: string,
  zone?: TableZone
) {
  const pile = new THREE.Group();
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.08, 1.2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
  );
  hitbox.position.y = 0.05;
  if (seatId && zone) {
    hitbox.userData = { kind: "zone", seatId, zone } satisfies ZoneUserData;
    interactionMeshesRef?.current.push(hitbox);
  }
  pile.add(hitbox);
  for (let index = 0; index < Math.min(4, count); index += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.035, 1),
      new THREE.MeshStandardMaterial({ color: "#263b57", roughness: 0.75 })
    );
    mesh.position.y = 0.04 + index * 0.035;
    if (seatId && zone) {
      mesh.userData = { kind: "zone", seatId, zone } satisfies ZoneUserData;
      interactionMeshesRef?.current.push(mesh);
    }
    pile.add(mesh);
  }
  pile.position.set(x, 0.05, z);
  pile.rotation.y = rot;
  group.add(pile);
  addTextPlane(group, `${label} ${count}`, x, z + 0.75, rot, 0.42);
}

function makeCardTexture(card: VisibleCard, selected: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable.");
  const color = card.colors[0] ?? "C";
  const bg = ({ W: "#d9d0ad", U: "#7ca6c9", B: "#6b5a70", R: "#b36b58", G: "#6e9b68", C: "#8a8678" } as Record<string, string>)[color];
  context.fillStyle = bg;
  roundRect(context, 0, 0, canvas.width, canvas.height, 18);
  context.fill();
  context.strokeStyle = selected ? "#f4c95d" : "#1b1b1b";
  context.lineWidth = selected ? 12 : 7;
  context.stroke();
  context.fillStyle = "rgba(0,0,0,0.72)";
  roundRect(context, 14, 14, 228, 56, 10);
  context.fill();
  context.fillStyle = "#fff8df";
  context.font = "bold 20px Arial";
  wrapText(context, card.name, 24, 38, 188, 21, 2);
  context.fillStyle = "#111";
  context.font = "16px Arial";
  wrapText(context, card.typeLine, 20, 102, 216, 18, 2);
  context.fillStyle = "rgba(255,255,255,0.72)";
  roundRect(context, 18, 140, 220, 128, 8);
  context.fill();
  context.fillStyle = "#111";
  context.font = "15px Arial";
  wrapText(context, card.oracleText, 28, 164, 200, 18, 5);
  context.fillStyle = "#111";
  context.font = "bold 18px Arial";
  context.fillText(card.role, 22, 324);
  if (card.power && card.toughness) context.fillText(`${effectivePower(card)}/${effectiveToughness(card)}`, 186, 324);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addTextPlane(group: THREE.Group, text: string, x: number, z: number, rot: number, width: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "rgba(0,0,0,0.58)";
  roundRect(context, 0, 0, canvas.width, canvas.height, 18);
  context.fill();
  context.fillStyle = "#f2f0e8";
  context.font = "bold 34px Arial";
  context.textAlign = "center";
  context.fillText(text, canvas.width / 2, 60);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 4, width * 0.75), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rot;
  mesh.position.set(x, 0.1, z);
  group.add(mesh);
}

// The single number that actually matters for rule 704.5j (a player loses if they've taken 21+
// combat damage from the same commander): the largest amount recorded against any one source in
// commanderDamage, not the sum across sources (that could hide someone sitting at 20 from one
// commander and 3 from another — neither individually lethal — behind a scarier-looking total).
function maxCommanderDamage(seat: PlayerSeat): number {
  const amounts = Object.values(seat.commanderDamage);
  return amounts.length > 0 ? Math.max(...amounts) : 0;
}

// One player's life total (or, toggled via the Commander Damage button, the worst commander damage
// they've taken from any single source) as a real 3D plate lying flat on the table, next to Deck/
// Grave/Exile's own pile labels rather than a screen-space DOM overlay — explicitly requested this
// way ("I want it to be a 3D object like the card counter for the library, graveyard and exile
// pile"), after a screen-anchored version (immune to camera movement, but never quite lined up with
// the board the way a real 3D object does) went back and forth several times. Worth flagging even
// though this is the version that shipped: unlike a Deck/Grave/Exile label, which sits right next to
// the actual pile it's tagging, this doesn't tag a physical object — the exact tradeoff called out
// where the old per-seat hand/life plates were removed from this same loop (see the comment on this
// function's caller): a flat table-surface mesh reads fine face-on but foreshortens/skews at other
// camera angles, unlike a screen-space overlay. Sized (and, via the caller's x/z offsets, spaced) so
// adjacent plates never overlap regardless of camera angle: all four sit flat at the same Y with
// non-overlapping x/z footprints, which a perspective projection can't turn into an overlap no
// matter where the camera is — see the caller for the actual footprint math.
function addLifeTotalPlate(
  group: THREE.Group,
  seat: PlayerSeat,
  x: number,
  z: number,
  showCommanderDamage: boolean,
  cardMeshesRef: MutableRefObject<THREE.Object3D[]>
) {
  const canvas = document.createElement("canvas");
  canvas.width = 220;
  canvas.height = 150;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "rgba(10,12,9,0.92)";
  roundRect(context, 0, 0, canvas.width, canvas.height, 16);
  context.fill();
  context.strokeStyle = "rgba(215,179,90,0.55)";
  context.lineWidth = 3;
  context.stroke();
  context.textAlign = "center";
  context.fillStyle = showCommanderDamage ? "#d96d5f" : "#73b47a";
  context.font = "bold 58px Arial";
  context.fillText(String(showCommanderDamage ? maxCommanderDamage(seat) : seat.life), canvas.width / 2, 72);
  context.fillStyle = "#f2f0e8";
  context.font = "bold 18px Arial";
  context.fillText(seat.name.toUpperCase(), canvas.width / 2, 104);
  context.fillStyle = "#b8b7ad";
  context.font = "16px Arial";
  context.fillText(showCommanderDamage ? "Cmdr Dmg" : `Hand ${seat.zones.hand}`, canvas.width / 2, 130);
  // Experience counters (Meren of Clan Nel Toth, ...) are a PLAYER-level counter with no permanent
  // to sit on and — unlike +1/+1 or age counters — can never be removed, so once a player has any
  // they hold that count for the rest of the game. Nothing on the board displayed this at all
  // before, even though it silently gated things like Meren's own reanimation mana-value cap;
  // reported live as wanting to actually see whose commander has handed out how many. A small
  // corner badge, shown only when the count is nonzero, keeps it out of the way for the far more
  // common case of a deck that never grants any.
  const experienceCounters = seat.experienceCounters ?? 0;
  if (experienceCounters > 0) {
    context.fillStyle = "rgba(122,74,184,0.92)";
    roundRect(context, canvas.width - 62, 8, 54, 28, 8);
    context.fill();
    context.fillStyle = "#f2f0e8";
    context.font = "bold 16px Arial";
    context.fillText(`XP ${experienceCounters}`, canvas.width - 35, 27);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 0.72 wide, not the 0.92 an earlier version used — at the x/z offsets the caller places these four
  // plates on (±0.38/±0.27), 0.92-wide plates overlapped their neighbors by a real, measurable margin
  // (visible in life3.jpg as the plates' corners overlapping instead of meeting edge-to-edge); 0.72
  // leaves a small gap on every side at those same offsets instead.
  const planeWidth = 0.72;
  const planeHeight = (planeWidth * canvas.height) / canvas.width;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(planeWidth, planeHeight),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.12, z);
  mesh.userData = { kind: "player", seatId: seat.id } satisfies PlayerUserData;
  group.add(mesh);
  cardMeshesRef.current.push(mesh);
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(" ");
  let line = "";
  let lineCount = 0;
  for (const word of words) {
    const test = `${line}${word} `;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line.trim(), x, y);
      line = `${word} `;
      y += lineHeight;
      lineCount += 1;
      if (lineCount >= maxLines) return;
    } else {
      line = test;
    }
  }
  context.fillText(line.trim(), x, y);
}
