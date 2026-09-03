import { describe, expect, it } from "vitest";
import {
  parseGenericManaAbilities,
  parseGenericSacrificeAbilities,
  parseGenericTapAbilities,
  parseSearchLibraryEffectText,
  parseSelfUntapAbilities
} from "./activatedAbilities";

describe("parseGenericSacrificeAbilities", () => {
  it("parses Viscera Seer's sacrifice-a-creature-for-scry ability, ignoring trailing reminder text", () => {
    const abilities = parseGenericSacrificeAbilities(
      "Sacrifice a creature: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)"
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toMatchObject({ costMana: 0, costTap: false, sacrificeTarget: "creature", effect: { kind: "scry", amount: 1 } });
  });

  it("parses Carrion Feeder's self-buff sacrifice ability from its second oracle-text line", () => {
    const abilities = parseGenericSacrificeAbilities("This creature can't block.\nSacrifice a creature: Put a +1/+1 counter on this creature.");
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect).toEqual({ kind: "add_counter", counterKind: "+1/+1", amount: 1 });
  });

  it("recognizes Ashnod's Altar as sacrifice-shaped but returns no ability since mana-producing effects aren't executable yet", () => {
    expect(parseGenericSacrificeAbilities("Sacrifice a creature: Add {C}{C}.")).toHaveLength(0);
  });

  it("recognizes Nantuko Husk as sacrifice-shaped but returns no ability since temporary pump effects aren't executable yet", () => {
    expect(parseGenericSacrificeAbilities("Sacrifice a creature: This creature gets +2/+2 until end of turn.")).toHaveLength(0);
  });

  it("parses Food token's mana+tap cost prefix and gain-life effect (self-sacrifice)", () => {
    const abilities = parseGenericSacrificeAbilities("{2}, {T}, Sacrifice this artifact: You gain 3 life.");
    expect(abilities).toEqual([
      {
        costMana: 2,
        costTap: true,
        costDiscard: false,
        sacrificeTarget: "self",
        sacrificeCount: 1,
        effect: { kind: "gain_life", amount: 3 },
        clause: "{2}, {T}, Sacrifice this artifact: You gain 3 life."
      }
    ]);
  });

  it("parses Clue token's mana-only cost prefix and draw effect (self-sacrifice)", () => {
    const abilities = parseGenericSacrificeAbilities("{2}, Sacrifice this artifact: Draw a card.");
    expect(abilities[0]).toMatchObject({ costMana: 2, costTap: false, costDiscard: false, sacrificeTarget: "self", effect: { kind: "draw_cards", amount: 1 } });
  });

  it("returns nothing for oracle text with no sacrifice ability", () => {
    expect(parseGenericSacrificeAbilities("Flying, vigilance.\nWhenever this creature attacks, draw a card.")).toHaveLength(0);
  });

  it("parses Blood token's discard-as-a-cost ability alongside its mana/tap cost", () => {
    const abilities = parseGenericSacrificeAbilities("{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.");
    expect(abilities[0]).toMatchObject({ costMana: 1, costTap: true, costDiscard: true, sacrificeTarget: "self", effect: { kind: "draw_cards", amount: 1 } });
  });

  it("parses a specific-creature-type sacrifice cost (Retrofitter Foundry's 'Sacrifice a Servo'), capturing the type filter", () => {
    const abilities = parseGenericSacrificeAbilities(
      "{1}, {T}, Sacrifice a Servo: Create a 1/1 colorless Thopter artifact creature token with flying."
    );
    expect(abilities[0]).toMatchObject({
      costMana: 1,
      costTap: true,
      sacrificeTarget: "creature",
      sacrificeTargetTypeFilter: "Servo",
      effect: { kind: "create_tokens" }
    });
  });

  it("parses a tap-only, no-mana specific-creature-type sacrifice (Retrofitter Foundry's 'Sacrifice a Thopter')", () => {
    const abilities = parseGenericSacrificeAbilities("{T}, Sacrifice a Thopter: Create a 4/4 colorless Construct artifact creature token.");
    expect(abilities[0]).toMatchObject({ costMana: 0, costTap: true, sacrificeTargetTypeFilter: "Thopter", effect: { kind: "create_tokens" } });
  });

  it("does not treat 'sacrifice a land'/'sacrifice a permanent'/'sacrifice an artifact' as a creature-type sacrifice", () => {
    expect(parseGenericSacrificeAbilities("Sacrifice a land: Draw a card.")).toHaveLength(0);
    expect(parseGenericSacrificeAbilities("Sacrifice a permanent: Draw a card.")).toHaveLength(0);
    expect(parseGenericSacrificeAbilities("Sacrifice an artifact: Draw a card.")).toHaveLength(0);
  });

  it("leaves 'sacrifice a creature' matching the generic (untyped) creature branch, not the type-filter branch", () => {
    const abilities = parseGenericSacrificeAbilities("Sacrifice a creature: Draw a card.");
    expect(abilities[0]).toMatchObject({ sacrificeTarget: "creature", sacrificeTargetTypeFilter: undefined, effect: { kind: "draw_cards", amount: 1 } });
  });

  it("parses a fixed-count plural sacrifice and the transform effect (Westvale Abbey)", () => {
    const abilities = parseGenericSacrificeAbilities("{5}, {T}, Sacrifice five creatures: Transform this land, then untap it.");
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toMatchObject({
      costMana: 5,
      costTap: true,
      sacrificeTarget: "creature",
      sacrificeTargetTypeFilter: undefined,
      sacrificeCount: 5,
      effect: { kind: "transform_self" }
    });
  });

  it("parses a Fog-shaped combat-damage-prevention sacrifice (Spore Frog)", () => {
    const abilities = parseGenericSacrificeAbilities("Sacrifice this creature: Prevent all combat damage that would be dealt this turn.");
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toMatchObject({ sacrificeTarget: "self", effect: { kind: "prevent_combat_damage" } });
  });

  it("also accepts the real printed 'dealt to you this turn' phrasing, not just this card data's own 'dealt this turn'", () => {
    const abilities = parseGenericSacrificeAbilities("Sacrifice this creature: Prevent all combat damage that would be dealt to you this turn.");
    expect(abilities[0]).toMatchObject({ effect: { kind: "prevent_combat_damage" } });
  });

  it("defaults sacrificeCount to 1 for the ordinary singular shapes", () => {
    const abilities = parseGenericSacrificeAbilities("Sacrifice a creature: Scry 1.");
    expect(abilities[0].sacrificeCount).toBe(1);
  });

  it("parses Sakura-Tribe Elder's real no-tap basic-land search ability", () => {
    const [ability] = parseGenericSacrificeAbilities(
      "Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle."
    );
    expect(ability).toMatchObject({
      costMana: 0,
      costTap: false,
      sacrificeTarget: "self",
      effect: { kind: "search_library", destination: "battlefield", tapped: true, cardTypeFilter: "basic land" }
    });
  });

  it("declines Birthing Pod's sacrifice-scaled search (a dynamic 'with mana value' qualifier)", () => {
    expect(
      parseGenericSacrificeAbilities(
        "{1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery."
      )
    ).toHaveLength(0);
  });

  it("parses Cankerbloom's real modal destroy ability, merging its 'Choose one —' header with its bullet modes", () => {
    const [ability] = parseGenericSacrificeAbilities(
      "{1}, Sacrifice this creature: Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Proliferate."
    );
    expect(ability).toMatchObject({
      costMana: 1,
      costTap: false,
      sacrificeTarget: "self",
      effect: {
        kind: "removal",
        effect: {
          kind: "modal",
          chooseCount: 1,
          modes: [
            { kind: "destroy", targetType: "artifact" },
            { kind: "destroy", targetType: "enchantment" }
          ]
        }
      }
    });
  });

  it("parses a plain (non-modal) sacrifice-for-destroy ability via the removal fallback", () => {
    const [ability] = parseGenericSacrificeAbilities("{T}, Sacrifice this artifact: Destroy target creature.");
    expect(ability).toMatchObject({
      costMana: 0,
      costTap: true,
      sacrificeTarget: "self",
      effect: { kind: "removal", effect: { kind: "destroy", targetType: "creature" } }
    });
  });
});

