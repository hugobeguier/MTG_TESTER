import fs from "fs";
const rows = new Map();
for (const l of fs.readFileSync("bench/coverage/choice-audit.csv", "utf8").split("\n").slice(1)) {
  const m = l.match(/^"(.*?)",(\d*),"(.*?)","(.*)"$/);
  if (!m) continue;
  const flags = m[3].split(" ").filter(Boolean);
  rows.set(m[1].replace(/""/g, '"').split(" // ")[0].toLowerCase(), { name: m[1], flags, line: m[4] });
}
const decks = process.argv.slice(2);
for (const file of decks) {
  const names = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\s/.test(l))
    .map((l) => l.replace(/^\d+\s+/, "").replace(/\s+\(.*$/, "").replace(/\s+\*.*$/, "").trim());
  const total = new Set(names.map((n) => n.toLowerCase().split(" // ")[0]));
  const real = [];
  const unrec = [];
  for (const n of total) {
    const r = rows.get(n);
    if (!r) continue;
    const gaps = r.flags.filter((f) => f !== "unrecognised");
    if (gaps.length) real.push(`${r.name} [${gaps.join(",")}${r.flags.includes("unrecognised") ? ",unrec" : ""}]`);
    else unrec.push(r.name);
  }
  console.log(`\n=== ${file}: ${total.size} distinct cards; ${real.length} with a decision gap, ${unrec.length} only unrecognised ===`);
  console.log("GAPS: " + real.join("; "));
  console.log("UNRECOGNISED ONLY: " + unrec.join("; "));
}
