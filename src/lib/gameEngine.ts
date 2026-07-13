import type { CommanderDeck, DeckCard, PlayerSeat, VisibleCard } from "./types";

const BASIC_LAND_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"];
const PERMANENT_TYPES = /Creature|Artifact|Enchantment|Land|Planeswalker|Battle/;

export function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

export function isLand(card: VisibleCard) {
  return card.role === "land" || card.typeLine.includes("Land");
}

export function isPermanent(card: VisibleCard) {
  return PERMANENT_TYPES.test(card.typeLine);
}

export function visibleCardFromDeckCard(deckCard: DeckCard, colors: string[], id: string, zone: VisibleCard["zone"]): VisibleCard {
  const name = deckCard.card?.name ?? deckCard.name;
  const role = deckCard.role ?? "spell";
  const land = role === "land" || BASIC_LAND_NAMES.includes(name);
  const typeLine = deckCard.card?.typeLine;
  const creature = typeLine?.includes("Creature") ?? (["creature", "synergy", "wincon"].includes(role) && !land);
  return {
    id,
    name,
    typeLine: typeLine ?? (land ? "Land" : creature ? "Creature" : role === "removal" ? "Instant" : "Sorcery"),
    oracleText: deckCard.card?.oracleText ?? (land ? "Tap: Add mana." : `Mock ${role} card. Full rules text will come from card data lookup.`),
    manaValue: deckCard.card?.manaValue ?? (land ? 0 : role === "ramp" ? 2 : role === "removal" ? 2 : 4),
    colors: deckCard.card?.colors ?? (land ? [] : colors.slice(0, 1)),
    colorIdentity: deckCard.card?.colorIdentity ?? colors,
    imageUris: deckCard.card?.imageUris,
    faces: deckCard.card?.faces,
    role,
    zone,
    power: deckCard.card?.power ?? (creature ? "2" : undefined),
    toughness: deckCard.card?.toughness ?? (creature ? "2" : undefined)
  };
}

export function commanderVisibleCard(deck: CommanderDeck, seatId: string): VisibleCard {
  const record = deck.commanderCard;
  return {
    id: `${seatId}-commander`,
    name: record?.name ?? deck.commander,
    typeLine: record?.typeLine ?? "Legendary Creature - Commander",
    oracleText: record?.oracleText ?? "Commander. Full rules text will come from card data lookup.",
    manaValue: record?.manaValue ?? 4,
    colors: record?.colors ?? deck.colors,
    colorIdentity: record?.colorIdentity ?? deck.colors,
    imageUris: record?.imageUris,
    faces: record?.faces,
    role: "commander",
    zone: "command",
    commander: true,
    power: record?.power ?? "3",
    toughness: record?.toughness ?? "4"
  };
}

export function syncZones(seat: PlayerSeat): PlayerSeat {
  return {
    ...seat,
    zones: {
      ...seat.zones,
      library: seat.board.library.length,
      hand: seat.board.hand.length,
      battlefield: seat.board.battlefield.length,
      graveyard: seat.board.graveyard.length,
      command: seat.board.commander?.zone === "command" ? 1 : 0
    }
  };
}

export function freshSeatForGame(seat: PlayerSeat, deck?: CommanderDeck): PlayerSeat {
  const applied = deck ?? seat.deck;
  const commander = applied ? commanderVisibleCard(applied, seat.id) : undefined;
  const nonCommanderCards = applied
    ? applied.cards.filter((card) => card.role !== "commander" && card.name !== applied.commander)
    : [];
  const library = shuffle(
    nonCommanderCards.flatMap((card, cardIndex) =>
      Array.from({ length: card.count }, (_, copyIndex) =>
        visibleCardFromDeckCard(card, applied?.colors ?? [], `${seat.id}-lib-${cardIndex}-${copyIndex}`, "library")
      )
    )
  );
  return syncZones({
    ...seat,
    life: 40,
    commanderDamage: {},
    landsPlayed: 0,
    commanderCasts: 0,
    deck: applied,
    zones: { ...seat.zones, exile: 0 },
    board: { commander, hand: [], battlefield: [], library, graveyard: [] }
  });
}

