"use client";
// Kernel mode: the "Debug tools" panel and the "Debug mode" checkbox that shows / hides it. The kernel counterpart of the old game's sandbox tools (draw, shuffle, library search,
// move to a zone, life, counters, free casting). Every button sends a sandbox action to the engine (engine/sandbox.ts), which refuses all of them unless debug mode is on for the game;
// the checkbox is remembered in localStorage and its switch is recorded in the game log and the replay file. Pure parts: game/kernelDebug.ts.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { KernelGameController } from "./game/kernelController";
import { LIFE_STEPS, MANA_BUTTONS, QUICK_BUTTONS, debugPanelVisible, lifeAction, lifeLabel, loadDebugFlag, saveDebugFlag, type PickerSource } from "./game/kernelDebug";
import { KernelDebugConjure, KernelDebugPicker } from "./KernelDebugPicker";

/** The checkbox. Restores the remembered state once when the game starts (that is when the switch is recorded in the game). */
export function KernelDebugToggle({ controller }: { controller: KernelGameController }) {
  useEffect(() => { if (loadDebugFlag()) controller.setDebug(true); }, [controller]);
  const on = controller.debugOn();
  return (
    <label className="kernel-debug-toggle" title="Debug mode: shows testing tools (free cast, search the library, draw, life ...). Off by default.">
      <input type="checkbox" data-testid="kernel-debug-toggle" checked={on} onChange={(e) => { saveDebugFlag(e.target.checked); controller.setDebug(e.target.checked); }} />
      {" "}Debug mode
    </label>
  );
}

type Dialog = { kind: "picker"; source: PickerSource } | { kind: "conjure" } | undefined;

/** The panel itself; renders nothing unless debug mode is on. */
export function KernelDebugPanel({ controller, busy }: { controller: KernelGameController; busy: boolean }) {
  const [dialog, setDialog] = useState<Dialog>();
  const on = controller.debugOn();
  useEffect(() => { if (!on) setDialog(undefined); }, [on]);
  if (!debugPanelVisible(on, controller.ks.sandbox)) return null;
  const life = controller.humanLife();
  const note = busy ? "Answer the open question first" : undefined;
  if (typeof document === "undefined") return null;
  // portalled to the page: the table's HUD is transformed, a fixed panel inside it would be squeezed into the HUD's box
  return createPortal(
    <section className="kernel-debug-panel" data-testid="kernel-debug-panel" aria-label="Debug tools">
      <strong className="kernel-debug-title">Debug tools</strong>
      <div className="kernel-debug-row">
        <button type="button" className={`kernel-small${controller.freeCast ? " selected" : ""}`} data-testid="kernel-debug-free-cast" aria-pressed={controller.freeCast} onClick={controller.toggleFreeCast}
          title="While on, clicking a card of yours (hand, graveyard, exile, commander) casts it for free: no mana, any time. Lands go onto the battlefield without using a land drop.">
          Cast for free{controller.freeCast ? ": ON" : ""}
        </button>
        <button type="button" className="kernel-small" data-testid="kernel-debug-search" disabled={busy} title={note ?? "Pick any card of your library and put it into your hand (or elsewhere)"} onClick={() => setDialog({ kind: "picker", source: "library" })}>Search library</button>
        <button type="button" className="kernel-small" data-testid="kernel-debug-put" disabled={busy} title={note ?? "Move one of your cards from a zone into another zone"} onClick={() => setDialog({ kind: "picker", source: "hand" })}>Put card into...</button>
        <button type="button" className="kernel-small" data-testid="kernel-debug-conjure" disabled={busy} title={note ?? "Create a card by name (any card of the loaded decks)"} onClick={() => setDialog({ kind: "conjure" })}>Conjure card</button>
      </div>
      <div className="kernel-debug-row">
        {QUICK_BUTTONS.map((b) => <button key={b.id} type="button" className="kernel-small" data-testid={`kernel-debug-${b.id}`} disabled={busy} title={note ?? b.title} onClick={() => controller.debug(b.action)}>{b.label}</button>)}
      </div>
      <div className="kernel-debug-row">
        <span className="kernel-hint">Life {life}</span>
        {LIFE_STEPS.map((d) => <button key={d} type="button" className="kernel-small" data-testid={`kernel-debug-life${d}`} disabled={busy} onClick={() => controller.debug(lifeAction(life, d))}>{lifeLabel(d)}</button>)}
      </div>
      <div className="kernel-debug-row">
        <span className="kernel-hint">Add mana</span>
        {MANA_BUTTONS.map((c) => <button key={c} type="button" className={`mana-choice-button mana-${c.toLowerCase()} kernel-debug-mana`} data-testid={`kernel-debug-mana-${c}`} aria-label={`Add ${c} mana`} disabled={busy} onClick={() => controller.debug({ type: "sandboxAddMana", colors: [c] })}>{c}</button>)}
      </div>
      {dialog?.kind === "picker" ? <KernelDebugPicker controller={controller} initialSource={dialog.source} onClose={() => setDialog(undefined)} /> : null}
      {dialog?.kind === "conjure" ? <KernelDebugConjure controller={controller} onClose={() => setDialog(undefined)} /> : null}
    </section>,
    document.body
  );
}
