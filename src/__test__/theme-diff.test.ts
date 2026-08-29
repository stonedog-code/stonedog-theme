/** @jest-environment node */

import { diffResolvedThemes, themesResolveIdentically } from "../theme-diff";
import { adjustForContrast } from "../contrast";
import { AA_NORMAL_TEXT_RATIO } from "../resolver";
import { populatedTheme } from "../../test/fixtures/populated-theme";
import type { ComponentTokenRecord } from "../types";

const INTER = { name: "Inter", fontFamily: '"Inter", sans-serif' };

function withToken(
  name: string,
  overrides: Partial<ComponentTokenRecord>,
): ComponentTokenRecord[] {
  return populatedTheme().map((t) => (t.name === name ? { ...t, ...overrides } : t));
}

describe("diffResolvedThemes", () => {
  it("reports nothing for a theme against itself", () => {
    expect(diffResolvedThemes({ tokens: populatedTheme() }, { tokens: populatedTheme() })).toEqual(
      [],
    );
  });

  it("names the property that moved, and both values", () => {
    const after = withToken("boxMain", { bgLight: "#123456" });
    const differences = diffResolvedThemes({ tokens: populatedTheme() }, { tokens: after });
    const bg = differences.find((d) => d.property === "--hopper-box-main-bg");

    expect(bg?.colorMode).toBe("light");
    expect(bg?.after).toBe("#123456");

    // Moving a background moves the TEXT too, and that is correct rather than
    // noise: the resolver holds every text/background pair to the AA floor, so
    // a new surface re-adjusts the text sitting on it. It is also the clearest
    // argument for diffing resolved properties instead of records — the stored
    // text colour did not change, and what renders did.
    expect(differences.map((d) => d.property).sort()).toEqual([
      "--hopper-box-main-bg",
      "--hopper-box-main-text",
    ]);
  });

  it("compares BOTH colour modes", () => {
    // A theme is two palettes. A light-only comparison passes happily on a
    // theme whose dark half was never updated, which is exactly the state a
    // half-finished push leaves behind.
    const after = withToken("boxMain", { bgDark: "#010203" });
    const differences = diffResolvedThemes({ tokens: populatedTheme() }, { tokens: after });

    expect(differences.length).toBeGreaterThan(0);
    expect(differences.every((d) => d.colorMode === "dark")).toBe(true);
    expect(differences.some((d) => d.property === "--hopper-box-main-bg")).toBe(true);
  });

  it("sees a slot that appears, not just one that changes value", () => {
    // A "transparent" slot emits NO property, so this token goes from absent to
    // present. Iterating only the first theme's keys would miss it entirely and
    // report a theme that gained a visible surface as unchanged.
    const before = withToken("boxMain", { borderLight: "transparent" });
    const after = withToken("boxMain", { borderLight: "#445566" });

    const differences = diffResolvedThemes({ tokens: before }, { tokens: after });
    const appeared = differences.find((d) => d.property === "--hopper-box-main-border");

    expect(appeared?.before).toBeUndefined();
    expect(appeared?.after).toBe("#445566");
  });

  it("sees a slot that disappears", () => {
    const before = withToken("boxMain", { borderLight: "#445566" });
    const after = withToken("boxMain", { borderLight: "transparent" });

    const differences = diffResolvedThemes({ tokens: before }, { tokens: after });
    const gone = differences.find((d) => d.property === "--hopper-box-main-border");

    expect(gone?.before).toBe("#445566");
    expect(gone?.after).toBeUndefined();
  });

  it("compares what paints, not what is stored", () => {
    // The resolver holds text/background pairs to the AA floor, so a STORED
    // text colour and the one that PAINTS can differ. Storing the floor's own
    // answer therefore changes the record without moving a single pixel, and a
    // record-level diff would call that a change and make every push look
    // dirty.
    //
    // This used to be written as two arbitrary near-identical greys (`#8a8a8a`
    // and `#8c8c8c`) that "both resolve the same". They only did so because the
    // wrong-direction search collapsed BOTH to `#ffffff` (NEH-898) — the test
    // was resting on the defect, not on the resolver. Deriving the second value
    // from the floor itself is the invariant it meant to assert, and it cannot
    // rot the same way.
    const bg = "#888888";
    const stored = "#8a8a8a";
    const painted = adjustForContrast(stored, bg, AA_NORMAL_TEXT_RATIO);
    // Non-vacuity: if the floor stopped adjusting, the two themes below would
    // be identical and this test would pass while proving nothing.
    expect(painted).not.toBe(stored);

    const before = withToken("boxMain", { bgLight: bg, textLight: stored });
    const after = withToken("boxMain", { bgLight: bg, textLight: painted });

    const textDifferences = diffResolvedThemes({ tokens: before }, { tokens: after }).filter(
      (d) => d.property === "--hopper-box-main-text",
    );

    expect(textDifferences).toEqual([]);
  });

  it("honours a custom prefix on both sides", () => {
    const after = withToken("boxMain", { bgLight: "#123456" });
    const differences = diffResolvedThemes(
      { tokens: populatedTheme() },
      { tokens: after },
      "optima",
    );

    expect(differences[0]?.property).toBe("--optima-box-main-bg");
  });

  it("diffs fonts, without claiming a colour mode for them", () => {
    // Fonts do not vary by mode, so reporting one would imply a distinction
    // that does not exist — and would report every font change twice.
    const differences = diffResolvedThemes(
      { tokens: populatedTheme() },
      { tokens: populatedTheme(), fonts: { fonts: { body: INTER } } },
    );

    expect(differences).toHaveLength(1);
    expect(differences[0]?.property).toBe("--hopper-font-family-body");
    expect(differences[0]?.colorMode).toBeNull();
  });
});

describe("themesResolveIdentically", () => {
  it("is true for equal themes and false for a single moved colour", () => {
    expect(
      themesResolveIdentically({ tokens: populatedTheme() }, { tokens: populatedTheme() }),
    ).toBe(true);
    expect(
      themesResolveIdentically(
        { tokens: populatedTheme() },
        { tokens: withToken("boxMain", { bgLight: "#123456" }) },
      ),
    ).toBe(false);
  });
});
