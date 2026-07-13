"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type MutableRefObject } from "react";
import * as THREE from "three";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

interface ThreeGameTableProps {
  session: GameSession;
  prioritySeatId?: string;
  thinkingSeatId?: string;
  selectedCardId?: string;
  inspectedCard?: VisibleCard;
  onInspectCard?: (card: VisibleCard | undefined) => void;
  onSelectHandCard?: (card: VisibleCard) => void;
  onDrawCard?: (seatId: string) => void;
  onPlayCard?: (seatId: string, cardId: string, position?: { x: number; z: number }) => void;
  onMoveCard?: (seatId: string, cardId: string, position: { x: number; z: number }) => void;
  gameStage?: "mulligan" | "playing";
  humanMulligans?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onAdvanceTurn?: () => void;
  onPassPriority?: () => void;
  onRespond?: () => void;
  onCastCommander?: () => void;
  onMill?: () => void;
  onScryBottom?: () => void;
  onTutor?: (cardId: string) => void;
  onAdjustLife?: (seatId: string, delta: number) => void;
  onToggleTap?: (cardId: string) => void;
  onTransform?: (cardId: string) => void;
  onDestroyCard?: (cardId: string) => void;
}

interface CardUserData {
  kind: "card";
  card: VisibleCard;
  seatId: string;
  location: "battlefield" | "command";
}

interface PileUserData {
  kind: "pile";
  seatId: string;
  seatName: string;
  zone: "library" | "graveyard";
  count: number;
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
  const pileMeshesRef = useRef<THREE.Object3D[]>([]);
  const pileTooltipRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const propsRef = useRef(props);
  const cameraState = useRef({ yaw: 0, pitch: -0.85, distance: 18, target: new THREE.Vector3(0, 0, 0) });
  const movementKeys = useRef({ forward: false, left: false, back: false, right: false });
  const boardInputActive = useRef(false);
  const pointer = useRef({ down: false, button: 0, x: 0, y: 0, moved: false });
  const cardDrag = useRef<{ mesh: THREE.Object3D; cardId: string; seatId: string } | null>(null);
  const [draggingHandCardId, setDraggingHandCardId] = useState<string | undefined>();
  const [logOpen, setLogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [thoughtSeatId, setThoughtSeatId] = useState<string | undefined>();
  const [openPile, setOpenPile] = useState<{ seatId: string; zone: "library" | "graveyard" } | undefined>();

  // Auto-open the bubble of whichever agent is currently reasoning, so it reads in real time.
  useEffect(() => {
    if (props.thinkingSeatId) setThoughtSeatId(props.thinkingSeatId);
  }, [props.thinkingSeatId]);
  const human = props.session.seats.find((seat) => seat.kind === "human") ?? props.session.seats[0];
  const logEvents = props.session.events.slice(0, 30);
  const isHumanTurn = props.session.activePlayerId === human.id;
  const commanderCastable = human.board.commander?.zone === "command";
  const inspectedOnBattlefield = props.inspectedCard
    ? props.session.seats.some((seat) => seat.board.battlefield.some((card) => card.id === props.inspectedCard?.id))
    : false;

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

    const raycastScene = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      return raycaster.intersectObjects([...cardMeshesRef.current, ...pileMeshesRef.current], true)[0];
    };

