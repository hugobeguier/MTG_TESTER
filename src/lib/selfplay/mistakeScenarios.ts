// Tiny decision-point fixtures, one per entry in docs/agents/real-game-mistakes.md (the "fixture" column). Each is the SHAPE of a situation
// where an agent once did something dumb: the bad action is among the legal actions, the mistake detector (mistakes.ts) must flag it, and
// -- once the entry's status is "fixed" -- the deterministic scorer + play guards must no longer pick it (mistakeScenarios.test.ts).
// Oracle text is real; only the boards are invented.
import type { CardLike, ScorableAction, ScoringContext } from "@/lib/actionScoring";
import type { MistakeCategory } from "./mistakes";

export interface MistakeScenario {
  category: MistakeCategory;
  description: string;
  purpose: string;
  context: ScoringContext;
  legalActions: ScorableAction[];
  // The legal action the agent used to take.
  badActionId: string;
}

let nextId = 0;
function perm(name: string, typeLine: string, manaValue: number, power: string | undefined, toughness: string | undefined, oracleText: string, extra: Partial<CardLike> = {}): CardLike {
  nextId += 1;
  return { id: `${name}#${nextId}`, name, typeLine, manaValue, power, toughness, oracleText, ...extra };
}
function handCard(name: string, typeLine: string, manaValue: number, oracleText: string): CardLike {
  return { id: `hand-${name}`, name, typeLine, manaValue, oracleText };
}
function castAction(card: CardLike, targetIds: string[] = []): ScorableAction {
  return { id: `cast:${card.id}`, actionType: "cast_spell", cardId: card.id, targetIds, label: `cast ${card.name}`, detail: `{${card.manaValue}} ${card.typeLine}. ${card.oracleText} Payable with ${card.manaValue} lands.` };
}
const pass: ScorableAction = { id: "pass-phase", actionType: "pass_priority", targetIds: [], label: "pass this phase" };
const noAttackers: ScorableAction = { id: "no-attackers", actionType: "pass_priority", targetIds: [], label: "declare no attackers" };

function context(purpose: string, phase: string, you: Partial<NonNullable<ScoringContext["you"]>>, opponents: NonNullable<ScoringContext["opponents"]>, extra: Partial<ScoringContext> = {}): ScoringContext {
  return { purpose, turn: 7, phase, you: { id: "me", life: 40, battlefield: [], hand: [], availableMana: { total: 5 }, ...you }, opponents, ...extra };
}

