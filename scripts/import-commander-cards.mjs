import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BULK_DATA_URL = "https://api.scryfall.com/bulk-data/oracle-cards";
const OUT_PATH = path.join(process.cwd(), "data", "commander-cards.json");
const GAME_CHANGERS = new Set([
  "Ancient Tomb",
  "Cyclonic Rift",
  "Demonic Tutor",
  "Dockside Extortionist",
  "Enlightened Tutor",
  "Fierce Guardianship",
  "Force of Will",
  "Gaea's Cradle",
  "Jeweled Lotus",
  "Mana Crypt",
  "Mana Drain",
  "Mystical Tutor",
  "Rhystic Study",
  "Smothering Tithe",
  "The One Ring",
  "Thassa's Oracle",
  "Vampiric Tutor"
]);

const bulk = await fetchJson(BULK_DATA_URL);
if (!bulk.download_uri) {
  throw new Error("Scryfall bulk metadata did not include download_uri.");
}

const rawCards = await fetchJson(bulk.download_uri);
const cardsByOracle = new Map();

for (const raw of rawCards) {
  if (raw.object !== "card") continue;
  if (raw.digital) continue;
  if (raw.legalities?.commander !== "legal") continue;
  if (raw.layout === "art_series" || raw.layout === "token" || raw.layout === "emblem") continue;

  const card = compactCard(raw);
  const existing = cardsByOracle.get(raw.oracle_id ?? raw.id);
  if (!existing || betterImageScore(card) > betterImageScore(existing)) {
    cardsByOracle.set(raw.oracle_id ?? raw.id, card);
  }
}

const output = {
  source: "scryfall-oracle-cards",
  sourceUpdatedAt: bulk.updated_at,
  importedAt: new Date().toISOString(),
  cards: [...cardsByOracle.values()].sort((a, b) => a.name.localeCompare(b.name))
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, JSON.stringify(output), "utf8");
console.log(`Imported ${output.cards.length} Commander-legal cards to ${OUT_PATH}`);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "MTG-AI Commander Lab/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function compactCard(raw) {
  const faces = raw.card_faces?.map((face) => ({
    name: face.name,
    typeLine: face.type_line ?? "",
    oracleText: face.oracle_text ?? "",
    manaCost: face.mana_cost,
    colors: face.colors ?? [],
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    imageUris: compactImages(face.image_uris)
  }));

  return {
    id: raw.id,
    oracleId: raw.oracle_id,
    name: raw.name,
    typeLine: raw.type_line ?? faces?.[0]?.typeLine ?? "",
    oracleText: raw.oracle_text ?? faces?.map((face) => `${face.name}: ${face.oracleText}`).join("\n\n") ?? "",
    manaCost: raw.mana_cost ?? faces?.[0]?.manaCost,
    manaValue: raw.cmc ?? 0,
    colors: raw.colors ?? faces?.flatMap((face) => face.colors) ?? [],
    colorIdentity: raw.color_identity ?? [],
    producedMana: raw.produced_mana,
    rarity: raw.rarity,
    set: raw.set,
    collectorNumber: raw.collector_number,
    power: raw.power ?? faces?.[0]?.power,
    toughness: raw.toughness ?? faces?.[0]?.toughness,
    loyalty: raw.loyalty ?? faces?.[0]?.loyalty,
    imageUris: compactImages(raw.image_uris) ?? compactImages(faces?.[0]?.imageUris),
    faces,
    legalities: raw.legalities,
    isGameChanger: GAME_CHANGERS.has(raw.name)
  };
}

function compactImages(images) {
  if (!images) return undefined;
  return {
    small: images.small,
    normal: images.normal,
    large: images.large,
    png: images.png,
    artCrop: images.art_crop,
    borderCrop: images.border_crop
  };
}

function betterImageScore(card) {
  const images = card.imageUris;
  return Number(Boolean(images?.normal)) * 4 + Number(Boolean(images?.large)) * 3 + Number(Boolean(images?.png)) * 2 + Number(Boolean(images?.small));
}
