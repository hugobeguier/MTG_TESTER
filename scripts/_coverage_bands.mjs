import fs from "fs";
const ranks = JSON.parse(fs.readFileSync("data/edhrec-ranks.json", "utf8"));
const cards = fs.readFileSync("data/commander-cards.json", "utf8");
const catalog = JSON.parse(cards);
const list = Array.isArray(catalog) ? catalog : Object.values(catalog);
const unhandled = new Map();
for (const l of fs.readFileSync("bench/coverage/backlog-cards.csv", "utf8").split("\n").slice(1)) {
  const m = l.match(/^"(.*?)",(\d+),(\d+),/);
  if (m) unhandled.set(m[1].replace(/""/g, '"'), { bad: +m[2], total: +m[3] });
}
const ranked = Object.entries(ranks).sort((a, b) => a[1] - b[1]);
for (const band of [100, 500, 1000, 3000, 10000, 40000]) {
  const top = ranked.slice(0, band).map(([n]) => n);
  const clean = top.filter((n) => !unhandled.has(n)).length;
  const partial = top.filter((n) => unhandled.has(n) && unhandled.get(n).bad < unhandled.get(n).total).length;
  console.log(`top ${band}: fully recognised ${clean} (${Math.round((clean / top.length) * 100)}%), some lines unrecognised ${top.length - clean}`);
}
// templates weighted by popularity
const norm = (t) => t.toLowerCase().replace(/\d+/g, "N").replace(/\{[^}]+\}/g, "{M}").replace(/\b(a|an|one|two|three)\b/g, "A").slice(0, 90);
const clusters = new Map();
for (const l of fs.readFileSync("bench/coverage/backlog-cards.csv", "utf8").split("\n").slice(1)) {
  const m = l.match(/^"(.*?)",(\d+),(\d+),(?:true|false),"(.*)"$/);
  if (!m) continue;
  const name = m[1].replace(/""/g, '"');
  const rank = ranks[name] ?? 40000;
  const weight = 1 / Math.sqrt(rank + 50);
  const key = norm(m[4].replace(/^[^:]*—\s*/, "").replace(/^(when|whenever|at the beginning of)[^,]*,\s*/i, ""));
  const e = clusters.get(key) ?? { n: 0, w: 0, ex: name };
  e.n++; e.w += weight; clusters.set(key, e);
}
console.log([...clusters.entries()].sort((a, b) => b[1].w - a[1].w).slice(0, 25).map(([k, v]) => `${v.n}\t${k}  [${v.ex}]`).join("\n"));
