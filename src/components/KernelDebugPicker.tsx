"use client";
// Kernel debug mode: the card picker ("Search library", "Put card into...") and the "Conjure card" window. Both are optional windows: Esc / Close just closes them, they never
// answer or cancel anything the game is waiting for. Cards are tiles with art (the decision dialog's CardTile) with a filter box, a sort and one button per destination;
// hovering a tile shows the enlarged card. The filter / sort / pick logic is pure (game/kernelDebug.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import type { KernelGameController } from "./game/kernelController";
import {
  PICKER_SORTS, PICKER_SOURCES, conjureMatches, destinationsFor, pickAction, pickerCards, pickerCount, type PickerSort, type PickerSource
} from "./game/kernelDebug";
import { CardPreviewPanel, CardTile, useCardPreview } from "./KernelCardView";
import type { SandboxZone } from "@/kernel/engine/types";

function useCloseOnEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.repeat) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true); // captured: Esc closes this window and does not also hide a decision window under it
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
}

export function KernelDebugPicker({ controller, initialSource, onClose }: { controller: KernelGameController; initialSource: PickerSource; onClose: () => void }) {
  const api = useCardPreview();
  const [source, setSource] = useState<PickerSource>(initialSource);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PickerSort>("library");
  const [keepOpen, setKeepOpen] = useState(false);
  const version = controller.ks.version;
  const all = useMemo(() => controller.debugCards(source), [controller, source, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => pickerCards(all, query, sort), [all, query, sort]);
  const dests = destinationsFor(source);
  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => { filterRef.current?.focus(); }, []);
  useCloseOnEscape(onClose);
  const pick = (id: string, to: SandboxZone) => { if (controller.debug(pickAction(source, id, to)) && !keepOpen) onClose(); };
  const title = source === "library" ? "Search library" : "Put card into...";
  return (
    <div className="card-inspector-backdrop kernel-layer" role="dialog" aria-modal="true" aria-label={title} data-testid="kernel-debug-picker">
      <article className="library-look-modal kernel-dialog">
        <header>
          <p className="eyebrow">Debug mode</p>
          <h2>{title}</h2>
          <p className="kernel-hint">{source === "library" ? "Every card of your library, top first. A pick shuffles the library unless it goes on top." : "Pick a card and where it goes."}</p>
        </header>
        <div className="kernel-num-row">
          <label>From{" "}
            <select value={source} aria-label="Take cards from" data-testid="kernel-debug-source" onChange={(e) => setSource(e.target.value as PickerSource)}>
              {PICKER_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <input ref={filterRef} type="search" aria-label="filter" data-testid="kernel-debug-filter" placeholder="Filter by name, type or text" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label>Sort{" "}
            <select value={sort} aria-label="Sort" data-testid="kernel-debug-sort" onChange={(e) => setSort(e.target.value as PickerSort)}>
              {PICKER_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label><input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} /> Keep open</label>
        </div>
        <div className="kernel-grid kernel-scroll" data-testid="kernel-debug-grid">
          {shown.map((c) => (
            <CardTile key={c.id} card={c} api={api} width={shown.length <= 8 ? 150 : 115} extra={(
              <span className="kernel-debug-dests">
                {dests.map((d, i) => <button key={d.id} type="button" className="kernel-small" data-testid={`kernel-debug-pick-${d.id}`} title={`${d.label}: ${c.name}`} onClick={() => pick(c.id, d.id)} {...(i === 0 ? { "data-default": "1" } : {})}>{d.label}</button>)}
              </span>
            )} />
          ))}
          {shown.length === 0 ? <em className="kernel-hint">{all.length ? "No card matches the filter." : "There are no cards here."}</em> : null}
        </div>
        <p className="kernel-hint" data-testid="kernel-debug-count">{pickerCount(shown.length, all.length)}</p>
        <div className="modal-actions"><button type="button" onClick={onClose}>Close (Esc)</button></div>
      </article>
      <CardPreviewPanel api={api} />
    </div>
  );
}

const CONJURE_DESTS: ReadonlyArray<{ id: SandboxZone; label: string }> = [{ id: "hand", label: "Hand" }, { id: "battlefield", label: "Battlefield" }, { id: "graveyard", label: "Graveyard" }, { id: "exile", label: "Exile" }, { id: "top_of_library", label: "Top of library" }];

/** "Conjure card": search the loaded packs' card list by name, create the card in a zone */
export function KernelDebugConjure({ controller, onClose }: { controller: KernelGameController; onClose: () => void }) {
  const api = useCardPreview();
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<SandboxZone>("hand");
  const names = useMemo(() => controller.debugNames(), [controller]);
  const hits = useMemo(() => conjureMatches(names, query), [names, query]);
  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => { filterRef.current?.focus(); }, []);
  useCloseOnEscape(onClose);
  return (
    <div className="card-inspector-backdrop kernel-layer" role="dialog" aria-modal="true" aria-label="Conjure card" data-testid="kernel-debug-conjure-dialog">
      <article className="library-look-modal kernel-dialog">
        <header>
          <p className="eyebrow">Debug mode</p>
          <h2>Conjure card</h2>
          <p className="kernel-hint">Creates a new copy of a card by name, owned by you. Only cards of the loaded decks exist ({names.length}).</p>
        </header>
        <div className="kernel-num-row">
          <input ref={filterRef} type="search" aria-label="card name" data-testid="kernel-debug-conjure-name" placeholder="Card name" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label>Into{" "}
            <select value={to} aria-label="Zone" onChange={(e) => setTo(e.target.value as SandboxZone)}>
              {CONJURE_DESTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        </div>
        <div className="kernel-grid kernel-scroll" data-testid="kernel-debug-conjure-list">
          {hits.map((n) => {
            const card = controller.debugCardByName(n);
            return (
              <div key={n} className="kernel-tile" {...(card ? api.handlers(card) : {})}>
                <button type="button" className="card-pick kernel-debug-name" data-testid="kernel-debug-conjure-pick" onClick={() => { if (controller.debug({ type: "sandboxConjureCard", name: n, to })) onClose(); }}>
                  <span className="card-pick-name">{n}</span>
                </button>
              </div>
            );
          })}
          {query.trim() && hits.length === 0 ? <em className="kernel-hint">No card of the loaded decks matches.</em> : null}
          {!query.trim() ? <em className="kernel-hint">Type part of a card name.</em> : null}
        </div>
        <div className="modal-actions"><button type="button" onClick={onClose}>Close (Esc)</button></div>
      </article>
      <CardPreviewPanel api={api} />
    </div>
  );
}