function build(): Record<string, MistakeScenario> {
  const scenarios: Record<string, MistakeScenario> = {};

  // (1) Viscera Seer sacrificing a real creature again and again just to scry.
  {
    const seer = perm("Viscera Seer", "Creature — Vampire Wizard", 1, "1", "1", "Sacrifice a creature: Scry 1.");
    const nighthawk = perm("Vampire Nighthawk", "Creature — Vampire Shaman", 3, "2", "3", "Flying\nDeathtouch\nLifelink");
    const sac: ScorableAction = {
      id: `activate-sacrifice:${seer.id}:0`,
      actionType: "activate_ability",
      abilityKind: "generic_sacrifice",
      cardId: seer.id,
      sacrificeCardIds: [nighthawk.id],
      targetIds: [],
      label: "activate Viscera Seer (sacrifice Vampire Nighthawk)",
      detail: seer.oracleText
    };
    scenarios["viscera-seer-scry-loop"] = {
      category: "pointless_sacrifice",
      description: "Viscera Seer with a Vampire Nighthawk on board: sacrificing it to scry 1 has no real gain",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { battlefield: [seer, nighthawk] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [] }]),
      legalActions: [sac, pass],
      badActionId: sac.id
    };
  }

  // (2) Instant removal on a non-threatening creature.
  {
    const swords = handCard("Swords to Plowshares", "Instant", 1, "Exile target creature. Its controller gains life equal to its power.");
    const bears = perm("Grizzly Bears", "Creature — Bear", 2, "2", "2", "");
    const action = castAction(swords);
    scenarios["swords-on-grizzly-bears"] = {
      category: "removal_on_low_threat",
      description: "Swords to Plowshares in hand, the opponent's only creature is a vanilla 2/2",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [swords] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [bears] }]),
      legalActions: [action, pass],
      badActionId: action.id
    };
  }

  // (3) Tamiyo's Safekeeping with nothing targeting anything.
  {
    const safekeeping = handCard("Tamiyo's Safekeeping", "Instant", 1, "Target permanent you control gains hexproof and indestructible until end of turn. You gain 2 life.");
    const elf = perm("Llanowar Elves", "Creature — Elf Druid", 1, "1", "1", "{T}: Add {G}.");
    const action = castAction(safekeeping, [elf.id]);
    scenarios["tamiyos-safekeeping-idle"] = {
      category: "idle_protection_spell",
      description: "Tamiyo's Safekeeping cast on my own mana elf with an empty stack",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [safekeeping], battlefield: [elf] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [] }]),
      legalActions: [action, pass],
      badActionId: action.id
    };
  }

  // (4) Speaker of the Heavens not attacking into an empty board.
  {
    const speaker = perm(
      "Speaker of the Heavens",
      "Creature — Human Cleric",
      3,
      "1",
      "1",
      "{T}: Create a 4/4 white Angel creature token with flying and vigilance. Activate only if you have at least 7 life more than your starting life total and only as a sorcery."
    );
    const attack: ScorableAction = { id: `attack:${speaker.id}:opp`, actionType: "attack", cardId: speaker.id, targetIds: ["opp"], label: "attack Opp with Speaker of the Heavens" };
    scenarios["speaker-empty-board"] = {
      category: "declined_free_attack",
      description: "Speaker of the Heavens could attack a player with no creatures and chose to declare no attackers",
      purpose: "declare_attackers",
      context: context("declare_attackers", "declare attackers step", { battlefield: [speaker] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [] }]),
      legalActions: [attack, noAttackers],
      badActionId: noAttackers.id
    };
  }

  // (5) Arachnogenesis cast in the precombat main phase.
  {
    const arachno = handCard(
      "Arachnogenesis",
      "Instant",
      3,
      "Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures attacking you. Prevent all combat damage that would be dealt this turn by non-Spider creatures."
    );
    const action = castAction(arachno);
    scenarios["arachnogenesis-precombat"] = {
      category: "combat_spell_outside_combat",
      description: "Arachnogenesis (a fog) cast in my own precombat main phase with nobody attacking",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [arachno] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [perm("Hill Giant", "Creature — Giant", 4, "3", "3", "")] }]),
      legalActions: [action, pass],
      badActionId: action.id
    };
  }

  // (6) Found by the detector: Swords with no opposing creature can only hit my own commander.
  {
    const swords = handCard("Swords to Plowshares", "Instant", 1, "Exile target creature. Its controller gains life equal to its power.");
    const giada = perm("Giada, Font of Hope", "Legendary Creature — Angel", 3, "2", "2", "Flying, vigilance\nEach other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.", { commander: true });
    const action = castAction(swords);
    scenarios["swords-no-opposing-creature"] = {
      category: "spell_no_target_or_effect",
      description: "Swords to Plowshares cast when the opponents control no creature: the only legal target is my own commander",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [swords], battlefield: [giada] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [] }]),
      legalActions: [action, pass],
      badActionId: action.id
    };
  }

  // (7) Found by the detector: a counterspell cast in the main phase with an empty stack.
  {
    const negate = handCard("Negate", "Instant", 2, "Counter target noncreature spell.");
    const action = castAction(negate);
    scenarios["counterspell-empty-stack"] = {
      category: "spell_no_target_or_effect",
      description: "Negate cast during my own main phase with nothing on the stack",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [negate] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [] }]),
      legalActions: [action, pass],
      badActionId: action.id
    };
  }

  // (8) Found by the detector: a draw-three-lose-three spell at 3 life.
  {
    const cost = handCard("Ambition's Cost", "Sorcery", 4, "You draw three cards and you lose 3 life.");
    const action = castAction(cost);
    scenarios["ambitions-cost-at-3-life"] = {
      category: "self_lethal_life_cost",
      description: "Ambition's Cost cast at 3 life",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [cost], life: 3 }, [{ id: "opp", name: "Opp", life: 40, battlefield: [] }]),
      legalActions: [action, pass],
      badActionId: action.id
    };
  }

  // (9) Found by the detector: after one blocker is chosen, adding a second creature that just dies (blocks added at the +2 baseline).
  {
    const watcher = perm("Thraben Watcher", "Creature — Human Soldier", 1, "1", "1", "Vigilance\nWhenever another creature you control dies, you gain 1 life.");
    const ayara = perm("Ayara, First of Locthwain", "Legendary Creature — Elf Noble", 3, "2", "3", "Whenever Ayara or another black creature you control enters, each opponent loses 1 life and you gain 1 life.", { attacking: true });
    const block: ScorableAction = { id: `block:${watcher.id}`, actionType: "block", cardId: watcher.id, targetIds: [ayara.id], label: "block Ayara, First of Locthwain with Thraben Watcher" };
    const none: ScorableAction = { id: "no-blocks", actionType: "pass_priority", targetIds: [ayara.id], label: "declare no blockers" };
    scenarios["additional-blocker-dies"] = {
      category: "pointless_block",
      description: "A second blocker (Thraben Watcher) is added to a block against Ayara at 38 life and just dies",
      purpose: "declare_blockers_additional",
      // The detector only calls a block pointless for a creature worth keeping (value >= 3), so the Watcher is given mana value 3 here.
      context: context("declare_blockers_additional", "declare blockers step", { life: 38, battlefield: [{ ...watcher, manaValue: 3 }] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [ayara] }]),
      legalActions: [block, none],
      badActionId: block.id
    };
  }

  // (10) A lone valuable attacker into a blocker that kills it and survives.
  {
    const hydra = perm("Test Hydra", "Creature — Hydra", 6, "7", "7", "");
    const ground = perm("Veteran Knight", "Creature — Human Knight", 4, "3", "3", "First strike");
    const groundAttack: ScorableAction = { id: `attack:${ground.id}`, actionType: "attack", cardId: ground.id, targetIds: ["opp"], label: "attack Opp with Veteran Knight" };
    scenarios["lone-attacker-into-bigger-blocker"] = {
      category: "suicide_attack",
      description: "A lone 3/3 first striker attacks a player whose untapped 7/7 blocks and kills it",
      purpose: "declare_attackers",
      context: context("declare_attackers", "declare attackers step", { battlefield: [ground] }, [{ id: "opp", name: "Opp", life: 40, battlefield: [hydra] }]),
      legalActions: [groundAttack, noAttackers],
      badActionId: groundAttack.id
    };
  }

  // (11) + (12) Wrath of God in hand against two 3/3s: the wipe must come BEFORE the creature, and never after it.
  {
    const wrath = handCard("Wrath of God", "Sorcery", 4, "Destroy all creatures. They can't be regenerated.");
    const giantInHand = handCard("Test Giant", "Creature — Giant", 5, "");
    const theirs = [perm("Hill Giant", "Creature — Giant", 4, "3", "3", ""), perm("Hill Giant", "Creature — Giant", 4, "3", "3", "")];
    const castGiant: ScorableAction = { ...castAction(giantInHand) };
    const castWrath = castAction(wrath);
    scenarios["creature-before-wrath"] = {
      category: "sequencing_wipe_after_creature",
      description: "Wrath of God (castable, net-positive) and a 5-mana creature in hand with 9 mana: the creature is cast first and the wipe then kills it or is held back",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [wrath, { ...giantInHand, power: "4", toughness: "4" }], availableMana: { total: 9 } }, [{ id: "opp", name: "Opp", life: 40, battlefield: theirs }]),
      legalActions: [castGiant, castWrath, pass],
      badActionId: castGiant.id
    };
    const fresh = perm("Test Giant", "Creature — Giant", 5, "4", "4", "", { enteredTurn: 7, summoningSick: true });
    scenarios["wrath-after-creature"] = {
      category: "sequencing_wipe_after_creature",
      description: "The 5-mana creature is already on the battlefield (cast this turn); Wrath of God would kill it for a marginal gain",
      purpose: "main_phase",
      context: context("main_phase", "precombat main phase", { hand: [wrath], battlefield: [fresh], availableMana: { total: 4 } }, [{ id: "opp", name: "Opp", life: 40, battlefield: theirs }]),
      legalActions: [castWrath, pass],
      badActionId: castWrath.id
    };
  }

  return scenarios;
}

export const MISTAKE_SCENARIOS: Record<string, MistakeScenario> = build();
