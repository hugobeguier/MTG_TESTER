import type { VisibleCard } from "@/lib/types";
import { HOURGLASS_PATH, SUMMONING_SICK_TOOLTIP, isSummoningSick } from "@/lib/summoningSickness";

/** Hourglass badge for a summoning-sick creature (HTML overlay: card inspector, VisualCard). Renders nothing otherwise. Position it inside a `position: relative` card box. */
export function SummoningSickBadge({ card }: { card: Pick<VisibleCard, "typeLine" | "summoningSick" | "oracleText" | "grantedKeywords" | "groupGrantedKeywords" | "abilitiesStripped" | "phasedOut"> }) {
  if (!isSummoningSick(card)) return null;
  return (
    <span className="summoning-sick-badge" role="img" aria-label={SUMMONING_SICK_TOOLTIP} title={SUMMONING_SICK_TOOLTIP}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
        <path d={HOURGLASS_PATH} fill="currentColor" stroke="rgba(0,0,0,0.55)" strokeWidth="1" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
