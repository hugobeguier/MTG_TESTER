// Shared types of the kernel observer (see README.md). Plain JSON everywhere so diffs can be written as JSONL and reproduced.

export type DiffCategory =
  | "kernel_rejected_legal_action"   // legacy accepted the action, the kernel refused it (error code in `kernelError`)
  | "kernel_accepted_illegal_action" // legacy refused / no-oped the action, the kernel accepted it
  | `state_mismatch:${string}`       // both accepted, resulting states differ in <field>
  | `unsupported_capability:${string}` // the kernel refused with error.code "unsupported" (capability = kind:detail)
  | "no_draft"                       // an acting / involved card has no draft (stub definition): comparison skipped
  | "unmapped_action"                // legacy intent with no kernel mapping yet
  | "adapter_gap"                    // legacy state carries data the adapter cannot represent (once per kind per game)
  | "observer_error";                // the observer itself threw (never reaches the legacy path)

export interface DiffIntent {
  /** legacy actionType ("play_land", "cast_spell", "attack", "block", "phase:draw", ...) */
  type: string;
  label?: string;
  /** card name of the acting / source card when there is one */
  card?: string;
}

export interface Diff {
  category: DiffCategory;
  /** index of the game inside a batch run (0 for single games) */
  game: number;
  /** replay seed of the batch game ("--seed S" + game index); with the same decks it reproduces this diff */
  seed?: number;
  decks?: string[];
  /** monotonic number of the observed legacy action inside the game: replay to this index to reproduce */
  actionIndex: number;
  turn: number;
  /** legacy phase name */
  phase: string;
  seat: string;
  intent: DiffIntent;
  /** card names involved (acting card, mismatching permanents, unsupported cards) */
  cards: string[];
  /** a short human sentence */
  message: string;
  /** the field of a state_mismatch (also derivable from the category) */
  field?: string;
  legacy?: unknown;
  kernel?: unknown;
  kernelError?: { code: string; message: string; capability?: string[] };
  /** kernel decisions that the observer answered with its default policy (the result may depend on that choice) */
  defaultedDecisions?: string[];
  /** kernel decisions answered by replaying the legacy choice (read off the legacy result) */
  hintedDecisions?: string[];
  /** titles of the prompts the default policy answered (what it was asked) */
  defaultedPrompts?: string[];
  /** true when the mismatch may come from a defaulted decision / approximation rather than a rules difference */
  choiceDependent?: boolean;
  /** free-form extra context (adapter gaps seen in S0, capability list, ...) */
  context?: Record<string, unknown>;
}

/** One observed unit: an intent the observer compared (or skipped), for the readiness statistics. */
export interface StepOutcome {
  kind: "agree" | "disagree" | "skipped";
  intentType: string;
  /** why a step was skipped (legacy housekeeping, no_draft, unmapped...) */
  reason?: string;
  seat: string;
  deck?: string;
  diffs: Diff[];
}

export interface ObserverMeta {
  seatId: string;
  turn: number;
  phase: string;
  actionType: string;
  actionLabel?: string;
  cardId?: string;
  manaPayment?: { seatId: string; sourceIds: string[]; totalCost: number };
}
