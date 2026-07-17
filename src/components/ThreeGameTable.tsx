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
import { hasKeyword as hasOracleKeyword } from "@/lib/keywords";

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
  pendingAction?: PendingActionView;
  stackActions?: PendingActionView[];
  agentThinking?: Record<string, boolean>;
  agentReasoning?: Record<string, AgentReasoning>;
  manaPool?: ManaPool;
  manaChoice?: {
    cardName: string;
    choices: ManaColor[];
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
  onChooseNextTrigger?: (sourceCardId: string) => void;
  onAcceptMiracle?: () => void;
  onDeclineMiracle?: () => void;
  onAcceptOptionalTrigger?: () => void;
  onDeclineOptionalTrigger?: () => void;
  onCompleteDiscardChoice?: (cardIds: string[]) => void;
  onChooseCreatureType?: (creatureType: string) => void;
  onChooseColor?: (color: ManaColor) => void;
  onCloseMyriadSearch?: () => void;
  onCompleteMyriadSearch?: (cardIds: string[]) => void;
  onCloseBasicLandFetchSearch?: () => void;
  onCompleteBasicLandFetchSearch?: (cardId: string) => void;
  onMoveCardToGraveyard?: (seatId: string, cardId: string) => void;
  onMoveCardToExile?: (seatId: string, cardId: string) => void;
  onMoveCardToHand?: (seatId: string, cardId: string) => void;
  onMoveBattlefieldCard?: (seatId: string, cardId: string, position: { x: number; z: number }) => void;
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
  onChangeLife?: (seatId: string, delta: number) => void;
  onScry?: (count: number) => void;
  onSurveil?: (count: number) => void;
  onKeepLibraryLookCardOnTop?: (cardId: string) => void;
  onOrderLibraryLookCardOnTop?: (cardId: string) => void;
  onPutLibraryLookCardOnBottom?: (cardId: string) => void;
  onPutLibraryLookCardInGraveyard?: (cardId: string) => void;
  onSendLibraryLookCardToHand?: (cardId: string) => void;
  onCloseLibraryLook?: () => void;
  onToggleTapCard?: (seatId: string, cardId: string, location: CardUserData["location"]) => void;
  onChooseMana?: (color: ManaColor) => void;
  onCancelManaChoice?: () => void;
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
    }
  | {
      id: string;
      type: "trigger";
      actorSeatId: string;
      controllerSeatId: string;
      sourceCardName: string;
      triggerKind: "common";
      message: string;
    };

type RuleChoiceView =
  | {
      kind: "choose_card_from_library";
      sourceCardName: string;
      prompt: string;
      cards: VisibleCard[];
      destination: "hand" | "battlefield" | "graveyard";
      allowedCardFilter?: string;
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
    }
  | {
      kind: "optional_trigger";
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
    };

interface BlockChoiceView {
  attackerName: string;
  defenderName: string;
  attackingCard: VisibleCard;
  blockers: VisibleCard[];
}