describe("parseGenericTapAbilities", () => {
  it("parses Retrofitter Foundry's real '{2}, {T}: Create a Servo' ability", () => {
    const [ability] = parseGenericTapAbilities("{2}, {T}: Create a 1/1 colorless Servo artifact creature token.");
    expect(ability).toMatchObject({ costMana: 2, untapsSelf: false, effect: { kind: "create_tokens" } });
  });

  it("parses a self-untap-prefixed counter+upgrade ability, including a 'becomes an N/N Y' upgrade", () => {
    const [ability] = parseGenericTapAbilities(
      "{1}, {T}: Untap this artifact. Put a +1/+1 counter on target Servo creature you control. That creature becomes a 4/4 Construct artifact creature in addition to its other types."
    );
    expect(ability).toMatchObject({
      costMana: 1,
      untapsSelf: true,
      effect: { kind: "counter_and_transform", targetTypeFilter: "Servo", power: 4, toughness: 4, addedType: "Construct" }
    });
  });

  it("parses a self-untap-prefixed bounce ability with a type filter", () => {
    const [ability] = parseGenericTapAbilities("{2}, {T}: Untap this artifact. Return a Servo you control to its owner's hand.");
    expect(ability).toMatchObject({ costMana: 2, untapsSelf: true, effect: { kind: "bounce_own", targetTypeFilter: "Servo" } });
  });

  it("parses a generic 'target creature you control' counter ability with no type filter and no upgrade", () => {
    const [ability] = parseGenericTapAbilities("{T}: Put a +1/+1 counter on target creature you control.");
    expect(ability).toMatchObject({ effect: { kind: "counter_and_transform", targetTypeFilter: undefined, power: undefined, toughness: undefined, addedType: undefined } });
  });

  it("parses a generic 'return a creature you control' bounce ability with no type filter", () => {
    const [ability] = parseGenericTapAbilities("{1}, {T}: Return a creature you control to its owner's hand.");
    expect(ability).toMatchObject({ effect: { kind: "bounce_own", targetTypeFilter: undefined } });
  });

  it("does not double-count a sacrifice-cost tap ability already owned by parseGenericSacrificeAbilities", () => {
    expect(parseGenericTapAbilities("{1}, {T}, Sacrifice this artifact: Draw a card.")).toHaveLength(0);
    expect(parseGenericTapAbilities("{1}, {T}, Sacrifice a Servo: Create a 1/1 colorless Thopter artifact creature token with flying.")).toHaveLength(0);
  });

  it("returns nothing for oracle text with no tap ability", () => {
    expect(parseGenericTapAbilities("Flying, vigilance.\nWhenever this creature attacks, draw a card.")).toHaveLength(0);
  });

  it("parses Fauna Shaman's real discard-a-creature-card-cost search ability", () => {
    const [ability] = parseGenericTapAbilities("{G}, {T}, Discard a creature card: Search your library for a creature card, reveal it, put it into your hand, then shuffle.");
    expect(ability).toMatchObject({
      costDiscard: true,
      effect: { kind: "search_library", destination: "hand", tapped: false, cardTypeFilter: "creature" }
    });
  });
});

