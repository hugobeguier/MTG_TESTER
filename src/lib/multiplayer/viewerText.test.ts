import { describe, expect, it } from "vitest";
import { eventsForViewer, hostVoiceToName, thirdPersonVerb } from "./viewerText";

describe("thirdPersonVerb", () => {
  it("conjugates present tense, leaves past tense and modals alone", () => {
    expect(thirdPersonVerb("pass")).toBe("passes");
    expect(thirdPersonVerb("attack")).toBe("attacks");
    expect(thirdPersonVerb("try")).toBe("tries");
    expect(thirdPersonVerb("have")).toBe("has");
    expect(thirdPersonVerb("discard")).toBe("discards");
    expect(thirdPersonVerb("drew")).toBe("drew");
    expect(thirdPersonVerb("discarded")).toBe("discarded");
    expect(thirdPersonVerb("cannot")).toBe("cannot");
  });
});

describe("hostVoiceToName", () => {
  it("turns the host's second-person lines into the host's name", () => {
    expect(hostVoiceToName("You pass to precombat main phase.", "Hugo")).toBe("Hugo passes to precombat main phase.");
    expect(hostVoiceToName("You attack Alex with Bear.", "Hugo")).toBe("Hugo attacks Alex with Bear.");
    expect(hostVoiceToName("You cannot attack Alex with Bear: unable to pay.", "Hugo")).toBe("Hugo cannot attack Alex with Bear: unable to pay.");
    expect(hostVoiceToName("You can't play a card.", "Hugo")).toBe("Hugo can't play a card.");
    expect(hostVoiceToName("Alex attacks You with Bear.", "Hugo")).toBe("Alex attacks Hugo with Bear.");
    expect(hostVoiceToName("You start turn 2: untap step.", "Hugo")).toBe("Hugo starts turn 2: untap step.");
  });
});

describe("eventsForViewer", () => {
  const events = [
    { id: "1", at: "t", seatId: "host", message: "You draw for turn." },
    { id: "2", at: "t", seatId: "friend", message: "Sam draws for turn." }
  ];
  it("rewrites only the host-voiced lines, and does nothing when the host seat has a real name", () => {
    expect(eventsForViewer(events, "host", "Hugo").map((e) => e.message)).toEqual(["Hugo draws for turn.", "Sam draws for turn."]);
    expect(eventsForViewer(events, "host", "You")).toBe(events);
  });
});
