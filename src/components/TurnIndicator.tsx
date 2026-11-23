"use client";
// Always-visible turn / phase / priority readout for the 3D table (top-left HUD, kernel and legacy): a banner naming the turn and active player, one chip per
// seat (ACTIVE and PRIORITY tags, shape + text, never colour alone), the ordered phase track, and a status line saying who the game is waiting for.
// Presentational only: everything it shows comes from buildIndicatorView (game/turnIndicatorView.ts).
import { buildIndicatorView, type IndicatorInput, type SeatChip } from "./game/turnIndicatorView";

const SEAT_COLORS = ["#72a7d9", "#d96d5f", "#73b47a", "#d7b35a"];

function Chip({ chip, index }: { chip: SeatChip; index: number }) {
  const color = SEAT_COLORS[index % SEAT_COLORS.length];
  return (
    <li className={`turn-chip${chip.active ? " is-active" : ""}${chip.priority ? " has-priority" : ""}${chip.eliminated ? " is-out" : ""}`} aria-label={chip.label} style={{ ["--seat" as string]: color }}>
      <span className="turn-chip-dot" aria-hidden="true">{chip.active ? "▶" : "●"}</span>
      <span className="turn-chip-name">{chip.name}</span>
      {chip.active ? <b className="turn-tag">ACTIVE</b> : null}
      {chip.priority ? <b className="turn-tag is-priority">PRIORITY</b> : null}
      {chip.eliminated ? <b className="turn-tag is-out">OUT</b> : null}
    </li>
  );
}

export function TurnIndicator(props: IndicatorInput) {
  const v = buildIndicatorView(props);
  return (
    <div className="turn-indicator" data-testid="turn-indicator">
      <div className="turn-banner" data-testid="turn-banner">{v.banner}</div>
      <ul className="turn-chips" aria-label="Players">
        {v.seats.map((chip, i) => <Chip key={chip.id} chip={chip} index={i} />)}
      </ul>
      <ol className="phase-track" aria-label={`Turn phases, current: ${v.phaseLabel}`}>
        {v.phases.map((cell) => (
          <li key={cell.id} className={`phase-cell is-${cell.state}`} aria-current={cell.state === "current" ? "step" : undefined}>{cell.state === "current" ? "▸ " : ""}{cell.label}</li>
        ))}
      </ol>
      <div className={`turn-status${v.humanPriority ? " is-mine" : ""}`} data-testid="turn-status" role="status" aria-live="polite" aria-atomic="true">
        <strong>{v.status}</strong>
        {v.stackLine ? <span className="turn-stack">{v.stackLine}</span> : null}
      </div>
    </div>
  );
}