export function drawCards(seat: PlayerSeat, count: number): { seat: PlayerSeat; drawn: VisibleCard[]; failed: number } {
  const drawn = seat.board.library.slice(0, count).map((card) => ({ ...card, zone: "hand" as const }));
  return {
    seat: syncZones({
      ...seat,
      board: {
        ...seat.board,
        library: seat.board.library.slice(drawn.length),
        hand: [...seat.board.hand, ...drawn]
      }
    }),
    drawn,
    failed: count - drawn.length
  };
}

export function mulliganHand(seat: PlayerSeat): PlayerSeat {
  const returned = seat.board.hand.map((card) => ({ ...card, zone: "library" as const }));
  const reshuffled = syncZones({
    ...seat,
    board: { ...seat.board, hand: [], library: shuffle([...seat.board.library, ...returned]) }
  });
  return drawCards(reshuffled, 7).seat;
}

export function bottomExcess(seat: PlayerSeat, keep: number): PlayerSeat {
  const hand = seat.board.hand.slice(0, keep);
  const bottomed = seat.board.hand.slice(keep).map((card) => ({ ...card, zone: "library" as const }));
  return syncZones({
    ...seat,
    board: { ...seat.board, hand, library: [...seat.board.library, ...bottomed] }
  });
}

export function openingHandKeepSize(mulliganCount: number) {
  if (mulliganCount <= 1) return 7;
  return Math.max(1, 8 - mulliganCount);
}

export function agentKeepsHand(seat: PlayerSeat) {
  const lands = seat.board.hand.filter(isLand).length;
  const ramp = seat.board.hand.filter((card) => card.role === "ramp").length;
  return lands >= 2 && lands <= 5 && lands + ramp >= 3;
}

export function startOfTurn(seat: PlayerSeat): PlayerSeat {
  return syncZones({
    ...seat,
    landsPlayed: 0,
    board: {
      ...seat.board,
      battlefield: seat.board.battlefield.map((card) => ({
        ...card,
        tapped: false,
        summoningSick: false,
        attacking: false,
        blocking: false
      }))
    }
  });
}

// ponytail: mana = land count + rock count, no colors or tapping; a real mana pool is the upgrade path.
export function availableMana(seat: PlayerSeat) {
  return seat.board.battlefield.filter(
    (card) => isLand(card) || (card.typeLine.includes("Artifact") && /add\b|\badd .*mana/i.test(card.oracleText))
  ).length;
}

export function commanderCost(seat: PlayerSeat) {
  return (seat.board.commander?.manaValue ?? 0) + 2 * (seat.commanderCasts ?? 0);
}

export function playFromHand(
  seat: PlayerSeat,
  cardId: string,
  position?: { x: number; z: number },
  options?: { keepNonPermanents?: boolean }
): { seat: PlayerSeat; played?: VisibleCard; destination?: "battlefield" | "graveyard"; error?: string } {
  const card = seat.board.hand.find((item) => item.id === cardId);
  if (!card) return { seat, error: "That card is not in hand." };
  if (isLand(card) && (seat.landsPlayed ?? 0) >= 1) {
    return { seat, error: "Already played a land this turn." };
  }

  // keepNonPermanents: human plays leave instants/sorceries on the field until manually sent to the graveyard.
  const destination = isPermanent(card) || options?.keepNonPermanents ? "battlefield" : "graveyard";
  const played: VisibleCard = {
    ...card,
    zone: destination,
    tapped: false,
    battlefieldPosition: position,
    summoningSick: card.typeLine.includes("Creature")
  };
  const next = syncZones({
    ...seat,
    landsPlayed: (seat.landsPlayed ?? 0) + (isLand(card) ? 1 : 0),
    board: {
      ...seat.board,
      hand: seat.board.hand.filter((item) => item.id !== cardId),
      battlefield: destination === "battlefield" ? [...seat.board.battlefield, played] : seat.board.battlefield,
      graveyard: destination === "graveyard" ? [...seat.board.graveyard, played] : seat.board.graveyard
    }
  });
  return { seat: next, played, destination };
}

export function castCommander(seat: PlayerSeat, position?: { x: number; z: number }): { seat: PlayerSeat; error?: string } {
  const commander = seat.board.commander;
  if (!commander || commander.zone !== "command") return { seat, error: "Commander is not in the command zone." };
  const cast: VisibleCard = {
    ...commander,
    zone: "battlefield",
    tapped: false,
    battlefieldPosition: position,
    summoningSick: commander.typeLine.includes("Creature")
  };
  return {
    seat: syncZones({
      ...seat,
      commanderCasts: (seat.commanderCasts ?? 0) + 1,
      board: { ...seat.board, commander: cast, battlefield: [...seat.board.battlefield, cast] }
    })
  };
}

