# Kernel payment: the player pays, the engine never taps for them

Bug report (kernel mode): "I had tapped for all the colours for Aminatou, but a Treasure also got used". Cause confirmed: the base cost
{W}{U}{B} was in the pool, the commander tax (CR 903.8: {2} more per earlier cast from the command zone) made the total {2}{W}{U}{B}, and the
cast action carried `autoPay: true`, so `autoTapFor` silently tapped sources and SACRIFICED the Treasure for the rest.

## Rule (CR 601.2g-h, 117.3)
Paying is the player's act: they activate mana abilities (mana goes to the pool), then the cost is paid from the pool. In kernel mode a human
seat is in `config.manualPay`: spending mana NEVER activates a mana ability. A short pool opens a `pay_mana` decision.

## Inventory: every place that chose mana sources by itself (before this change)
| Site | Code | Now (manual seat) |
|---|---|---|
| cast a spell (hand, command zone + tax, flashback / escape / alternative cost, kicker, miracle / madness / cast-from-exile / top-of-library / free-cast permissions, improvise side) | resolve.ts `payMana` via `commitDraft` | pool only; `pay_mana` stage before commit |
| activate an ability with a mana cost (cycling, channel, equip, loyalty + mana, Food / Clue, X costs, Phyrexian / hybrid) | `payAbilityCosts` -> `payMana` | same stage |
| unlock a Room door | `unlockDoor` -> `payMana` | `pay_mana` (ctx `special`), cancel = nothing paid |
| turn a morph face up | `turnFaceUp` -> `payMana` | same |
| cast a prepared copy | `castPrepared` -> castSpell | same as a cast |
| mana ability with a mana cost (Signets: {1},{T}: Add ...) | `activateMana` | the {1} comes from the pool, else refused with the reason |
| "unless that player pays {N}" (Mystic Remora, Esper Sentinel, Mana Tithe, ward), "you may pay" (optional costs, cumulative upkeep per age counter, echo-style), pay any amount | unlesspay.ts `unlessHandler` / `payAnyAmount` | "Pay" opens `pay_mana`; Cancel = did not pay |
| attack / block taxes (Propaganda, Ghostly Prison, Sphere of Safety) | combat.ts `payTax` | refused `cannot_pay` with the exact tax; mana abilities work during the declaration, then declare again |
| convoke / improvise / offering-style tapping of creatures / artifacts | improvise stage (a real choice already) | unchanged: a choice, not auto-chosen |
| Phyrexian / hybrid symbols | `phyrexianOptions` asks (mana or 2 life); hybrid `settleCost` | settled from the POOL only |
| legal-action probes (`legalActions`) | `autoPay: true` probes | probes still ask "could this ever be paid"; the action handed to a manual seat has no autoPay |
| AI seats | `autoPay: true` | AI plans the payment itself (kernel/ai/payment.ts) and sends `payWith` |
| observer | `autoPay: true` + `payWith` mirrored from legacy | unchanged (not manual) |

Everything else (sacrifice / discard / tap-other costs, life costs) was already a decision or a fixed cost, not a mana-source choice.

## Protocol
- `config.manualPay: PlayerId[]` (set by `KernelSession` for human seats). An action with `autoPay: true` or `payWith` is the explicit suggestion and still taps.
- `advanceDraft` pay stage: `paymentPlan` builds the TOTAL cost (base way incl. kicker, commander tax, increases / reductions, improvise, additional mana
  costs, Phyrexian symbols paid with mana) with parts; if the pool does not cover it: pending `pay_mana` (`pending.pay`: cost, parts, remaining, life, pool).
- While `pay_mana` is open (or a declaration waits): `activateAbility` of a mana ability (a colour in `color` where a choice exists) and `untapForMana`
  are allowed; after each tap the question is re-evaluated and the cost is paid as soon as the pool covers it. `answerDecision {ids:["cancel"]}` /
  `{cancel:true}` cancels (the card returns, the pool keeps its mana, taps stay take-back-able). `ids:["pay"]` re-checks.
- Suggestion: `suggestTaps` (mana.ts) = dry run of `autoTapFor` with `noOneShot` / `noHurt`; never sacrifices or hurts; colours the hand needs go last.
- `autoTapFor` itself now uses one-shot (sacrifice-self) sources last for every caller.

## AI
`planPayment` rehearses the action on a clone with the seat paying by hand up to `pay_mana`, then picks sources with the policy (free first, hand colours
kept, Treasure / pain only if nothing else, no pain at life <= 6) and attaches them as `payWith`.

## UI (kernel mode)
Banner (not a modal) with the card, total and breakdown, pool, remaining, "Auto-pay (suggest)" (highlights the suggestion; a second press taps it),
Cancel; clicking a glowing source taps it (chooser for several ways); Esc hides the banner, never cancels.