describe("parseSearchLibraryEffectText", () => {
  it("parses a plain 'for a card' tutor with no type filter (Diabolic Intent)", () => {
    expect(parseSearchLibraryEffectText("search your library for a card, put that card into your hand, then shuffle.")).toEqual({
      kind: "search_library",
      destination: "hand",
      tapped: false,
      cardTypeFilter: undefined,
      count: 1
    });
  });

  it("parses a typed, reveal-it tutor to hand (Fauna Shaman)", () => {
    expect(parseSearchLibraryEffectText("search your library for a creature card, reveal it, put it into your hand, then shuffle.")).toEqual({
      kind: "search_library",
      destination: "hand",
      tapped: false,
      cardTypeFilter: "creature",
      count: 1
    });
  });

  it("parses a basic-land-to-battlefield-tapped tutor (Sakura-Tribe Elder)", () => {
    expect(parseSearchLibraryEffectText("search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.")).toEqual({
      kind: "search_library",
      destination: "battlefield",
      tapped: true,
      cardTypeFilter: "basic land",
      count: 1
    });
  });

  // Three Visits/Nature's Lore-shaped sorceries: a plain, untapped battlefield destination — the
  // whole card IS this one clause, not an ETB trigger on a permanent that stays around. AppFlow.tsx
  // used to only ever call this parser when the CASTER's own spell resolved to the battlefield
  // (destination === "battlefield"), on the assumption that a search is always an ETB clause on a
  // permanent — but these sorceries resolve to the graveyard like any other sorcery while their
  // search still has to happen, so that gate left searchLibraryEffect permanently undefined for
  // them and the spell silently did nothing. Reported live as "Three Visits resolves" (mana spent,
  // event logged) with no Forest ever fetched. The parser itself was already correct; this locks in
  // that it recognizes the shape, now that the caller no longer gates on the spell's own destination.
  it("parses an untapped battlefield tutor (Three Visits/Nature's Lore)", () => {
    expect(parseSearchLibraryEffectText("Search your library for a Forest card, put it onto the battlefield, then shuffle.")).toEqual({
      kind: "search_library",
      destination: "battlefield",
      tapped: false,
      cardTypeFilter: "Forest",
      count: 1
    });
  });

  it("parses an 'up to N' count (Archaeomancer's Map)", () => {
    expect(
      parseSearchLibraryEffectText("search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle.")
    ).toEqual({
      kind: "search_library",
      destination: "hand",
      tapped: false,
      cardTypeFilter: "basic Plains",
      count: 2
    });
  });

  it("parses an ETB-triggered search with its trigger condition still attached (Archaeomancer's Map, via etbEffectText)", () => {
    // etbEffectText keeps a kept clause's full text, including its "When ~ enters," prefix — every
    // other etbEffectText-fed parser matches with \b word boundaries so the prefix never mattered,
    // but this parser's ^-anchored pattern needs to tolerate it explicitly, or an ETB-triggered
    // search (as opposed to an activated-ability one, whose effect text is already isolated after
    // its cost's colon) never matches at all.
    expect(
      parseSearchLibraryEffectText(
        "When this artifact enters, search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle."
      )
    ).toEqual({
      kind: "search_library",
      destination: "hand",
      tapped: false,
      cardTypeFilter: "basic Plains",
      count: 2
    });
  });

  it("parses a search with a 'that share a land type' qualifier between the count and the put clause (Myriad Landscape)", () => {
    expect(
      parseSearchLibraryEffectText(
        "search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle."
      )
    ).toEqual({
      kind: "search_library",
      destination: "battlefield",
      tapped: true,
      cardTypeFilter: "basic land",
      count: 2
    });
  });

  it("declines a search with a dynamic/comparative qualifier it can't safely resolve (Birthing Pod)", () => {
    expect(
      parseSearchLibraryEffectText(
        "search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle."
      )
    ).toBeUndefined();
  });

  it("returns undefined for text with no search-library shape", () => {
    expect(parseSearchLibraryEffectText("draw a card.")).toBeUndefined();
  });

  it("parses a typed tutor-to-top-of-library ability (Sterling Grove)", () => {
    expect(parseSearchLibraryEffectText("search your library for an enchantment card, reveal it, then shuffle and put that card on top.")).toEqual({
      kind: "search_library",
      destination: "library",
      tapped: false,
      cardTypeFilter: "enchantment",
      count: 1
    });
  });

  it("parses an untyped tutor-to-top-of-library ability (Vampiric Tutor-shaped)", () => {
    expect(parseSearchLibraryEffectText("search your library for a card, then shuffle and put that card on top.")).toEqual({
      kind: "search_library",
      destination: "library",
      tapped: false,
      cardTypeFilter: undefined,
      count: 1
    });
  });
});

