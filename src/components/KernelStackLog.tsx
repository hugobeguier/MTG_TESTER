"use client";
// Kernel mode: the "Stack log" panel. A tree per cast / activation / land drop / combat step: what was put on the stack and why, in which order, what each item did
// when it resolved, the replacement effects and state-based actions that followed, and "Stack empty" at the end. The data is built by kernel/integration/stackLog.ts
// from the engine's events; this component only renders it (legacy log-panel look: .activity-panel, card names hoverable like the action log).
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameSession, VisibleCard } from "@/lib/types";
import type { KernelGameController } from "./game/kernelController";
import { splitCardNames, visibleCardsByName } from "./game/logCards";
import { STACK_LOG_FILTERS, visibleLines, type StackLogCat, type StackLogGroup } from "@/kernel/integration/stackLog";

const HOVER = "mtg-card-hover"; // = CARD_HOVER_EVENT in ThreeGameTable
const fire = (detail: object) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HOVER, { detail })); };

/** how many of the newest groups are rendered (the rest sit behind "show older") */
const PAGE = 25;
/** the newest groups start expanded, older ones start collapsed (a click flips either) */
const OPEN_BY_DEFAULT = 3;

function CardText({ text, cards }: { text: string; cards: ReadonlyMap<string, VisibleCard> }) {
  const parts = splitCardNames(text, cards);
  return (
    <>
      {parts.map((p, i) => p.card ? (
        <span key={i} className="log-card-name kernel-log-card" onMouseEnter={() => fire({ card: p.card as VisibleCard })} onMouseLeave={() => fire({ leaveId: p.card!.id })}>{p.text}</span>
      ) : <span key={i}>{p.text}</span>)}
    </>
  );
}

function Group({ group, open, onToggle, hidden, resolving, cards, expanded, onExpand }: {
  group: StackLogGroup; open: boolean; onToggle: () => void; hidden: ReadonlySet<StackLogCat>; resolving: string | undefined; cards: ReadonlyMap<string, VisibleCard>;
  expanded: ReadonlySet<number>; onExpand: (id: number) => void;
}) {
  const lines = visibleLines(group, hidden);
  return (
    <section className="kernel-stack-group" data-testid="kernel-stack-group">
      <button type="button" className="kernel-stack-group-title" onClick={onToggle} aria-expanded={open}>
        <span className="kernel-stack-twisty">{open ? "–" : "+"}</span>
        <span><CardText text={group.title} cards={cards} /></span>
        {!open ? <small>{group.lines.length} step{group.lines.length === 1 ? "" : "s"}</small> : null}
      </button>
      {open ? (
        <div className="kernel-stack-lines">
          {lines.map((l) => (
            <p key={l.id} className={`kernel-stack-line kernel-stack-${l.cat}${l.item && l.item === resolving && l.head ? " is-resolving" : ""}`} style={{ paddingLeft: `${l.depth * 14}px` }}>
              {l.detail ? <button type="button" className="kernel-stack-more" onClick={() => onExpand(l.id)} aria-expanded={expanded.has(l.id)} title="Show the full text">{expanded.has(l.id) ? "–" : "+"}</button> : null}
              <CardText text={l.text} cards={cards} />
              {l.detail && expanded.has(l.id) ? <span className="kernel-stack-detail"><CardText text={l.detail} cards={cards} /></span> : null}
            </p>
          ))}
          {group.stackEmpty ? <p className="kernel-stack-line kernel-stack-empty" style={{ paddingLeft: 0 }}>Stack empty.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function KernelStackLog({ controller, session, onClose }: { controller: KernelGameController; session: GameSession; onClose: () => void }) {
  const builder = controller.ks.stackLog(controller.human);
  const version = builder.version;
  const cards = useMemo(() => visibleCardsByName(session), [session]);
  const [hidden, setHidden] = useState<ReadonlySet<StackLogCat>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set()); // groups whose default (open / collapsed) was flipped
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [saveState, setSaveState] = useState<{ busy: boolean; message?: string }>({ busy: false });
  const feed = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const all = builder.groups;
  const from = Math.max(0, all.length - shown);
  const list = all.slice(from);

  useEffect(() => {
    const el = feed.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [version, collapsed, hidden, toggled, shown]);

  const flip = (set: ReadonlySet<number>, id: number): ReadonlySet<number> => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const isOpen = (g: StackLogGroup, i: number): boolean => (i >= all.length - from - OPEN_BY_DEFAULT) !== toggled.has(g.id);

  const save = async () => {
    setSaveState({ busy: true });
    const r = await controller.saveGameLog();
    setSaveState({ busy: false, message: r.ok ? `Saved ${r.file}` : `Could not save: ${r.reason}` });
  };

  return (
    <aside className={`activity-panel kernel-stack-log${collapsed ? " is-collapsed" : ""}`} data-testid="kernel-stack-log" aria-label="Stack log">
      <header>
        <span className="activity-panel-title">
          <strong>Stack log</strong>
          <small>Newest at the bottom (L)</small>
        </span>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand panel" : "Collapse panel"}>{collapsed ? "+" : "–"}</button>
        <button type="button" onClick={onClose} aria-label="Close the stack log">x</button>
      </header>
      {!collapsed ? (
        <div className="kernel-stack-filters" role="group" aria-label="Filters">
          {STACK_LOG_FILTERS.map((f) => (
            <label key={f.cat}>
              <input type="checkbox" checked={!hidden.has(f.cat)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(f.cat)) n.delete(f.cat); else n.add(f.cat); return n; })} /> {f.label}
            </label>
          ))}
          <button type="button" className="kernel-small" onClick={save} disabled={saveState.busy} title="Write this game (decks, seed, every action, the stack log) to data/observer/live-logs/ so a bug can be replayed">Save game log</button>
        </div>
      ) : null}
      {!collapsed && saveState.message ? <p className="kernel-hint kernel-stack-save" data-testid="kernel-stack-save">{saveState.message}</p> : null}
      <div
        className="activity-feed kernel-stack-feed"
        ref={feed}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
      >
        {from > 0 || builder.dropped > 0 ? (
          <button type="button" className="kernel-small" onClick={() => setShown((n) => n + PAGE)} disabled={from === 0}>{from > 0 ? `Show older (${from})` : "Older groups were dropped to keep the game fast"}</button>
        ) : null}
        {list.length === 0 ? <p className="kernel-hint">Nothing has been put on the stack yet.</p> : null}
        {list.map((g, i) => (
          <Group
            key={g.id} group={g} open={isOpen(g, i)} onToggle={() => setToggled((t) => flip(t, g.id))} hidden={hidden}
            resolving={builder.resolvingItem} cards={cards} expanded={expanded} onExpand={(id) => setExpanded((s) => flip(s, id))}
          />
        ))}
      </div>
    </aside>
  );
}
