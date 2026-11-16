"use client";

// Setup-screen deck UI: DeckSetupPanel, Topbar, Status, per-seat config (SeatConfig/SavedDeck), default deck selection, config
// validation, applyDeckToSeat and commander-card construction. UI/setup only - no turn logic.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { type CommanderDeck, type PlayerSeat, type VisibleCard } from "@/lib/types";

type DeckInputMode = "commander" | "decklist";
type DeckBuildStatus = "empty" | "building" | "ready" | "error";

export interface SeatConfig {
  seatId: string;
  name: string;
  kind: PlayerSeat["kind"];
  mode: DeckInputMode;
  commander: string;
  deckList: string;
  deck?: CommanderDeck;
  status: DeckBuildStatus;
  message: string;
  activity: string[];
}

const COMMANDER_COLOR_HINTS: Record<string, string[]> = {
  shalai: ["G", "W"],
  kess: ["U", "B", "R"],
  meren: ["B", "G"],
  atraxa: ["W", "U", "B", "G"],
  prosper: ["B", "R"],
  yuriko: ["U", "B"],
  miirym: ["G", "U", "R"]
};

export type SavedDeck = { id: string; label: string; commander: string; deckList: string };

export function DeckSetupPanel({
  config,
  library,
  onBuild,
  onUpdate
}: {
  config: SeatConfig;
  library: SavedDeck[];
  onBuild: (config: SeatConfig) => void | Promise<void>;
  onUpdate: (seatId: string, patch: Partial<SeatConfig>) => void;
}) {
  return (
    <article className={`setup-card ${config.status}`}>
      <header>
        <div>
          <p className="eyebrow">{config.kind === "human" ? "Player" : "Agent seat"}</p>
          <h3>{config.name}</h3>
        </div>
        <strong>{config.status === "building" ? "Building" : config.deck?.validation.legal ? "Ready" : "Draft"}</strong>
      </header>
      <div className="mode-switch" role="group" aria-label={`${config.name} deck input mode`}>
        <button className={config.mode === "commander" ? "selected" : ""} type="button" onClick={() => onUpdate(config.seatId, { mode: "commander" })}>
          Commander
        </button>
        <button className={config.mode === "decklist" ? "selected" : ""} type="button" onClick={() => onUpdate(config.seatId, { mode: "decklist" })}>
          Deck list
        </button>
      </div>
      <label>
        Load saved deck
        <select
          value=""
          onChange={(event) => {
            const saved = library.find((deck) => deck.id === event.target.value);
            if (!saved) return;
            const patch = { commander: saved.commander, deckList: saved.deckList, deck: undefined, mode: "decklist" as const, status: "empty" as const };
            onUpdate(config.seatId, patch);
            void onBuild({ ...config, ...patch });
          }}
        >
          <option value="">{library.length === 0 ? "No saved decks found" : "Choose a deck..."}</option>
          {library.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.label} — {deck.commander}
            </option>
          ))}
        </select>
      </label>
      <label>
        Commander
        <input
          value={config.commander}
          onChange={(event) => onUpdate(config.seatId, { commander: event.target.value, deck: undefined, status: "empty" })}
          placeholder="Meren of Clan Nel Toth"
        />
      </label>
      <label>
        Deck list
        <textarea
          className="decklist-input"
          value={config.deckList}
          onChange={(event) => onUpdate(config.seatId, { deck: undefined, deckList: event.target.value, mode: "decklist", status: "empty" })}
          placeholder={"Commander: Atraxa, Praetors' Voice\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Swords to Plowshares\n1 Beast Within\n...continue to 100 cards"}
        />
      </label>
      <button type="button" disabled={config.status === "building"} onClick={() => onBuild(config)}>
        {config.status === "building" ? "Building..." : config.kind === "agent" ? "Build AI Deck" : "Validate Deck"}
      </button>
      <div className="setup-result">
        <span>{config.message}</span>
        {config.deck ? (
          <>
            <dl>
              <div>
                <dt>Cards</dt>
                <dd>{config.deck.validation.cardCount}</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>{config.deck.score.total}</dd>
              </div>
              <div>
                <dt>Game Changers</dt>
                <dd>{config.deck.validation.gameChangerCount}</dd>
              </div>
            </dl>
            {config.deck.validation.errors.length > 0 ? (
              <ul className="setup-errors" aria-label={`${config.name} deck validation errors`}>
                {config.deck.validation.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
            {config.activity.length > 0 ? (
              <ul className="agent-activity" aria-label={`${config.name} agent activity`}>
                {config.activity.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

export function Topbar({ setupSummary, onBack }: { setupSummary: string; onBack?: () => void }) {
  return (
    <section className="topbar">
      <div>
        <p className="eyebrow">Commander session</p>
        <h1>MTG-AI Commander Lab</h1>
        <p className="topbar-subtitle">{setupSummary}</p>
      </div>
      {onBack ? (
        <button type="button" onClick={onBack}>
          Back To Setup
        </button>
      ) : null}
    </section>
  );
}

export function Status(props: { label: string; value: string; detail: string }) {
  return (
    <article className="status">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  );
}

// Default decks come from decks/foundations/*.txt via the deck library API (the seats start empty and
// are filled by applyDefaultDecks once the library has loaded): the human seat gets Reign Of Dragons and
// each agent seat (in seat order) one of the other three, all in decklist mode.
const DEFAULT_HUMAN_DECK_LABEL = "Reign Of Dragons";
const DEFAULT_AGENT_DECK_LABELS = ["Wretched Ranks", "Tramplesaurus Rex", "Calling All Angels"];

export function createInitialConfigs(seats: PlayerSeat[]): SeatConfig[] {
  return seats.map((seat) => ({
    seatId: seat.id,
    name: seat.name,
    kind: seat.kind,
    mode: seat.kind === "human" ? "decklist" : "commander",
    commander: seat.deck?.commander ?? "",
    deckList: "",
    deck: undefined,
    status: "empty",
    message: "Choose a commander or paste a deck list.",
    activity: []
  }));
}

// Fills seats that still have no deck (nothing typed, loaded or built) with the default Foundations decks.
export function applyDefaultDecks(configs: SeatConfig[], library: SavedDeck[]): SeatConfig[] {
  const find = (label: string) => library.find((deck) => deck.id.toLowerCase().startsWith("decks/foundations/") && deck.label.toLowerCase() === label.toLowerCase());
  let agentIndex = 0;
  return configs.map((config) => {
    const label = config.kind === "human" ? DEFAULT_HUMAN_DECK_LABEL : DEFAULT_AGENT_DECK_LABELS[agentIndex++];
    const saved = label ? find(label) : undefined;
    if (!saved || config.deckList.trim() || config.deck) return config;
    return { ...config, mode: "decklist", commander: saved.commander, deckList: saved.deckList, message: "Foundations precon will validate automatically." };
  });
}

export function formatDeckList(deck: CommanderDeck) {
  const commander = deck.cards.find((card) => card.role === "commander")?.name ?? deck.commander;
  const cards = deck.cards.filter((card) => card.role !== "commander");
  return [`Commander: ${commander}`, ...cards.map((card) => `${card.count} ${card.name}`)].join("\n");
}

export function validateConfigsForPlay(configs: SeatConfig[]) {
  let ready = true;
  const nextConfigs = configs.map((config) => {
    // Never rebuild a decklist-mode seat's deck here as a fallback: createDeckFromList without a
    // `catalog` (loadCardCatalog() reads the local card data file — a server-only concern this
    // client-side function has no access to) silently enriches nothing, so every non-basic-land
    // card in the deck falls back to createVisibleFromDeckCard's "Mock <role> card. Full rules
    // text will come from card data lookup." placeholder — with fake stats guessed from the deck's
    // color identity and no real oracle text at all. Worse, that placeholder deck still came back
    // fully "legal": unknownErrors (the only check that would have caught missing card data) is
    // itself gated behind `input.catalog` in createDeckFromList, so a mock deck sailed through
    // validation silently and the game started anyway. A seat only ever gets a legitimately
    // enriched config.deck via buildDeck's own /api/decks/build round trip (the one place that
    // actually has the catalog); if that never ran, treat it the same as "no deck built yet"
    // instead of silently substituting a broken one. Reported live as Kodama's Reach, Cultivate,
    // and Three Visits each doing nothing when cast — every one of them, and everything else in
    // the affected deck, had been mock cards with no real rules text the whole game.
    const deck = config.deck;
    const errors = deck?.validation.errors ?? ["Build or validate this deck before pressing Play."];

    if (!deck || errors.length > 0 || !deck.validation.legal) {
      ready = false;
      return {
        ...config,
        status: "error" as DeckBuildStatus,
        message: errors[0] ?? "Deck is not legal for Commander."
      };
    }

    return {
      ...config,
      status: "ready" as DeckBuildStatus,
      message: "Deck passed Commander validation."
    };
  });

  return { ready, configs: nextConfigs };
}

export function applyDeckToSeat(seat: PlayerSeat, deck: CommanderDeck): PlayerSeat {
  const commander = createCommanderCard(deck, seat.board.commander);
  return {
    ...seat,
    deck,
    life: 40,
    commanderDamage: {},
    library: [],
    board: {
      ...seat.board,
      commander,
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: []
    },
    zones: {
      ...seat.zones,
      battlefield: 0,
      graveyard: 0,
      hand: 0,
      exile: 0,
      command: 1
    },
    // This is the only call site that ever builds a fresh game (an in-game command-zone recast
    // just moves the existing commander object between zones, it never goes through
    // createCommanderCard) — going "Back to setup" and pressing PLAY again reuses this same seat
    // object rather than creating a new one, so anything not reset here carries a previous game's
    // state straight into the new one. Reported live as a brand-new game starting with Meren of
    // Clan Nel Toth already bearing counters and its controller already holding 2 experience
    // counters, both left over from the game played before it.
    poison: undefined,
    experienceCounters: undefined,
    hasLost: undefined,
    lossReason: undefined,
    nextSpellHasArtifactAffinity: undefined,
    emblems: undefined
  };
}

function createCommanderCard(deck: CommanderDeck, existing?: VisibleCard): VisibleCard {
  const card = deck.commanderCard;
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: card?.name ?? deck.commander,
    typeLine: card?.typeLine ?? existing?.typeLine ?? "Legendary Creature - Commander",
    oracleText: card?.oracleText ?? existing?.oracleText ?? "AI-selected commander. Full card text will come from card data lookup in the next integration pass.",
    manaCost: card?.manaCost ?? existing?.manaCost,
    manaValue: card?.manaValue ?? existing?.manaValue ?? 4,
    colors: card?.colors ?? deck.colors,
    colorIdentity: card?.colorIdentity ?? deck.colors,
    producedMana: card?.producedMana ?? existing?.producedMana,
    imageUris: card?.imageUris,
    faces: card?.faces,
    role: "commander",
    zone: "command",
    commander: true,
    // Always a fresh 0/none/false here, never carried over from `existing` — this function only
    // ever runs at the start of a brand-new game (see applyDeckToSeat's own comment), so `existing`
    // is the PREVIOUS game's commander object whenever the same seat played one already. Real
    // in-game commander tax growth (recast from the command zone) never goes through this
    // constructor at all, so there's no legitimate same-game case that needs these to persist here.
    commanderTax: 0,
    power: card?.power ?? existing?.power ?? "3",
    toughness: card?.toughness ?? existing?.toughness ?? "4",
    loyalty: card?.loyalty ?? existing?.loyalty,
    tapped: undefined,
    summoningSick: undefined,
    counters: undefined
  };
}

export function inferColors(commander: string) {
  const lower = commander.toLowerCase();
  const matched = Object.entries(COMMANDER_COLOR_HINTS).find(([hint]) => lower.includes(hint));
  return matched?.[1] ?? ["G", "W"];
}

export function fallbackCommander(name: string) {
  if (name.includes("Malik")) return "Saheeli, the Gifted";
  if (name.includes("Sable")) return "Meren of Clan Nel Toth";
  if (name.includes("Veyra")) return "The Ur-Dragon";
  return "Atraxa, Praetors' Voice";
}
