"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type MutableRefObject } from "react";
import * as THREE from "three";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
type ManaPool = Record<ManaColor, number>;

interface ThreeGameTableProps {
  session: GameSession;
  prioritySeatId?: string;
  selectedCardId?: string;
  selectedCardCanRespond?: boolean;
  inspectedCard?: VisibleCard;
  libraryLook?: LibraryLookState;
  ruleChoice?: RuleChoiceView;
  blockChoice?: BlockChoiceView;
  myriadSearchCards?: VisibleCard[];
  pendingAction?: PendingActionView;
  stackActions?: PendingActionView[];
  manaPool?: ManaPool;
  manaChoice?: {
    cardName: string;
    choices: ManaColor[];
  };
  onInspectCard?: (card: VisibleCard) => void;
  onCloseInspectCard?: () => void;
  onSelectHandCard?: (card: VisibleCard) => void;
  onDrawCard?: (seatId: string) => void;
  onPlayCard?: (seatId: string, cardId: string, position?: { x: number; z: number }) => void;
  onShuffleLibrary?: (seatId: string) => void;
  onOpenLibrarySearch?: () => void;
  onCloseLibrarySearch?: () => void;
  onSearchLibraryCardToHand?: (cardId: string) => void;
  onChooseNextTrigger?: (sourceCardId: string) => void;
  onCloseMyriadSearch?: () => void;
  onCompleteMyriadSearch?: (cardIds: string[]) => void;
  onMoveCardToGraveyard?: (seatId: string, cardId: string) => void;
  onMoveCardToExile?: (seatId: string, cardId: string) => void;
  onMoveCardToHand?: (seatId: string, cardId: string) => void;
  onMoveBattlefieldCard?: (seatId: string, cardId: string, position: { x: number; z: number }) => void;
  onChangeCounter?: (seatId: string, cardId: string, kind: string, delta: number) => void;
  onCastCommander?: (seatId: string, position?: { x: number; z: number }) => void;
  onResolveMyriadLandscape?: (seatId: string, cardId: string) => void;
  onChangeLife?: (seatId: string, delta: number) => void;
  onScry?: (count: number) => void;
  onSurveil?: (count: number) => void;
  onKeepLibraryLookCardOnTop?: (cardId: string) => void;
  onOrderLibraryLookCardOnTop?: (cardId: string) => void;
  onPutLibraryLookCardOnBottom?: (cardId: string) => void;
  onPutLibraryLookCardInGraveyard?: (cardId: string) => void;
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
  onChooseBlocker?: (blockerCardId: string) => void;
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
      message: string;
    }
  | {
      id: string;
      type: "trigger";
      actorSeatId: string;
      controllerSeatId: string;
      sourceCardName: string;
      triggerKind: "draw";
      message: string;
    };

type RuleChoiceView =
  | {
      kind: "choose_card_from_library";
      sourceCardName: string;
      prompt: string;
      cards: VisibleCard[];
      destination: "hand" | "battlefield";
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
    };

interface BlockChoiceView {
  attackerName: string;
  defenderName: string;
  attackingCard: VisibleCard;
  blockers: VisibleCard[];
}

interface LibraryLookState {
  seatId: string;
  mode: "scry" | "surveil" | "reorder";
  cards: VisibleCard[];
  remaining: number;
  orderedCards?: VisibleCard[];
}

type DraggedZone = "hand" | "graveyard" | "exile";

interface CardUserData {
  kind: "card";
  card: VisibleCard;
  seatId: string;
  location: "battlefield" | "command";
}

const TABLE_WIDTH = 24;
const TABLE_DEPTH = 10;

const PLAYER_AREAS = [
  { x: -6, z: 2.55, rot: 0, minX: -11.25, maxX: -0.75, minZ: 0.45, maxZ: 4.45 },
  { x: 6, z: 2.55, rot: 0, minX: 0.75, maxX: 11.25, minZ: 0.45, maxZ: 4.45 },
  { x: -6, z: -2.55, rot: Math.PI, minX: -11.25, maxX: -0.75, minZ: -4.45, maxZ: -0.45 },
  { x: 6, z: -2.55, rot: Math.PI, minX: 0.75, maxX: 11.25, minZ: -4.45, maxZ: -0.45 }
];

const imageTextureLoader = new THREE.TextureLoader();
const cardImageTextureCache = new Map<string, THREE.Texture>();