export function removeFromBattlefield(seat: PlayerSeat, cardId: string): { seat: PlayerSeat; removed?: VisibleCard; toCommandZone?: boolean } {
  const card = seat.board.battlefield.find((item) => item.id === cardId);
  if (!card) return { seat };
  const battlefield = seat.board.battlefield.filter((item) => item.id !== cardId);
  if (card.commander) {
    const home: VisibleCard = { ...card, zone: "command", tapped: false, battlefieldPosition: undefined };
    return {
      seat: syncZones({ ...seat, board: { ...seat.board, battlefield, commander: home } }),
      removed: card,
      toCommandZone: true
    };
  }
  return {
    seat: syncZones({
      ...seat,
      board: { ...seat.board, battlefield, graveyard: [...seat.board.graveyard, { ...card, zone: "graveyard", tapped: false }] }
    }),
    removed: card
  };
}

export function toggleTap(seat: PlayerSeat, cardId: string): PlayerSeat {
  return {
    ...seat,
    board: {
      ...seat.board,
      battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, tapped: !card.tapped } : card)),
      commander:
        seat.board.commander?.id === cardId && seat.board.commander.zone === "battlefield"
          ? { ...seat.board.commander, tapped: !seat.board.commander.tapped }
          : seat.board.commander
    }
  };
}

export function millTop(seat: PlayerSeat): { seat: PlayerSeat; milled?: VisibleCard } {
  const milled = seat.board.library[0];
  if (!milled) return { seat };
  return {
    seat: syncZones({
      ...seat,
      board: {
        ...seat.board,
        library: seat.board.library.slice(1),
        graveyard: [...seat.board.graveyard, { ...milled, zone: "graveyard" }]
      }
    }),
    milled
  };
}

export function libraryTopToBottom(seat: PlayerSeat): { seat: PlayerSeat; moved?: VisibleCard } {
  const moved = seat.board.library[0];
  if (!moved) return { seat };
  return {
    seat: syncZones({ ...seat, board: { ...seat.board, library: [...seat.board.library.slice(1), moved] } }),
    moved
  };
}

export function takeFromLibrary(seat: PlayerSeat, cardId: string): { seat: PlayerSeat; taken?: VisibleCard } {
  const taken = seat.board.library.find((card) => card.id === cardId);
  if (!taken) return { seat };
  // Searching the library shuffles it afterward, per the usual rule.
  return {
    seat: syncZones({
      ...seat,
      board: {
        ...seat.board,
        hand: [...seat.board.hand, { ...taken, zone: "hand" }],
        library: shuffle(seat.board.library.filter((card) => card.id !== cardId))
      }
    }),
    taken
  };
}

export function canTransform(card: VisibleCard) {
  return (card.faces?.length ?? 0) >= 2;
}

// Swap a double-faced card to its other face, materializing the face's stats onto the card.
export function transformCard(card: VisibleCard): VisibleCard {
  const faces = card.faces;
  if (!faces || faces.length < 2) return card;
  const faceIndex = ((card.faceIndex ?? 0) + 1) % faces.length;
  const face = faces[faceIndex];
  return {
    ...card,
    faceIndex,
    name: face.name,
    typeLine: face.typeLine,
    oracleText: face.oracleText,
    colors: face.colors,
    power: face.power,
    toughness: face.toughness,
    imageUris: face.imageUris ?? card.imageUris
  };
}

export interface AgentPlays {
  landId?: string;
  castCommander: boolean;
  spellId?: string;
}

export function chooseAgentPlays(seat: PlayerSeat): AgentPlays {
  const landCard = seat.board.hand.find(isLand);
  const mana = availableMana(seat) + (landCard ? 1 : 0);
  if (seat.board.commander?.zone === "command" && commanderCost(seat) <= mana) {
    return { landId: landCard?.id, castCommander: true };
  }
  const affordable = seat.board.hand
    .filter((card) => !isLand(card) && card.manaValue <= mana)
    .sort((a, b) => b.manaValue - a.manaValue);
  return { landId: landCard?.id, castCommander: false, spellId: affordable[0]?.id };
}
