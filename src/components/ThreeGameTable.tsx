"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

interface ThreeGameTableProps {
  session: GameSession;
  prioritySeatId?: string;
  selectedCardId?: string;
  inspectedCard?: VisibleCard;
  onInspectCard?: (card: VisibleCard) => void;
  onSelectHandCard?: (card: VisibleCard) => void;
  onDrawCard?: (seatId: string) => void;
  onPlayCard?: (seatId: string, cardId: string) => void;
  gameStage?: "mulligan" | "playing";
  humanMulligans?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onAdvanceTurn?: () => void;
  onPassPriority?: () => void;
  onRespond?: () => void;
}

interface CardUserData {
  kind: "card";
  card: VisibleCard;
  seatId: string;
  location: "hand" | "battlefield" | "command";
}

const PLAYER_POSITIONS = [
  { x: 0, z: 7.5, rot: 0 },
  { x: -8.5, z: -2.5, rot: Math.PI / 2 },
  { x: 0, z: -7.5, rot: Math.PI },
  { x: 8.5, z: -2.5, rot: -Math.PI / 2 }
];

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
  const pointer = useRef({ down: false, button: 0, x: 0, y: 0, moved: false });
  const human = props.session.seats.find((seat) => seat.kind === "human") ?? props.session.seats[0];
  const latest = props.session.events[0];

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
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight("#d8d0b7", 1.8));
    const directional = new THREE.DirectionalLight("#fff4d6", 2.5);
    directional.position.set(3, 8, 4);
    scene.add(directional);

    const table = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.35, 15),
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

    const animate = () => {
      updateCamera();
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(animate);
    };

    const pickCard = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects(cardMeshesRef.current, true)[0];
      const data = hit?.object.userData as Partial<CardUserData> | undefined;
      if (data?.kind !== "card" || !data.card) return;
      propsRef.current.onInspectCard?.(data.card);
      if (data.location === "hand") propsRef.current.onSelectHandCard?.(data.card);
    };

    const onPointerDown = (event: PointerEvent) => {
      pointer.current = { down: true, button: event.button, x: event.clientX, y: event.clientY, moved: false };
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointer.current.down) return;
      const dx = event.clientX - pointer.current.x;
      const dy = event.clientY - pointer.current.y;
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointer.current.moved = true;
      if (pointer.current.button === 2 || event.shiftKey) {
        cameraState.current.target.x -= dx * 0.025;
        cameraState.current.target.z -= dy * 0.025;
      } else {
        cameraState.current.yaw -= dx * 0.006;
        cameraState.current.pitch = THREE.MathUtils.clamp(cameraState.current.pitch - dy * 0.004, -1.25, -0.25);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!pointer.current.moved) pickCard(event);
      pointer.current.down = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.current.distance = THREE.MathUtils.clamp(cameraState.current.distance + event.deltaY * 0.015, 7, 34);
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    resize();
    animate();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
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

  return (
    <section className="three-game-shell">
      <div className="three-board" ref={mountRef} />
      <div className="three-hud top-left">
        <span>Turn {props.session.turn}</span>
        <strong>{activeName}</strong>
        <small>{props.session.phase}</small>
      </div>
      <div className="three-hud top-right">
        <button type="button" onClick={resetCamera}>Reset Camera</button>
        <small>Drag rotate | wheel zoom | shift/right drag pan</small>
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
            <button type="button" onClick={props.onAdvanceTurn}>Next Turn</button>
            <button type="button" disabled={props.prioritySeatId !== human.id} onClick={props.onPassPriority}>Pass Priority</button>
          </div>
        )}
      </div>
      <div className="three-hud bottom-right">
        {props.inspectedCard ? (
          <div className="hud-card-detail">
            <strong>{props.inspectedCard.name}</strong>
            <span>{props.inspectedCard.typeLine}</span>
            <p>{props.inspectedCard.oracleText}</p>
          </div>
        ) : latest ? (
          <div className="hud-card-detail">
            <strong>Latest</strong>
            <p>{latest.message}</p>
          </div>
        ) : (
          <div className="hud-card-detail">
            <p>Click a card to inspect it.</p>
          </div>
        )}
      </div>
    </section>
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
    const position = PLAYER_POSITIONS[index] ?? PLAYER_POSITIONS[0];
    addPlayerLabel(group, seat, position);
    addZonePile(group, "Deck", seat.zones.library, position.x - 2.8, position.z + 1.8, position.rot);
    addZonePile(group, "Grave", seat.zones.graveyard, position.x + 2.8, position.z + 1.8, position.rot);

    if (seat.board.commander) {
      addCard(group, seat.board.commander, seat.id, "command", position.x - 3.1, position.z - 0.3, position.rot, selectedCardId, cardMeshesRef);
    }

    seat.board.battlefield.slice(0, 12).forEach((card, cardIndex) => {
      const col = cardIndex % 4;
      const row = Math.floor(cardIndex / 4);
      addCard(group, card, seat.id, "battlefield", position.x - 1.35 + col * 0.9, position.z - 0.9 - row * 1.25, position.rot, selectedCardId, cardMeshesRef);
    });

    if (seat.kind === "human") {
      seat.board.hand.forEach((card, cardIndex) => {
        addCard(group, card, seat.id, "hand", -3 + cardIndex * 0.85, 5.25, 0, selectedCardId, cardMeshesRef);
      });
    } else {
      addZonePile(group, "Hand", seat.zones.hand, position.x, position.z + 2.1, position.rot);
    }
  });
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
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rot + (card.tapped ? Math.PI / 2 : 0);
  mesh.position.set(x, 0.08, z);
  mesh.userData = { kind: "card", card, seatId, location } satisfies CardUserData;
  group.add(mesh);
  cardMeshesRef.current.push(mesh);
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

function addPlayerLabel(group: THREE.Group, seat: PlayerSeat, position: { x: number; z: number; rot: number }) {
  addTextPlane(group, `${seat.name} | ${seat.life}`, position.x, position.z + 3, position.rot, 0.62);
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