export function ThreeGameTable(props: ThreeGameTableProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const dynamicGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cardMeshesRef = useRef<THREE.Object3D[]>([]);
  const frameRef = useRef<number | undefined>(undefined);
  const propsRef = useRef(props);
  const cameraState = useRef({ yaw: 0, pitch: -0.85, distance: 18, target: new THREE.Vector3(0, 0, 0) });
  const movementKeys = useRef({ forward: false, left: false, back: false, right: false });
  const boardInputActive = useRef(false);
  const pointer = useRef({ down: false, button: 0, x: 0, y: 0, moved: false });
  const hoveredCardRef = useRef<CardUserData | undefined>(undefined);
  const draggedBattlefieldCardRef = useRef<CardUserData | undefined>(undefined);
  const [draggingHandCardId, setDraggingHandCardId] = useState<string | undefined>();
  const [draggingZone, setDraggingZone] = useState<DraggedZone | undefined>();
  const human = props.session.seats.find((seat) => seat.kind === "human") ?? props.session.seats[0];
  const latest = props.session.events[0];
  const phaseNotice = latest?.detail === "Phase change" ? latest : undefined;
  const recentEvents = props.session.events.slice(0, 8);
  const prioritySeat = props.session.seats.find((seat) => seat.id === props.prioritySeatId);
  const humanHasPriority = props.prioritySeatId === human.id;
  const humanIsActive = props.session.activePlayerId === human.id;
  const stackTopFirst = [...(props.stackActions ?? [])].reverse();
  const mulliganSelectedCount = props.mulliganReturnCardIds?.length ?? 0;
  const mulliganRequired = props.mulliganReturnRequired ?? 0;

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

    const center = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 2.15, 64),
      new THREE.MeshBasicMaterial({ color: "#d7b35a", transparent: true, opacity: 0.16, side: THREE.DoubleSide })
    );
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.02;
    scene.add(center);

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

    const animate = () => {
      const now = performance.now();
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      updateKeyboardMovement(deltaSeconds);
      updateCamera();
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
      const data = hit?.object.userData as Partial<CardUserData> | undefined;
      if (data?.kind !== "card" || !data.card) return;
      propsRef.current.onInspectCard?.(data.card);
    };

    const updateHoveredCard = (event: PointerEvent) => {
      const hit = raycastCard(event);
      const data = hit?.object.userData as Partial<CardUserData> | undefined;
      hoveredCardRef.current = data?.kind === "card" && data.card && data.seatId && data.location ? (data as CardUserData) : undefined;
      const hovered = hoveredCardRef.current;
      renderer.domElement.style.cursor = hovered?.location === "battlefield" && hovered.seatId === propsRef.current.session.seats.find((seat) => seat.kind === "human")?.id ? "grab" : hovered ? "pointer" : "";
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
      if (draggedCard) {
        propsRef.current.onMoveBattlefieldCard?.(draggedCard.seatId, draggedCard.card.id, getTablePosition(event, draggedCard.seatId));
        draggedBattlefieldCardRef.current = undefined;
        updateHoveredCard(event);
      } else if (!pointer.current.moved) pickCard(event);
      pointer.current.down = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.current.distance = THREE.MathUtils.clamp(cameraState.current.distance + event.deltaY * 0.015, 7, 34);
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
    rebuildDynamicScene(dynamicGroupRef.current, props.session, props.selectedCardId, cardMeshesRef);
  }, [props.session, props.selectedCardId]);

  const activeName = useMemo(
    () => props.session.seats.find((seat) => seat.id === props.session.activePlayerId)?.name ?? "Active player",
    [props.session]
  );

  function resetCamera() {
    cameraState.current = { yaw: 0, pitch: -0.85, distance: 18, target: new THREE.Vector3(0, 0, 0) };
  }

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
    if (zone === "hand") props.onSelectHandCard?.(card);
  }

  function onCardDragEnd() {
    setDraggingHandCardId(undefined);
    setDraggingZone(undefined);
  }

  function onBoardDragOver(event: DragEvent<HTMLDivElement>) {
    if (props.gameStage !== "playing") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
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
    if (!cardId || props.gameStage !== "playing" || zone !== "hand") return;
    props.onPlayCard?.(human.id, cardId, getClampedDropPosition(event));
  }

  function onGraveyardDragOver(event: DragEvent<HTMLDivElement>) {
    if (props.gameStage !== "playing") return;
    const { zone } = getDraggedCard(event);
    if (zone !== "hand") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onGraveyardDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const { cardId, zone } = getDraggedCard(event);
    setDraggingHandCardId(undefined);
    setDraggingZone(undefined);
    if (!cardId || zone !== "hand") return;
    props.onMoveCardToGraveyard?.(human.id, cardId);
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

  function onExileDragOver(event: DragEvent<HTMLDivElement>) {
    if (props.gameStage !== "playing") return;
    const { zone } = getDraggedCard(event);
    if (zone !== "hand" && zone !== "graveyard") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onExileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const { cardId, zone } = getDraggedCard(event);
    setDraggingHandCardId(undefined);
    setDraggingZone(undefined);
    if (!cardId || (zone !== "hand" && zone !== "graveyard")) return;
    props.onMoveCardToExile?.(human.id, cardId);
  }

  const inspectedOwner = props.inspectedCard ? findCardOwner(props.session, props.inspectedCard.id) : undefined;
  const graveyard = human.board.graveyard ?? [];
  const exile = human.board.exile ?? [];

  return (
    <section className="three-game-shell">
      <div className={`three-board ${draggingHandCardId ? "is-drop-target" : ""}`} ref={mountRef} onDragOver={onBoardDragOver} onDrop={onBoardDrop} />
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
        <button type="button" onClick={resetCamera}>Reset Camera</button>
        <small>WASD move | drag rotate | wheel zoom | shift/right drag pan</small>
      </div>
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
            <button type="button" disabled={!props.selectedCardId} onClick={() => props.selectedCardId && props.onPlayCard?.(human.id, props.selectedCardId)}>
              Play Selected
            </button>
            <button type="button" disabled={Boolean(props.pendingAction)} onClick={props.onAdvanceTurn}>Advance Phase</button>
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
      <div className="three-hud bottom-right">
        {props.pendingAction ? (
          <div className="hud-card-detail stack-detail">
            <strong>{props.pendingAction.type === "spell" ? "Stack" : props.pendingAction.type === "trigger" ? "Trigger" : "Phase Change"}</strong>
            <p>{props.pendingAction.message}</p>
            {stackTopFirst.length > 0 ? (
              <div className="stack-list" aria-label="Current stack">
                <span>Top of stack</span>
                {stackTopFirst.map((action, index) => (
                  <div className="stack-item" key={action.id}>
                    <small>{index === 0 ? "Resolving next" : "Below"}</small>
                    <strong>{action.type === "spell" ? action.cardName : action.type === "trigger" ? `${action.sourceCardName} trigger` : "Phase change"}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <span>{humanHasPriority ? "You have priority." : `${prioritySeat?.name ?? "An agent"} has priority.`}</span>
          </div>
        ) : latest ? (
          <div className="hud-card-detail">
            <strong>Agent Activity</strong>
            <div className="activity-feed">
              {recentEvents.map((event) => (
                <p key={event.id}>{event.message}</p>
              ))}
            </div>
          </div>
        ) : (
          <div className="hud-card-detail">
            <p>Click a card to inspect it.</p>
          </div>
        )}
      </div>
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
          onCastCommander={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "command"
              ? () => props.onCastCommander?.(inspectedOwner.seat.id)
              : undefined
          }
          onChangeCounter={
            inspectedOwner?.seat.kind === "human" && inspectedOwner.zone === "battlefield" && props.inspectedCard.typeLine.includes("Creature")
              ? (delta) => props.onChangeCounter?.(inspectedOwner.seat.id, props.inspectedCard!.id, "+1/+1", delta)
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
      {props.blockChoice ? <BlockChoiceModal choice={props.blockChoice} onChoose={props.onChooseBlocker} onPass={props.onPassBlocks} /> : null}
      {props.myriadSearchCards ? (
        <MyriadSearchModal cards={props.myriadSearchCards} onClose={props.onCloseMyriadSearch} onChoose={props.onCompleteMyriadSearch} />
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
        <div className="three-zone-strip graveyard-strip">
          <div className="three-hand-heading">
            <strong>Graveyard</strong>
            <span>{graveyard.length} cards</span>
          </div>
          <div className={`three-graveyard-row ${draggingZone === "hand" ? "is-drop-target" : ""}`} onDragOver={onGraveyardDragOver} onDrop={onGraveyardDrop}>
            {graveyard.length === 0 ? <span className="zone-empty">Drop hand cards here</span> : null}
            {graveyard.map((card) => (
              <article
                className={`three-hand-card graveyard-card ${draggingHandCardId === card.id ? "dragging" : ""}`}
                draggable={props.gameStage === "playing"}
                key={card.id}
                onClick={() => props.onInspectCard?.(card)}
                onDragStart={(event) => onCardDragStart(event, card, "graveyard")}
                onDragEnd={onCardDragEnd}
                title={`${card.name}\n${card.typeLine}\n${card.oracleText}`}
              >
                {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" draggable={false} /> : <FallbackHandCard card={card} />}
                <span className="sr-only">{card.name}</span>
              </article>
            ))}
          </div>
        </div>
        <div className="three-zone-strip graveyard-strip">
          <div className="three-hand-heading">
            <strong>Exile</strong>
            <span>{exile.length} cards</span>
          </div>
          <div className={`three-graveyard-row ${draggingZone === "hand" || draggingZone === "graveyard" ? "is-drop-target" : ""}`} onDragOver={onExileDragOver} onDrop={onExileDrop}>
            {exile.length === 0 ? <span className="zone-empty">Drop cards here to exile</span> : null}
            {exile.map((card) => (
              <article
                className="three-hand-card graveyard-card"
                key={card.id}
                onClick={() => props.onInspectCard?.(card)}
                title={`${card.name}\n${card.typeLine}\n${card.oracleText}`}
              >
                {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" draggable={false} /> : <FallbackHandCard card={card} />}
                <span className="sr-only">{card.name}</span>
              </article>
            ))}
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
  onCastCommander,
  onChangeCounter
}: {
  card: VisibleCard;
  owner?: ReturnType<typeof findCardOwner>;
  onClose?: () => void;
  onMoveToGraveyard?: () => void;
  onMoveToExile?: () => void;
  onResolveMyriadLandscape?: () => void;
  onCastCommander?: () => void;
  onChangeCounter?: (delta: number) => void;
}) {
  const imageUrl = card.imageUris?.large ?? card.imageUris?.normal ?? card.imageUris?.png ?? card.faces?.[0]?.imageUris?.large ?? card.faces?.[0]?.imageUris?.normal;
  const colorText = card.colors.length > 0 ? card.colors.join("") : "Colorless";
  const identityText = card.colorIdentity && card.colorIdentity.length > 0 ? card.colorIdentity.join("") : colorText;
  const faces = card.faces?.filter((face) => face.name !== card.name) ?? [];
  const plusCounters = card.counters?.find((counter) => counter.kind === "+1/+1")?.count ?? 0;

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
          {onCastCommander ? (
            <button className="inspector-action" type="button" onClick={onCastCommander}>
              Cast Commander{card.commanderTax ? ` (+${card.commanderTax})` : ""}
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
                <dd>{card.power}/{card.toughness}</dd>
              </div>
            ) : null}
            {card.commander ? (
              <div>
                <dt>Commander</dt>
                <dd>Yes</dd>
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
  onGraveyard
}: {
  look: LibraryLookState;
  onClose?: () => void;
  onKeepTop?: (cardId: string) => void;
  onOrderTop?: (cardId: string) => void;
  onBottom?: (cardId: string) => void;
  onGraveyard?: (cardId: string) => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label={`${look.mode} library cards`} onClick={onClose}>
      <article className="library-look-modal" onClick={(event) => event.stopPropagation()}>
        <button className="card-inspector-close" type="button" onClick={onClose} aria-label="Close library look">
          x
        </button>
        <header>
          <p className="eyebrow">{look.mode}</p>
          <h2>{look.mode === "scry" ? `Scry ${look.remaining}` : look.mode === "reorder" ? "Choose Order" : "Top of library"}</h2>
          <p>
            {look.mode === "surveil"
              ? "Choose each card for the top of your library or your graveyard. The last card you put on top will be the top card."
              : look.mode === "reorder"
                ? "Choose the top card first, then the second card, and so on."
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
  destination: "hand" | "battlefield";
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

const basicLandTypeOrder = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];

function cardBasicLandTypes(card: VisibleCard) {
  return basicLandTypeOrder.filter((type) => card.name === type || card.typeLine.includes(type));
}

function FallbackLargeCard({ card }: { card: VisibleCard }) {
  return (
    <div className="card-inspector-fallback">
      <strong>{card.name}</strong>
      <span>{card.typeLine}</span>
      <p>{card.oracleText}</p>
      {card.power && card.toughness ? <em>{card.power}/{card.toughness}</em> : null}
    </div>
  );
}

function BlockChoiceModal({ choice, onChoose, onPass }: { choice: BlockChoiceView; onChoose?: (blockerCardId: string) => void; onPass?: () => void }) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Choose blockers">
      <article className="library-search-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <p className="eyebrow">Blockers</p>
          <h2>{choice.defenderName} is being attacked</h2>
          <p>
            {choice.attackerName} attacks with {choice.attackingCard.name}. Choose one blocker or take the damage.
          </p>
        </header>
        <div className="library-card-grid">
          {choice.blockers.map((card) => (
            <button className="library-card-button" type="button" key={card.id} onClick={() => onChoose?.(card.id)}>
              {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" /> : <FallbackHandCard card={card} />}
              <span>{card.name}</span>
              <small>{card.typeLine}</small>
            </button>
          ))}
          {choice.blockers.length === 0 ? <p>No legal blockers are available.</p> : null}
        </div>
        <div className="modal-actions">
          <button className="inspector-action" type="button" onClick={onPass}>
            Do Not Block
          </button>
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
    addPlayerLabel(group, seat, area);
    addZonePile(group, "Deck", seat.zones.library, area.minX + 0.75, area.maxZ - 0.8, area.rot);
    addZonePile(group, "Grave", seat.zones.graveyard, area.maxX - 0.75, area.maxZ - 0.8, area.rot);

    if (seat.board.commander) {
      addCard(group, seat.board.commander, seat.id, "command", area.minX + 0.9, area.minZ + 0.8, area.rot, selectedCardId, cardMeshesRef);
    }

    seat.board.battlefield.slice(0, 12).forEach((card, cardIndex) => {
      const point = card.battlefieldPosition ?? defaultBattlefieldPosition(area, cardIndex);
      addCard(group, card, seat.id, "battlefield", point.x, point.z, area.rot, selectedCardId, cardMeshesRef);
    });

    addTextPlane(group, `Hand ${seat.zones.hand}`, area.x, area.maxZ - 0.8, area.rot, 0.34);
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

function defaultBattlefieldPosition(area: (typeof PLAYER_AREAS)[number], cardIndex: number) {
  const col = cardIndex % 5;
  const row = Math.floor(cardIndex / 5);
  const x = THREE.MathUtils.clamp(area.minX + 2 + col * 1.15, area.minX + 0.55, area.maxX - 0.55);
  const zStep = area.rot === 0 ? -1 : 1;
  const startZ = area.rot === 0 ? area.maxZ - 2 : area.minZ + 2;
  const z = THREE.MathUtils.clamp(startZ + row * zStep * 1.25, area.minZ + 0.65, area.maxZ - 0.65);
  return { x, z };
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
  const imageUrl = card.imageUris?.normal ?? card.imageUris?.large ?? card.imageUris?.png ?? card.faces?.[0]?.imageUris?.normal;
  if (imageUrl) {
    applyImageTexture(imageUrl, material);
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rot + (card.tapped ? Math.PI / 2 : 0);
  mesh.position.set(x, 0.08, z);
  mesh.userData = { kind: "card", card, seatId, location } satisfies CardUserData;
  group.add(mesh);
  cardMeshesRef.current.push(mesh);
}

function applyImageTexture(url: string, material: THREE.MeshBasicMaterial) {
  const cached = cardImageTextureCache.get(url);
  if (cached) {
    material.map = cached;
    material.needsUpdate = true;
    return;
  }

  imageTextureLoader.load(
    url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      cardImageTextureCache.set(url, texture);
      material.map = texture;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      cardImageTextureCache.delete(url);
    }
  );
}

function addZonePile(group: THREE.Group, label: string, count: number, x: number, z: number, rot: number) {
  const pile = new THREE.Group();
  for (let index = 0; index < Math.min(4, count); index += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.035, 1),
      new THREE.MeshStandardMaterial({ color: "#263b57", roughness: 0.75 })
    );
    mesh.position.y = 0.04 + index * 0.035;
    pile.add(mesh);
  }
  pile.position.set(x, 0.05, z);
  pile.rotation.y = rot;
  group.add(pile);
  addTextPlane(group, `${label} ${count}`, x, z + 0.75, rot, 0.42);
}

function addPlayerLabel(group: THREE.Group, seat: PlayerSeat, area: (typeof PLAYER_AREAS)[number]) {
  const z = area.rot === 0 ? area.maxZ + 0.35 : area.minZ - 0.35;
  addTextPlane(group, `${seat.name} | ${seat.life}`, area.x, z, area.rot, 0.62);
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
  if (card.power && card.toughness) context.fillText(`${card.power}/${card.toughness}`, 186, 324);
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