describe("parseSelfUntapAbilities", () => {
  it("parses Retrofitter Foundry's real '{3}: Untap this artifact.' ability", () => {
    const abilities = parseSelfUntapAbilities("{3}: Untap this artifact.");
    expect(abilities).toEqual([{ costMana: 3, clause: "{3}: Untap this artifact." }]);
  });

  it("does not match a self-untap clause whose cost includes {T} (that's parseGenericTapAbilities' shape instead)", () => {
    expect(parseSelfUntapAbilities("{1}, {T}: Untap this artifact. Draw a card.")).toHaveLength(0);
  });

  it("does not match an untap ability with a further effect after the untap sentence", () => {
    expect(parseSelfUntapAbilities("{3}: Untap this artifact. Draw a card.")).toHaveLength(0);
  });

  it("returns nothing for oracle text with no self-untap ability", () => {
    expect(parseSelfUntapAbilities("Flying, vigilance.")).toHaveLength(0);
  });
});

describe("parseGenericManaAbilities", () => {
  it("parses a plain mana-only-cost ability, handing back the raw effect text", () => {
    expect(parseGenericManaAbilities("{2}: Draw a card.")).toEqual([
      { costManaText: "{2}", costLife: 0, costDiscard: false, effectText: "Draw a card", clause: "{2}: Draw a card." }
    ]);
  });

  it("parses a discard-cost ability", () => {
    const abilities = parseGenericManaAbilities("{1}, Discard a card: Return target creature card from your graveyard to your hand.");
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toMatchObject({ costManaText: "{1}", costDiscard: true });
  });

  it("parses a colored-mana-plus-life-cost ability (Greed)", () => {
    const abilities = parseGenericManaAbilities("{B}, Pay 2 life: Draw a card.");
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toMatchObject({ costManaText: "{B}", costLife: 2, costDiscard: false, effectText: "Draw a card" });
  });

  it("does not match a {T}-cost clause (that's parseGenericTapAbilities' shape instead)", () => {
    expect(parseGenericManaAbilities("{2}, {T}: Create a 1/1 colorless Servo artifact creature token.")).toHaveLength(0);
  });

  it("does not match a sacrifice-cost clause (that's parseGenericSacrificeAbilities' shape instead)", () => {
    expect(parseGenericManaAbilities("Sacrifice a creature: Scry 1.")).toHaveLength(0);
  });

  it("does not match a bare untap effect (that's parseSelfUntapAbilities' shape instead)", () => {
    expect(parseGenericManaAbilities("{3}: Untap this artifact.")).toHaveLength(0);
  });

  it("declines an {X}-cost ability rather than treating it as free", () => {
    expect(parseGenericManaAbilities("{X}: Target creature gets +X/+X until end of turn.")).toHaveLength(0);
  });

  it("returns nothing for oracle text with no generic mana-cost ability", () => {
    expect(parseGenericManaAbilities("Flying, vigilance.")).toHaveLength(0);
  });
});

