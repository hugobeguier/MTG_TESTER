import type { PlayerSeat, ZoneName } from "@/lib/types";

const ZONES: Array<{ key: ZoneName; label: string }> = [
  { key: "hand", label: "Hand" },
  { key: "library", label: "Library" },
  { key: "graveyard", label: "Grave" },
  { key: "exile", label: "Exile" }
];

export function ZoneSummary({ seat }: { seat: PlayerSeat }) {
  return (
    <dl className="zone-summary">
      {ZONES.map((zone) => (
        <div key={zone.key}>
          <dt>{zone.label}</dt>
          <dd>{seat.zones[zone.key]}</dd>
        </div>
      ))}
    </dl>
  );
}
