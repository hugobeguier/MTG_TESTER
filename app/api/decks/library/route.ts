import { NextRequest, NextResponse } from "next/server";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeDeckFile } from "./normalize";

// Saved decks for the setup screen's dropdowns and the /decks editor: every deck-shaped .txt in the
// project root and under decks/ (recursively). A file counts as a deck if it has a "Commander:" line
// or at least 30 lines that start with a card count — which excludes notes files like Bugs2.txt.
// GET lists them, POST saves (new deck, or overwrite by id), DELETE removes one.
export const dynamic = "force-dynamic";

const root = () => process.cwd();
const CUSTOM_DIR = "decks/custom";

async function deckFiles(dir: string, recurse: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recurse) files.push(...(await deckFiles(full, true)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) files.push(full);
  }
  return files;
}

// An id is a path relative to the project root; only a .txt directly in the root or anywhere under decks/ is allowed.
function resolveDeckPath(id: string): string | undefined {
  const full = path.resolve(root(), id);
  const relative = path.relative(root(), full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !full.toLowerCase().endsWith(".txt")) return undefined;
  const parts = relative.split(path.sep);
  return parts.length === 1 || parts[0] === "decks" ? full : undefined;
}

export async function GET() {
  const files = [...(await deckFiles(root(), false)), ...(await deckFiles(path.join(root(), "decks"), true))];
  const decks: Array<{ id: string; label: string; commander: string; deckList: string; raw: string }> = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const cardLines = text.split(/\r?\n/).filter((line) => /^\d+x?\s+\S/.test(line.trim())).length;
    if (!/^commander:/im.test(text) && cardLines < 30) continue;
    const label = path.basename(file, ".txt");
    decks.push({ id: path.relative(root(), file).split(path.sep).join("/"), label, raw: text, ...normalizeDeckFile(label, text) });
  }
  decks.sort((a, b) => a.label.localeCompare(b.label));
  return NextResponse.json(decks);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { id?: string; name?: string; deckList?: string };
  if (!body.deckList?.trim()) return NextResponse.json({ error: "Deck list is empty." }, { status: 400 });
  let id = body.id;
  if (!id) {
    const slug = (body.name ?? "").trim().replace(/[^A-Za-z0-9 ,'_-]/g, "").trim();
    if (!slug) return NextResponse.json({ error: "Give the deck a name." }, { status: 400 });
    id = `${CUSTOM_DIR}/${slug}.txt`;
    const existing = resolveDeckPath(id);
    if (existing && (await readFile(existing).then(() => true, () => false))) {
      return NextResponse.json({ error: `A deck named "${slug}" already exists. Open it to edit, or choose another name.` }, { status: 409 });
    }
  }
  let target = resolveDeckPath(id);
  if (!target) return NextResponse.json({ error: "Invalid deck path." }, { status: 400 });
  // Renaming an existing deck: the file moves to the new name in the same folder.
  const oldTarget = target;
  const newSlug = body.id ? (body.name ?? "").trim().replace(/[^A-Za-z0-9 ,'_-]/g, "").trim() : "";
  if (newSlug && newSlug !== path.basename(target, ".txt")) {
    const renamed = resolveDeckPath(path.join(path.relative(root(), path.dirname(target)), `${newSlug}.txt`));
    if (!renamed) return NextResponse.json({ error: "Invalid deck name." }, { status: 400 });
    if (await readFile(renamed).then(() => true, () => false)) {
      return NextResponse.json({ error: `A deck named "${newSlug}" already exists.` }, { status: 409 });
    }
    target = renamed;
    id = path.relative(root(), renamed).split(path.sep).join("/");
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${body.deckList.replace(/\r\n/g, "\n").trim()}\n`, "utf8");
  if (target !== oldTarget) await unlink(oldTarget).catch(() => {});
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: NextRequest) {
  const target = resolveDeckPath(request.nextUrl.searchParams.get("id") ?? "");
  if (!target) return NextResponse.json({ error: "Invalid deck path." }, { status: 400 });
  await unlink(target).catch(() => {});
  return NextResponse.json({ ok: true });
}
