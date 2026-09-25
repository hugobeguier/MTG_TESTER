import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// Scryfall's bulk-data API used to expose a `download_uri` pointing at one big JSON array. It now
// only exposes `jsonl_download_uri`: a gzipped, newline-delimited JSON file (one card object per
// line). We stream-download + gunzip + line-parse it instead of buffering the whole decompressed
// file in memory (oracle-cards decompresses to a few hundred MB, comfortably bufferable, but
// streaming costs nothing extra and avoids holding two copies of that much JSON at once).
const BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data";
const BULK_DATA_TYPE = "oracle_cards";
const OUT_PATH = path.join(process.cwd(), "data", "commander-cards.json");
const TMP_PATH = path.join(process.cwd(), "data", "oracle-cards.jsonl.gz");
// Scryfall's API etiquette (https://scryfall.com/docs/api) asks for a descriptive User-Agent and
// an Accept header on every request, and no more than ~10 requests/second — we only ever make two
// requests total here (the bulk-data index, then the one big download), so no extra delay is
// needed beyond that.
const SCRYFALL_HEADERS = {
  "user-agent": "MTG-AI Commander Lab/0.1 (https://github.com/hugobeguier/MTG-AI)",
  accept: "application/json;q=0.9,*/*;q=0.8"
};
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

const index = await fetchJson(BULK_DATA_INDEX_URL);
const bulk = index.data?.find((entry) => entry.type === BULK_DATA_TYPE);
if (!bulk) {
  throw new Error(`Scryfall bulk-data index did not include a "${BULK_DATA_TYPE}" entry.`);
}
if (!bulk.jsonl_download_uri) {
  throw new Error(`Scryfall bulk metadata for "${BULK_DATA_TYPE}" did not include jsonl_download_uri.`);
}

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await downloadFile(bulk.jsonl_download_uri, TMP_PATH);

const cardsByOracle = new Map();
await streamJsonl(TMP_PATH, (raw) => {
  if (raw.object !== "card") return;
  if (raw.digital) return;
  if (raw.legalities?.commander !== "legal") return;
  if (raw.layout === "art_series" || raw.layout === "token" || raw.layout === "emblem") return;

  const card = compactCard(raw);
  const existing = cardsByOracle.get(raw.oracle_id ?? raw.id);
  if (!existing || betterImageScore(card) > betterImageScore(existing)) {
    cardsByOracle.set(raw.oracle_id ?? raw.id, card);
  }
});

const output = {
  source: "scryfall-oracle-cards",
  sourceUpdatedAt: bulk.updated_at,
  importedAt: new Date().toISOString(),
  cards: [...cardsByOracle.values()].sort((a, b) => a.name.localeCompare(b.name))
};

await writeFile(OUT_PATH, JSON.stringify(output), "utf8");
await rm(TMP_PATH, { force: true });
console.log(`Imported ${output.cards.length} Commander-legal cards to ${OUT_PATH}`);

async function fetchJson(url) {
  const response = await fetch(url, { headers: SCRYFALL_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, destPath) {
  const response = await fetch(url, { headers: SCRYFALL_HEADERS });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
}

// Streams the gzipped JSONL file line by line rather than buffering the whole decompressed body,
// invoking `onCard` with each parsed card object.
async function streamJsonl(gzPath, onCard) {
  const gunzip = createGunzip();
  const fileStream = createReadStream(gzPath);
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    onCard(JSON.parse(trimmed));
  }
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
