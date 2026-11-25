// Measures AI attack-target distribution: every seat is the kernel AI; counts attacking creatures declared at each player defender, by seat index and by deck,
// with the seating rotated so seat order and identity separate.
//   npx vite-node -c vitest.config.ts scripts/kernel-ai-targeting.ts -- --games 8 --seed 100 --turns 12 --decks "Aminatou;Saheeli;Meren"
import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx, deckNames } from "../src/kernel/integration/testgame";
import { chooseAiAction, freshMemory, type AiMemory } from "../src/components/game/kernelAi";
import type { PlayerId } from "../src/kernel/engine/types";

const argv = process.argv.slice(2); const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
const games = Number(args.games ?? 6), seed = Number(args.seed ?? 100), turns = Number(args.turns ?? 12);
const decks = (args.decks ?? "Aminatou;Saheeli;Meren").split(/[;,]/).map((d) => d.trim()).filter(Boolean);
const bySeat: number[] = decks.map(() => 0), byDeck: Record<string, number> = {}, bySeatDecl: number[] = decks.map(() => 0);
let planeswalker = 0, totalAtt = 0;
// per attacker seat -> defender seat matrix
const matrix: number[][] = decks.map(() => decks.map(() => 0));
for (let g = 0; g < games; g++) {
  const rot = g % decks.length; const order = [...decks.slice(rot), ...decks.slice(0, rot)];
  const players = order.map((d, i) => { const { cards, commander } = deckNames(d); return { id: `p${i + 1}`, name: d, deck: cards, ...(commander ? { commander } : {}), kind: "agent" as const }; });
  const ks = KernelSession.fromDecks({ ctx, decks: players, seed: seed + g, startPhase: "precombat_main" });
  const mem: Record<string, AiMemory> = {}; let memTurn = -1, steps = 0;
  while (!ks.gameOver && steps++ < 30000 && ks.state.turn.number <= turns) {
    const s = ks.state;
    if (memTurn !== s.turn.number) { for (const k of Object.keys(mem)) mem[k] = freshMemory(mem[k]); memTurn = s.turn.number; }
    const actor = ks.actor; if (!actor) break;
    mem[actor] ??= { banned: new Set() };
    const acts = ks.legal(actor);
    const action = chooseAiAction(acts, s, ctx, actor, mem[actor]);
    if (!action) break;
    if (action.type === "declareAttackers" && action.attackers.length) {
      const a = Number(actor.slice(1)) - 1;
      bySeatDecl[a]++;
      for (const at of action.attackers) {
        totalAtt++;
        const di = players.findIndex((p) => p.id === at.defender);
        if (di < 0) { planeswalker++; continue; }
        bySeat[di]++; byDeck[players[di].name] = (byDeck[players[di].name] ?? 0) + 1; matrix[a][di]++;
      }
    }
    const res = ks.dispatch(actor, action);
    if (!res.ok) { const pass = acts.find((x) => x.kind === "passPriority")?.action ?? { type: "passPriority" as const, player: actor as PlayerId }; if (ks.state.pending) break; ks.dispatch(actor, pass); }
  }
  process.stderr.write(`game ${g + 1}/${games} order ${order.join(">")} turn ${ks.state.turn.number}\n`);
}
console.log(`decks ${decks.join(" | ")} games ${games} turns<=${turns}`);
console.log(`attackers declared at each seat (p1..): ${JSON.stringify(bySeat)} (non-player defenders ${planeswalker}, total ${totalAtt})`);
console.log(`attackers declared at each deck: ${JSON.stringify(byDeck)}`);
console.log(`attacker seat x defender seat matrix: ${JSON.stringify(matrix)}`);
process.exit(0);
