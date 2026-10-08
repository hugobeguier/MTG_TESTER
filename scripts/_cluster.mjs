import fs from "fs";
const lines = fs.readFileSync("bench/coverage/choice-audit.csv", "utf8").split("\n").slice(1);
const flag = process.argv[2] ?? "target";
const m = new Map();
for (const l of lines) {
  const mm = l.match(/^"(.*?)",(\d*),"(.*?)","(.*)"$/);
  if (!mm || !mm[3].split(" ").includes(flag)) continue;
  const name = mm[1].split(",")[0].toLowerCase();
  let t = mm[4].toLowerCase().replace(/^[^:]*: /, "").replace(/^(when|whenever|at the beginning)[^,]*, /, "").replace(/\d+/g, "N").replace(/\b(a|an|one|two|three)\b/g, "A");
  t = t.split(name).join("~").slice(0, 70);
  const e = m.get(t) || { n: 0, ex: mm[1], best: 1e9 };
  e.n++;
  e.best = Math.min(e.best, mm[2] ? +mm[2] : 1e9);
  m.set(t, e);
}
console.log([...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 50).map(([k, v]) => v.n + "\t" + k + "  [" + v.ex + " #" + v.best + "]").join("\n"));
