// TEST HELPER ONLY: a Run over a test table's current state (the dry-run helpers of mana.ts take a Run).
import { withCardDb } from "./carddb";
import type { Run } from "./core";
import { ctxOf } from "./testdb";
import type { Table } from "./testkit";

export function makeRunForTest(t: Table): Run {
  const c = ctxOf(t);
  return { s: t.state, events: [], defs: withCardDb(c.cards, c.db), db: c.db, scanned: 0 } as Run;
}
