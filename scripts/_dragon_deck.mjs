import fs from "fs";
const raw = fs.readFileSync("Lathliss, Dragon Queen.txt", "utf8");
const lines = raw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /^\d+\s/.test(l))
  .map((l) => l.replace(/\s*\*F\*\s*$/, "").replace(/\s+\([A-Z0-9]+\)\s+\S+$/, ""));
const total = lines.reduce((n, l) => n + Number.parseInt(l, 10), 0);
console.log("lines", lines.length, "cards", total);
const text = "Commander: Lathliss, Dragon Queen\n" + lines.join("\n");
fs.writeFileSync("decks/foundations/ReignOfDragons.txt", text + "\n");
const p = "src/lib/precons.ts";
let s = fs.readFileSync(p, "utf8");
const crlf = s.includes("\r\n");
s = s.replace(/\r\n/g, "\n");
const start = s.indexOf("export const REIGN_OF_DRAGONS_DECKLIST = `");
const end = s.indexOf("`;", start);
if (start < 0 || end < 0) throw new Error("precons markers");
s = s.slice(0, start) + "export const REIGN_OF_DRAGONS_DECKLIST = `" + text + s.slice(end);
fs.writeFileSync(p, crlf ? s.replace(/\n/g, "\r\n") : s);