interface LibraryLookState {
  seatId: string;
  mode: "scry" | "surveil" | "reorder" | "choose_one";
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

type InteractionUserData = CardUserData | ZoneUserData;

// Sized to give each player's battlefield rectangle (see PLAYER_AREAS) real room before permanents
// start crowding, plus a side strip outside each rectangle for the non-battlefield zones (see
// zoneStripX) and margin beyond the near edge for the hand-count label (see zoneStripPosition and
// the "Hand N" placement in rebuildDynamicScene) — both used to be squeezed inside the battlefield
// rectangle itself, competing with permanents for the same space.
const TABLE_WIDTH = 40;
const TABLE_DEPTH = 16;

// Ordered as a clockwise walk around the table's perimeter (front-left -> front-right -> back-right
// -> back-left), not just "left column then right column" — this array is indexed by seat position
// in the turn-order array (session.seats), so the walk order here IS the visual turn order. Getting
// this wrong doesn't break legality (turns still advance by array index either way), but it makes
// play visibly hop diagonally across the table instead of proceeding around it like a real game.
const PLAYER_AREAS = [
  { x: -8.6, z: 3.35, rot: 0, minX: -15.8, maxX: -1.4, minZ: 0.6, maxZ: 6.1 },
  { x: 8.6, z: 3.35, rot: 0, minX: 1.4, maxX: 15.8, minZ: 0.6, maxZ: 6.1 },
  { x: 8.6, z: -3.35, rot: Math.PI, minX: 1.4, maxX: 15.8, minZ: -6.1, maxZ: -0.6 },
  { x: -8.6, z: -3.35, rot: Math.PI, minX: -15.8, maxX: -1.4, minZ: -6.1, maxZ: -0.6 }
];

// commanderDamage is keyed by the dealing commander's own card id (see AppFlow.tsx's damage-
// application code), not by seat or name — so displaying it means resolving each id back to a
// commander. Looked up across every seat's CURRENT commander (not just the reader's own), because a
// theft effect (Word of Seizing, ...) can leave a commander dealing damage while controlled by
// someone other than its owner — including hitting its own owner, which is exactly the case this
// view exists to make visible. A commander that's since left the battlefield for good has no
// current position to resolve against and falls back to a generic label rather than guessing.
function commanderDamageSources(session: GameSession, seat: PlayerSeat) {
  return Object.entries(seat.commanderDamage)
    .filter(([, amount]) => amount > 0)
    .map(([sourceId, amount]) => {
      const commander = session.seats.map((source) => source.board.commander).find((card) => card?.id === sourceId);
      return { sourceId, commanderName: commander?.name ?? "Unknown commander", amount };
    })
    .sort((a, b) => b.amount - a.amount);
}

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
  const scoreboardAnchorRef = useRef<HTMLDivElement | null>(null);
  const [draggingHandCardId, setDraggingHandCardId] = useState<string | undefined>();
  const [draggingZone, setDraggingZone] = useState<DraggedZone | undefined>();
  const [zoneView, setZoneView] = useState<{ seatId: string; zone: TableZone } | undefined>();
  const [activityOpen, setActivityOpen] = useState(false);
  const [showCommanderDamage, setShowCommanderDamage] = useState(false);
  const [activityPosition, setActivityPosition] = useState({ x: 24, y: 144 });
  const [activityDragOffset, setActivityDragOffset] = useState<{ x: number; y: number } | undefined>();
  const [reasoningSeatId, setReasoningSeatId] = useState<string | undefined>();
  const human = props.session.seats.find((seat) => seat.kind === "human") ?? props.session.seats[0];
  const agentSeats = props.session.seats.filter((seat) => seat.kind === "agent");
  const latest = props.session.events[0];
  const phaseNotice = latest?.detail === "Phase change" ? latest : undefined;
  const recentEvents = props.session.events.slice(0, 8);
  const prioritySeat = props.session.seats.find((seat) => seat.id === props.prioritySeatId);
  const humanHasPriority = props.prioritySeatId === human.id;
  const humanIsActive = props.session.activePlayerId === human.id;
  const stackTopFirst = [...(props.stackActions ?? [])].reverse();
  const mulliganSelectedCount = props.mulliganReturnCardIds?.length ?? 0;
  const mulliganRequired = props.mulliganReturnRequired ?? 0;
  const tableRenderKey = useMemo(() => buildTableRenderKey(props.session, props.selectedCardId), [props.session, props.selectedCardId]);

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
    // tracks camera orbit/pan/zoom instead of sitting fixed on the screen regardless of where the
    // table actually is.
    const projected = new THREE.Vector3();
    const updateAgentHandAnchors = () => {
      const currentSeats = propsRef.current.session.seats;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
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
        el.style.display = "grid";
        el.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
        el.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
      });
    };

    // Same anchoring technique as updateAgentHandAnchors above, for the life-total scoreboard —
    // pinned to the table's own center point (where the old decorative ring mesh used to sit)
    // instead of the screen center, so it stays put on the board itself as the camera orbits/pans/
    // zooms rather than floating in place over whatever happens to be behind it.
    const updateScoreboardAnchor = () => {
      const el = scoreboardAnchorRef.current;
      if (!el) return;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
      projected.set(0, 0.1, 0).project(camera);
      if (projected.z > 1) {
        el.style.display = "none";
        return;
      }
      el.style.display = "flex";
      el.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
      el.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
    };

    const animate = () => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      updateKeyboardMovement(deltaSeconds);
      updateCamera();
      updateAgentHandAnchors();
      updateScoreboardAnchor();
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
      draggedBattlefieldCardRef.current =
        event.button === 0 && !event.shiftKey && hovered?.location === "battlefield" && hovered.seatId === humanId ? hovered : undefined;
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
    rebuildDynamicScene(dynamicGroupRef.current, propsRef.current.session, propsRef.current.selectedCardId, cardMeshesRef);
  }, [tableRenderKey]);

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
        <span>Turn {props.session.turn}</span>
        <strong>{activeName}</strong>
        <small>{props.session.phase}</small>
        <small>Priority: {prioritySeat?.name ?? "None"}</small>
      </div>
      <div className="three-hud top-right">
        <button type="button" onClick={() => setActivityOpen((current) => !current)}>Agent Activity</button>
      </div>
      <div className="scoreboard-hud" ref={scoreboardAnchorRef} aria-label="Life totals">
        <button type="button" className="scoreboard-flip" onClick={() => setShowCommanderDamage((current) => !current)}>
          {showCommanderDamage ? "Show Life" : "Show Commander Damage"}
        </button>
        <div className="scoreboard-grid">
          {/* PLAYER_AREAS is a clockwise walk (front-left, front-right, back-right, back-left) —
              reordering to [back-left, back-right, front-left, front-right] lays this 2x2 grid out
              left-to-right/top-to-bottom in the same spatial arrangement as the actual battlefields
              around the table, not turn order, so each cell sits above the real player it belongs
              to instead of needing a legend to match name to position. */}
          {[3, 2, 0, 1].map((areaIndex) => props.session.seats[areaIndex]).filter((seat): seat is PlayerSeat => Boolean(seat)).map((seat) => {
            const damageSources = showCommanderDamage ? commanderDamageSources(props.session, seat) : [];
            return (
              <div className="scoreboard-cell" key={seat.id}>
                <strong>{seat.name}</strong>
                {showCommanderDamage ? (
                  damageSources.length > 0 ? (
                    <ul className="scoreboard-commander-damage">
                      {damageSources.map((source) => (
                        <li key={source.sourceId}>
                          {source.commanderName}: {source.amount}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="scoreboard-muted">No commander damage</span>
                  )
                ) : (
                  <>
                    <span className="scoreboard-life">{seat.life}</span>
                    {seat.poison ? <span className="scoreboard-poison">{seat.poison} poison</span> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {agentSeats.map((seat) => (
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
            <strong>Agent Activity</strong>
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setActivityOpen(false)}>x</button>
          </header>
          <div className="activity-feed">
            {recentEvents.map((event) => (
              <p key={event.id}>{event.message}</p>
            ))}
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
            <button type="button" onClick={() => props.onScry?.(1)}>Scry 1</button>
            <button type="button" onClick={() => props.onSurveil?.(2)}>Surveil 2</button>
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
            <button type="button" disabled={Boolean(props.pendingAction) || !humanIsActive} onClick={props.onAdvanceTurn}>Advance Phase</button>
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
      {props.pendingAction ? (
        <div className="three-hud bottom-right">
          <div className="hud-card-detail stack-detail">
            <strong>{props.pendingAction.type === "spell" ? "Stack" : props.pendingAction.type === "trigger" ? "Trigger" : "Phase Change"}</strong>
            <p>{props.pendingAction.message}</p>
            {props.pendingAction.type === "spell" && props.pendingAction.cardTypeLine ? (
              <p className="stack-type-line">{props.pendingAction.cardTypeLine}</p>
            ) : null}
            {stackTopFirst.length > 0 ? (
              <div className="stack-list" aria-label="Current stack">
                <span>Top of stack</span>
                {stackTopFirst.map((action, index) => (
                  <div className="stack-item" key={action.id}>
                    <small>{index === 0 ? "Resolving next" : "Below"}</small>
                    <strong>{action.type === "spell" ? action.cardName : action.type === "trigger" ? `${action.sourceCardName} trigger` : "Phase change"}</strong>
                    {action.type === "spell" && action.cardTypeLine ? <small>{action.cardTypeLine}</small> : null}
                  </div>
                ))}
              </div>
            ) : null}
            <span>{humanHasPriority ? "You have priority." : `${prioritySeat?.name ?? "An agent"} has priority.`}</span>
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
            (!props.pendingAction || canCastAtInstantSpeed(props.inspectedCard))
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
      {props.libraryLook ? (
        <LibraryLookModal
          look={props.libraryLook}
          onClose={props.onCloseLibraryLook}
          onKeepTop={props.onKeepLibraryLookCardOnTop}
          onOrderTop={props.onOrderLibraryLookCardOnTop}
          onBottom={props.onPutLibraryLookCardOnBottom}
          onGraveyard={props.onPutLibraryLookCardInGraveyard}
          onToHand={props.onSendLibraryLookCardToHand}
        />
      ) : null}
      {props.ruleChoice?.kind === "choose_card_from_library" ? (
        <LibrarySearchModal
          cards={props.ruleChoice.cards}
          destination={props.ruleChoice.destination}
          prompt={props.ruleChoice.prompt}
          sourceCardName={props.ruleChoice.sourceCardName}
          allowedCardFilter={props.ruleChoice.allowedCardFilter}
          onClose={props.onCloseLibrarySearch}
          onChoose={props.onSearchLibraryCardToHand}
        />
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
      {props.ruleChoice?.kind === "discard_to_hand_size" ? (
        <DiscardToHandSizeModal choice={props.ruleChoice} onConfirm={props.onCompleteDiscardChoice} />
      ) : null}
      {props.ruleChoice?.kind === "choose_creature_type" ? (
        <ChooseCreatureTypeModal choice={props.ruleChoice} onChoose={props.onChooseCreatureType} />
      ) : null}
      {props.ruleChoice?.kind === "choose_color" ? (
        <ChooseColorModal choice={props.ruleChoice} onChoose={props.onChooseColor} />
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
          {onActivateEquip ? (
            <button className="inspector-action" type="button" onClick={onActivateEquip}>
              Equip {card.name}
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

function LibraryLookModal({
  look,
  onClose,
  onKeepTop,
  onOrderTop,
  onBottom,
  onGraveyard,
  onToHand
}: {
  look: LibraryLookState;
  onClose?: () => void;
  onKeepTop?: (cardId: string) => void;
  onOrderTop?: (cardId: string) => void;
  onBottom?: (cardId: string) => void;
  onGraveyard?: (cardId: string) => void;
  onToHand?: (cardId: string) => void;
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
                  : "Top of library"}
          </h2>
          <p>
            {look.mode === "surveil"
              ? "Choose each card for the top of your library or your graveyard. The last card you put on top will be the top card."
              : look.mode === "reorder"
                ? "Choose the top card first, then the second card, and so on."
                : look.mode === "choose_one"
                  ? "Choose one card to put into your hand. The rest go back on top — you'll then order them."
                  : "Choose Top to keep this card and finish scrying, or Bottom to look at the next card."}
          </p>
          {look.mode === "reorder" && look.orderedCards?.length ? (
            <span>Chosen: {look.orderedCards.map((card) => card.name).join(" -> ")}</span>
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
  onClose,
  onChoose
}: {
  cards: VisibleCard[];
  destination: "hand" | "battlefield" | "graveyard";
  prompt?: string;
  sourceCardName?: string;
  allowedCardFilter?: string;
  onClose?: () => void;
  onChoose?: (cardId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCards = normalizedQuery
    ? cards.filter((card) => `${card.name} ${card.typeLine} ${card.oracleText}`.toLowerCase().includes(normalizedQuery))
    : cards;

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
                {destination === "battlefield" ? "To Battlefield" : "To Hand"}
              </button>
            </article>
          ))}
        </div>
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

function MiracleOfferModal({
  choice,
  onAccept,
  onDecline
}: {
  choice: Extract<RuleChoiceView, { kind: "miracle_offer" }>;
  onAccept?: () => void;
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
          <button className="inspector-action" type="button" onClick={onAccept}>
            Cast for Miracle Cost ({choice.miracleCost})
          </button>
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

const basicLandTypeOrder = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];

function cardBasicLandTypes(card: VisibleCard) {
  return basicLandTypeOrder.filter((type) => card.name === type || card.typeLine.includes(type));
}

function isBasicLandFetchAbility(card: VisibleCard) {
  const text = card.oracleText.toLowerCase();
  return (
    text.includes("search your library for a basic land card") &&
    text.includes("put it onto the battlefield tapped") &&
    text.includes("sacrifice") &&
    (text.includes("{t}") || text.includes("{tap}") || text.includes("tap,"))
  );
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
// there, only an instant/flash card is).
function canCastAtInstantSpeed(card: VisibleCard) {
  return card.typeLine.includes("Instant") || /\bflash\b/i.test(card.oracleText);
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
    (!hasOpenResponseWindow || canCastAtInstantSpeed(card));

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
  cardMeshesRef: MutableRefObject<THREE.Object3D[]>
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

    seat.board.battlefield.forEach((card, cardIndex) => {
      const point = card.battlefieldPosition ?? defaultBattlefieldPosition(area, cardIndex, seat.board.battlefield.length);
      addCard(group, card, seat.id, "battlefield", point.x, point.z, area.rot, selectedCardId, cardMeshesRef);
    });

    // Outside the battlefield rectangle's own near edge (past where addPlayerLabel puts the
    // name/life plate) rather than inside it, so it doesn't eat into permanent placement room —
    // see the module comment on TABLE_WIDTH/TABLE_DEPTH.
    const handLabelZ = area.rot === 0 ? area.maxZ + 0.9 : area.minZ - 0.9;
    addTextPlane(group, `Hand ${seat.zones.hand}`, area.x, handLabelZ, area.rot, 0.34);
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

// A player's battlefield area is a fixed-size rectangle (see PLAYER_AREAS), but a Commander board
// routinely grows past what a static 5-wide/2-row grid can hold without overlap — this used to be
// papered over by hard-capping rendering at 12 permanents (see git history), which made anything
// beyond that literally invisible and unclickable rather than just cramped. Instead, grow the
// column count (and shrink row spacing) with the actual permanent count so everything still gets a
// mesh and a screen position, even if cards sit closer together once a board gets very wide.
function defaultBattlefieldPosition(area: (typeof PLAYER_AREAS)[number], cardIndex: number, totalCards: number) {
  const availableWidth = area.maxX - area.minX - 1.1;
  const availableDepth = area.maxZ - area.minZ - 1.3;
  const maxColumnsByWidth = Math.max(1, Math.floor(availableWidth / 0.85) + 1);
  const columns = Math.min(maxColumnsByWidth, Math.max(5, Math.ceil(Math.sqrt(totalCards * 2.2))));
  const rows = Math.max(1, Math.ceil(totalCards / columns));
  const xStep = columns > 1 ? Math.min(1.15, availableWidth / (columns - 1)) : 0;
  const zStep = rows > 1 ? Math.min(1.25, availableDepth / (rows - 1)) : 1.25;

  const col = cardIndex % columns;
  const row = Math.floor(cardIndex / columns);
  const x = THREE.MathUtils.clamp(area.minX + 2 + col * xStep, area.minX + 0.55, area.maxX - 0.55);
  const zDir = area.rot === 0 ? -1 : 1;
  const startZ = area.rot === 0 ? area.maxZ - 2 : area.minZ + 2;
  const z = THREE.MathUtils.clamp(startZ + row * zDir * zStep, area.minZ + 0.55, area.maxZ - 0.55);
  return { x, z };
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
