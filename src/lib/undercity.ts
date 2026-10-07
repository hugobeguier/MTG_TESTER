// The Undercity dungeon, used by the initiative (rule 725): the player with the initiative ventures into it at the start of each of their
// upkeeps, and whenever someone takes the initiative. Each room has an effect; most rooms lead on to a choice of two.
export type UndercityRoom = "secret_entrance" | "forge" | "lost_well" | "trap" | "arena" | "stash" | "archives" | "catacombs" | "throne";

export const UNDERCITY_START: UndercityRoom = "secret_entrance";
export const UNDERCITY_LAST: UndercityRoom = "throne";

const NEXT_ROOMS: Record<UndercityRoom, UndercityRoom[]> = {
  secret_entrance: ["forge", "lost_well"],
  forge: ["trap", "arena"],
  lost_well: ["arena", "stash"],
  trap: ["archives"],
  arena: ["archives", "catacombs"],
  stash: ["catacombs"],
  archives: ["throne"],
  catacombs: ["throne"],
  throne: []
};

export const UNDERCITY_ROOM_NAMES: Record<UndercityRoom, string> = {
  secret_entrance: "Secret Entrance",
  forge: "Forge",
  lost_well: "Lost Well",
  trap: "Trap!",
  arena: "Arena",
  stash: "Stash",
  archives: "Archives",
  catacombs: "Catacombs",
  throne: "Throne of the Dead Three"
};

export const UNDERCITY_ROOM_TEXT: Record<UndercityRoom, string> = {
  secret_entrance: "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
  forge: "Put two +1/+1 counters on target creature.",
  lost_well: "Scry 2.",
  trap: "Target player loses 5 life.",
  arena: "Goad target creature.",
  stash: "Create a Treasure token.",
  archives: "Draw a card.",
  catacombs: "Create a 4/1 black Skeleton creature token with menace.",
  throne: "Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Put the rest on the bottom of your library in a random order."
};

export function isUndercityRoom(value: string | undefined): value is UndercityRoom {
  return value !== undefined && value in NEXT_ROOMS;
}

// The rooms a venture can enter from `current`: the first room when there is no progress or the dungeon was completed (throne).
export function nextUndercityRooms(current: string | undefined): UndercityRoom[] {
  if (!isUndercityRoom(current) || current === UNDERCITY_LAST) return [UNDERCITY_START];
  return NEXT_ROOMS[current];
}

// The agent's pick among branches: the room whose effect is worth most right now.
export function preferredUndercityRoom(options: UndercityRoom[]): UndercityRoom {
  const order: UndercityRoom[] = ["forge", "arena", "catacombs", "archives", "stash", "lost_well", "trap", "throne", "secret_entrance"];
  return [...options].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
}
