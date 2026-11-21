// Attaching: the `attach` step (equip, living weapon, "attach this Equipment to target creature an opponent controls") and the
// state-based unattach (704.5n: an Equipment attached to something that is not a creature stops being attached; Auras are
// handled by the existing aura SBA). An attachment is attached to a host by `attachedTo` + `attachedToTs` (the host's timestamp,
// so a host that left and came back is a different object and the attachment is simply unattached, see layers.hostOf).

import { chars, emit, label, tryObj, type Run } from "./core";
import { hostOf } from "./layers";
import { resolveObjs } from "./query";
import type { StepSpec } from "./steps";
import type { GameObject, ObjId } from "./types";

const isEquipment = (r: Run, o: GameObject): boolean => chars(r, o.id).subtypes.some((s) => s.toLowerCase() === "equipment");

/** Can `att` be attached to `host` right now? (Equipment: only to a creature; nothing attaches to itself.) */
export function canAttach(r: Run, att: GameObject, host: GameObject): boolean {
  if (att.id === host.id || att.zone !== "battlefield" || host.zone !== "battlefield") return false;
  if (isEquipment(r, att) && !chars(r, host.id).types.includes("creature")) return false;
  return true;
}

export function attachTo(r: Run, att: GameObject, host: GameObject): boolean {
  if (!canAttach(r, att, host)) return false;
  if (hostOf(r, att)?.id === host.id) return true; // already attached to it: nothing happens
  att.attachedTo = host.id; att.attachedToTs = host.timestamp;
  emit(r, { type: "attached", id: att.id, to: host.id });
  return true;
}

export const attachStep: StepSpec = {
  fields: ["what", "to"],
  run: (r, ex, step) => {
    const env = ex.env;
    const what = String(step.what ?? "self");
    const attachments: ObjId[] = what === "self" ? [env.source] : resolveObjs(r, what, env);
    const hosts = resolveObjs(r, String(step.to), env);
    const host = hosts[0] ? tryObj(r, hosts[0]) : undefined;
    for (const id of attachments) {
      const att = tryObj(r, id);
      if (!att || !host) continue;
      if (!attachTo(r, att, host)) emit(r, { type: "attach_failed", id, to: host.id, reason: `${label(r, id)} cannot be attached to ${label(r, host.id)}` });
    }
    return "done";
  }
};

/** State-based action: an Equipment attached to a non-creature (or to nothing valid) becomes unattached. Returns true when something changed. */
export function unattachIllegal(r: Run, o: GameObject): boolean {
  if (!o.attachedTo) return false;
  const host = hostOf(r, o);
  if (!host || (isEquipment(r, o) && !chars(r, host.id).types.includes("creature"))) {
    o.attachedTo = undefined; o.attachedToTs = undefined;
    emit(r, { type: "sba_unattached", id: o.id });
    return true;
  }
  return false;
}