    const raycastTablePoint = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08), new THREE.Vector3());
    };

    const humanArea = () => {
      const seats = propsRef.current.session.seats;
      const humanIndex = Math.max(0, seats.findIndex((seat) => seat.kind === "human"));
      return PLAYER_AREAS[humanIndex] ?? PLAYER_AREAS[0];
    };

    const beginCardDrag = (event: PointerEvent) => {
      const hit = raycastScene(event);
      const data = hit?.object.userData as Partial<CardUserData> | undefined;
      if (data?.kind !== "card" || !data.card || !data.seatId || data.location !== "battlefield") return false;
      const humanId = propsRef.current.session.seats.find((seat) => seat.kind === "human")?.id;
      if (data.seatId !== humanId) return false;
      cardDrag.current = { mesh: hit!.object, cardId: data.card.id, seatId: data.seatId };
      renderer.domElement.style.cursor = "grabbing";
      return true;
    };

    const pickCard = (event: PointerEvent) => {
      const hit = raycastScene(event);
      const data = hit?.object.userData as CardUserData | PileUserData | undefined;
      if (data?.kind === "card" && data.card) {
        propsRef.current.onInspectCard?.(data.card);
      } else if (data?.kind === "pile" && data.seatId && data.zone) {
        const humanId = propsRef.current.session.seats.find((seat) => seat.kind === "human")?.id;
        if (data.zone === "library" && data.seatId === humanId) {
          // Your own library opens the full search/scry panel.
          setOpenPile(undefined);
          setLibraryOpen(true);
        } else {
          setLibraryOpen(false);
          setOpenPile({ seatId: data.seatId, zone: data.zone });
        }
      }
    };

    const updatePileTooltip = (event: PointerEvent) => {
      const tooltip = pileTooltipRef.current;
      if (!tooltip) return;
      const hit = raycastScene(event);
      const data = hit?.object.userData as Partial<PileUserData> | undefined;
      if (data?.kind === "pile") {
        tooltip.textContent = `${data.seatName} — ${data.zone === "library" ? "library" : "graveyard"} · ${data.count} card${data.count === 1 ? "" : "s"}`;
        tooltip.style.display = "block";
        tooltip.style.left = `${event.clientX + 14}px`;
        tooltip.style.top = `${event.clientY + 14}px`;
        renderer.domElement.style.cursor = "pointer";
      } else {
        tooltip.style.display = "none";
        if (!cardDrag.current) renderer.domElement.style.cursor = "";
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      boardInputActive.current = true;
      renderer.domElement.focus();
      pointer.current = { down: true, button: event.button, x: event.clientX, y: event.clientY, moved: false };
      renderer.domElement.setPointerCapture(event.pointerId);
      if (event.button === 0 && !event.shiftKey) beginCardDrag(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointer.current.down) {
        updatePileTooltip(event);
        return;
      }
      if (pileTooltipRef.current) pileTooltipRef.current.style.display = "none";
      const dx = event.clientX - pointer.current.x;
      const dy = event.clientY - pointer.current.y;
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointer.current.moved = true;

      if (cardDrag.current) {
        const point = raycastTablePoint(event);
        if (point) {
          const area = humanArea();
          cardDrag.current.mesh.position.x = THREE.MathUtils.clamp(point.x, area.minX + 0.45, area.maxX - 0.45);
          cardDrag.current.mesh.position.z = THREE.MathUtils.clamp(point.z, area.minZ + 0.6, area.maxZ - 0.6);
        }
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
      const drag = cardDrag.current;
      if (drag && pointer.current.moved) {
        propsRef.current.onMoveCard?.(drag.seatId, drag.cardId, { x: drag.mesh.position.x, z: drag.mesh.position.z });
      } else if (!pointer.current.moved) {
        pickCard(event);
      }
      cardDrag.current = null;
      renderer.domElement.style.cursor = "";
      pointer.current.down = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Multiplicative zoom stays smooth up close; near plane is 0.1 so 0.5 won't clip the table.
      cameraState.current.distance = THREE.MathUtils.clamp(cameraState.current.distance * (1 + event.deltaY * 0.001), 0.5, 60);
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const clearMovementKeys = () => {
      movementKeys.current = { forward: false, left: false, back: false, right: false };
    };

    const onPointerEnter = () => {
      boardInputActive.current = true;
    };

    const onPointerLeave = () => {
      boardInputActive.current = document.activeElement === renderer.domElement;
      if (!boardInputActive.current) clearMovementKeys();
      if (pileTooltipRef.current) pileTooltipRef.current.style.display = "none";
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
      if (key === "w") movementKeys.current.forward = active;
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
    rebuildDynamicScene(dynamicGroupRef.current, props.session, props.selectedCardId, cardMeshesRef, pileMeshesRef);
  }, [props.session, props.selectedCardId]);

  const activeName = useMemo(
    () => props.session.seats.find((seat) => seat.id === props.session.activePlayerId)?.name ?? "Active player",
    [props.session]
  );

  function resetCamera() {
    cameraState.current = { yaw: 0, pitch: -0.85, distance: 18, target: new THREE.Vector3(0, 0, 0) };
  }

  function onHandCardDragStart(event: DragEvent<HTMLElement>, card: VisibleCard) {
    if (props.gameStage !== "playing") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id);
    setDraggingHandCardId(card.id);
    props.onSelectHandCard?.(card);
  }

  function onHandCardDragEnd() {
    setDraggingHandCardId(undefined);
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
    const cardId = event.dataTransfer.getData("text/plain");
    setDraggingHandCardId(undefined);
    if (!cardId || props.gameStage !== "playing") return;
    props.onPlayCard?.(human.id, cardId, getClampedDropPosition(event));
  }

  return (
    <section className="three-game-shell">
      <div className={`three-board ${draggingHandCardId ? "is-drop-target" : ""}`} ref={mountRef} onDragOver={onBoardDragOver} onDrop={onBoardDrop} />
      <div className="three-hud top-left">
        <span>Turn {props.session.turn}</span>
        <strong>{activeName}</strong>
        <small>{props.session.phase}</small>
      </div>
      <div className="three-hud top-right">
        <button type="button" onClick={resetCamera}>Reset Camera</button>
        <small>drag your cards to move them | WASD move | drag rotate | wheel zoom | shift/right drag pan</small>
      </div>
      <button
        className="log-toggle"
        type="button"
        aria-label={logOpen ? "Hide game log" : "Show game log"}
        aria-expanded={logOpen}
        title="Game log"
        onClick={() => setLogOpen((open) => !open)}
      >
        🗒
      </button>
      {logOpen ? (
        <div className="three-hud log-panel hud-log" aria-label="Game log">
          <strong>Log</strong>
          <div className="log-entries">
            {logEvents.map((event) => (
              <p key={event.id} title={event.detail}>{event.message}</p>
            ))}
          </div>
        </div>
      ) : null}
      <div className="three-hud top-center life-strip" aria-label="Life totals">
        {props.session.seats.map((seat) => (
          <div className={`life-chip ${seat.id === props.session.activePlayerId ? "active" : ""}`} key={seat.id}>
            <span>{seat.name}</span>
            {seat.kind === "agent" ? (
              <button
                className={`thought-toggle ${seat.lastThought ? "has-thought" : ""}`}
                type="button"
                aria-label={`What is ${seat.name} thinking?`}
                aria-expanded={thoughtSeatId === seat.id}
                title={`What is ${seat.name} thinking?`}
                onClick={() => setThoughtSeatId((current) => (current === seat.id ? undefined : seat.id))}
              >
                💬
              </button>
            ) : null}
            <button type="button" aria-label={`${seat.name} lose life`} onClick={() => props.onAdjustLife?.(seat.id, -1)}>−</button>
            <strong>{seat.life}</strong>
            <button type="button" aria-label={`${seat.name} gain life`} onClick={() => props.onAdjustLife?.(seat.id, 1)}>+</button>
            {thoughtSeatId === seat.id ? (
              <div className="thought-bubble" role="note">
                <strong>{seat.name} is thinking:</strong>
                <p>
                  {seat.lastThought
                    ? `${seat.lastThought}${props.thinkingSeatId === seat.id ? " ▌" : ""}`
                    : props.thinkingSeatId === seat.id
                      ? "Thinking…"
                      : "Nothing yet — they share their reasoning on their turn."}
                </p>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="three-hud bottom-left">
        {props.gameStage === "mulligan" ? (
          <div className="hud-actions">
            <strong>{human.board.hand.length} cards</strong>
            <small>{(props.humanMulligans ?? 0) <= 1 ? "You may keep 7. First mulligan is free." : `Keep ${Math.max(1, 8 - (props.humanMulligans ?? 0))}.`}</small>
            <button type="button" onClick={props.onKeepHand}>Keep</button>
            <button type="button" onClick={props.onMulligan}>Mulligan</button>
          </div>
        ) : (
          <div className="hud-actions">
            <button type="button" onClick={() => props.onDrawCard?.(human.id)}>Draw</button>
            <button type="button" disabled={!props.selectedCardId} onClick={() => props.selectedCardId && props.onPlayCard?.(human.id, props.selectedCardId)}>
              Play Selected
            </button>
            {commanderCastable ? (
              <button type="button" onClick={props.onCastCommander}>Cast Commander</button>
            ) : null}
            <button type="button" onClick={() => { setOpenPile(undefined); setLibraryOpen((open) => !open); }}>
              {libraryOpen ? "Close Library" : "Library"}
            </button>
            <button type="button" disabled={!isHumanTurn} onClick={props.onAdvanceTurn} title={isHumanTurn ? undefined : "Agents finish their turns automatically."}>
              End Turn
            </button>
            {props.prioritySeatId === human.id ? (
              <button type="button" onClick={props.onPassPriority}>Pass Priority</button>
            ) : (
              <button type="button" onClick={props.onRespond}>Respond</button>
            )}
          </div>
        )}
      </div>
      {libraryOpen && props.gameStage === "playing" ? (
        <div className="three-hud library-panel" aria-label="Your library">
          <div className="library-heading">
            <strong>Library · {human.board.library.length} cards</strong>
            <button type="button" aria-label="Close library" onClick={() => setLibraryOpen(false)}>×</button>
          </div>
          {human.board.library[0] ? (
            <div className="library-top">
              <span>
                Top: <strong>{human.board.library[0].name}</strong> · {human.board.library[0].typeLine}
              </span>
              <div className="hud-card-actions">
                <button type="button" title="Surveil/mill: put the top card into your graveyard" onClick={props.onMill}>Mill 1</button>
                <button type="button" title="Scry: put the top card on the bottom" onClick={props.onScryBottom}>Bottom</button>
              </div>
            </div>
          ) : (
            <span>Your library is empty.</span>
          )}
          <input
            placeholder="Search your library..."
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
          />
          <div className="library-list">
            {[...human.board.library]
              .filter((card) => card.name.toLowerCase().includes(librarySearch.trim().toLowerCase()))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((card) => (
                <button
                  key={card.id}
                  type="button"
                  title={`${card.typeLine}\n${card.oracleText}\nClick to put into your hand (then shuffle).`}
                  onClick={() => props.onTutor?.(card.id)}
                >
                  <span>{card.name}</span>
                  <small>{card.manaValue > 0 ? `${card.manaValue} · ` : ""}{card.typeLine}</small>
                </button>
              ))}
          </div>
        </div>
      ) : null}
      {openPile ? <ZoneViewer openPile={openPile} session={props.session} onClose={() => setOpenPile(undefined)} onInspectCard={props.onInspectCard} /> : null}
      <div className="pile-tooltip" ref={pileTooltipRef} />
      <div className="three-hud bottom-right">
        {props.inspectedCard ? (
          <div className="hud-card-detail">
            {props.inspectedCard.imageUris?.normal ? <img src={props.inspectedCard.imageUris.normal} alt="" /> : null}
            <strong>{props.inspectedCard.name}</strong>
            <span>{props.inspectedCard.typeLine}</span>
            <p>{props.inspectedCard.oracleText}</p>
            {inspectedOnBattlefield ? (
              <div className="hud-card-actions">
                <button type="button" onClick={() => props.inspectedCard && props.onToggleTap?.(props.inspectedCard.id)}>
                  {props.inspectedCard.tapped ? "Untap" : "Tap"}
                </button>
                {(props.inspectedCard.faces?.length ?? 0) >= 2 ? (
                  <button type="button" onClick={() => props.inspectedCard && props.onTransform?.(props.inspectedCard.id)}>
                    Transform
                  </button>
                ) : null}
                <button type="button" onClick={() => props.inspectedCard && props.onDestroyCard?.(props.inspectedCard.id)}>
                  {props.inspectedCard.commander ? "To Command Zone" : "To Graveyard"}
                </button>
              </div>
            ) : null}
            <button type="button" onClick={() => props.onInspectCard?.(undefined)}>Close</button>
          </div>
        ) : (
          <div className="hud-card-detail">
            <p>Click a card to inspect it.</p>
          </div>
        )}
      </div>
      <div className="three-hand-panel" aria-label="Your hand">
        <div className="three-hand-heading">
          <strong>Your hand</strong>
          <span>{human.board.hand.length} cards</span>
        </div>
        <div className="three-hand-row">
          {human.board.hand.map((card) => (
            <article
              className={`three-hand-card ${props.selectedCardId === card.id ? "selected" : ""} ${draggingHandCardId === card.id ? "dragging" : ""}`}
              draggable={props.gameStage === "playing"}
              key={card.id}
              onClick={() => {
                props.onInspectCard?.(card);
                props.onSelectHandCard?.(card);
              }}
              onDragStart={(event) => onHandCardDragStart(event, card)}
              onDragEnd={onHandCardDragEnd}
              title={`${card.name}\n${card.typeLine}\n${card.oracleText}`}
            >
              {card.imageUris?.normal ? <img src={card.imageUris.normal} alt="" draggable={false} /> : <FallbackHandCard card={card} />}
              <span className="sr-only">{card.name}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ZoneViewer({
  openPile,
  session,
  onClose,
  onInspectCard
}: {
  openPile: { seatId: string; zone: "library" | "graveyard" };
  session: GameSession;
  onClose: () => void;
  onInspectCard?: (card: VisibleCard | undefined) => void;
}) {
  const seat = session.seats.find((item) => item.id === openPile.seatId);
  if (!seat) return null;
  // Graveyards show newest on top; libraries are sorted alphabetically so draw order stays hidden.
  const cards =
    openPile.zone === "graveyard"
      ? [...seat.board.graveyard].reverse()
      : [...seat.board.library].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="three-hud library-panel" aria-label={`${seat.name} ${openPile.zone}`}>
      <div className="library-heading">
        <strong>
          {seat.name} · {openPile.zone} · {cards.length} cards
        </strong>
        <button type="button" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {cards.length === 0 ? <span>Empty.</span> : null}
      <div className="library-list">
        {cards.map((card) => (
          <button key={card.id} type="button" title={`${card.typeLine}\n${card.oracleText}`} onClick={() => onInspectCard?.(card)}>
            <span>{card.name}</span>
            <small>{card.manaValue > 0 ? `${card.manaValue} · ` : ""}{card.typeLine}</small>
          </button>
        ))}
      </div>
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
  cardMeshesRef: MutableRefObject<THREE.Object3D[]>,
  pileMeshesRef: MutableRefObject<THREE.Object3D[]>
) {
  if (!group) return;
  group.clear();
  cardMeshesRef.current = [];
  pileMeshesRef.current = [];

  session.seats.forEach((seat, index) => {
    const area = PLAYER_AREAS[index] ?? PLAYER_AREAS[0];
    addBattlefieldArea(group, area, seat.kind === "human");
    addPlayerLabel(group, seat, area);
    addZonePile(group, "Deck", seat, "library", area.minX + 0.75, area.maxZ - 0.8, area.rot, pileMeshesRef);
    addZonePile(group, "Grave", seat, "graveyard", area.maxX - 0.75, area.maxZ - 0.8, area.rot, pileMeshesRef);

    if (seat.board.commander?.zone === "command") {
      addCard(group, seat.board.commander, seat.id, "command", area.minX + 0.9, area.minZ + 0.8, area.rot, selectedCardId, cardMeshesRef);
    }

    seat.board.battlefield.slice(0, 18).forEach((card, cardIndex) => {
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
  const col = cardIndex % 6;
  const row = Math.floor(cardIndex / 6);
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

function addZonePile(
  group: THREE.Group,
  label: string,
  seat: PlayerSeat,
  zone: PileUserData["zone"],
  x: number,
  z: number,
  rot: number,
  pileMeshesRef: MutableRefObject<THREE.Object3D[]>
) {
  const count = seat.zones[zone];
  const userData: PileUserData = { kind: "pile", seatId: seat.id, seatName: seat.name, zone, count };
  const pile = new THREE.Group();
  for (let index = 0; index < Math.min(4, count); index += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.035, 1),
      new THREE.MeshStandardMaterial({ color: "#263b57", roughness: 0.75 })
    );
    mesh.position.y = 0.04 + index * 0.035;
    mesh.userData = userData;
    pile.add(mesh);
    pileMeshesRef.current.push(mesh);
  }
  pile.position.set(x, 0.05, z);
  pile.rotation.y = rot;
  group.add(pile);

  // Always-present hit plane so empty piles stay clickable/hoverable.
  const hitPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.2),
    new THREE.MeshBasicMaterial({ color: "#263b57", transparent: true, opacity: count === 0 ? 0.15 : 0.01, side: THREE.DoubleSide })
  );
  hitPlane.rotation.x = -Math.PI / 2;
  hitPlane.rotation.z = rot;
  hitPlane.position.set(x, 0.03, z);
  hitPlane.userData = userData;
  group.add(hitPlane);
  pileMeshesRef.current.push(hitPlane);

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