describe("Retrofitter Foundry end-to-end (all four real abilities, combined oracle text)", () => {
  const RETROFITTER_FOUNDRY = [
    "{3}: Untap this artifact.",
    "{2}, {T}: Create a 1/1 colorless Servo artifact creature token.",
    "{1}, {T}, Sacrifice a Servo: Create a 1/1 colorless Thopter artifact creature token with flying.",
    "{T}, Sacrifice a Thopter: Create a 4/4 colorless Construct artifact creature token."
  ].join("\n");

  it("parses the self-untap ability", () => {
    expect(parseSelfUntapAbilities(RETROFITTER_FOUNDRY)).toEqual([{ costMana: 3, clause: "{3}: Untap this artifact." }]);
  });

  it("parses the plain Servo-making tap ability", () => {
    const tapAbilities = parseGenericTapAbilities(RETROFITTER_FOUNDRY);
    expect(tapAbilities).toHaveLength(1);
    expect(tapAbilities[0]).toMatchObject({ costMana: 2, effect: { kind: "create_tokens" } });
  });

  it("parses both sacrifice-a-Servo-for-Thopter and sacrifice-a-Thopter-for-Construct abilities", () => {
    const sacAbilities = parseGenericSacrificeAbilities(RETROFITTER_FOUNDRY);
    expect(sacAbilities).toHaveLength(2);
    expect(sacAbilities[0]).toMatchObject({ costMana: 1, costTap: true, sacrificeTargetTypeFilter: "Servo", effect: { kind: "create_tokens" } });
    expect(sacAbilities[1]).toMatchObject({ costMana: 0, costTap: true, sacrificeTargetTypeFilter: "Thopter", effect: { kind: "create_tokens" } });
  });
});
