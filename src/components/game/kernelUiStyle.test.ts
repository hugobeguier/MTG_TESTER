// Kernel-mode UI must look like the rest of the app: no colour literals or inline `style` colours in the Kernel*.tsx components (colours come from the
// legacy classes / tokens in app/globals.css), and every non-legacy kernel class used must be defined there. The only colour literals live in the
// .kernel-badge rule (the purple dev badge), which is an intentional marker.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "..");
const files = readdirSync(dir).filter((f) => /^Kernel.*\.tsx$/.test(f));
const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");

describe("kernel UI uses the legacy visual language", () => {
  it("finds the components", () => expect(files.length).toBeGreaterThanOrEqual(5));
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    it(`${f} has no colour literals`, () => {
      expect(src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).toEqual([]);
    });
    it(`${f} has no inline colour / border / background styles`, () => {
      expect(src.match(/style=\{\{[^}]*\b(color|background|backgroundColor|border|borderColor|boxShadow)\s*:/g) ?? []).toEqual([]);
    });
    it(`${f}: every kernel-* class is defined in globals.css`, () => {
      const attrs = [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "").join(" ");
      const used = new Set(attrs.match(/kernel-[a-z-]+/g) ?? []);
      for (const c of used) expect(css.includes("." + c), c).toBe(true);
    });
  }
});
