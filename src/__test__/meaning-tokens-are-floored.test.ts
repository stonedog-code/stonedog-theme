import { COMPONENT_TOKEN_GROUPS, LEGACY_TO_TOKEN_MAP } from "../token-registry";
import { RECIPE_CONTRAST_PAIRS, semanticTokenToCssVar } from "../recipe-contrast-map";

/**
 * Every token that paints text but owns no surface must be paired against one,
 * or the contrast floor cannot see it (NEH-631).
 *
 * ## The defect
 *
 * A "meaning" token — `textError`, `textWarning`, `textPop`, `textSuccess` —
 * has `activeSlots: ["text"]` and therefore NO background of its own. The
 * resolver's own pairing walk compares `group.text` against `group.bg`, and for
 * these groups `<prefix>-text-*-bg` does not exist, so nothing is compared.
 *
 * `RECIPE_CONTRAST_PAIRS` is the ONLY thing that tells the floor which surface
 * such a token lands on. Miss the entry and the token still receives a palette
 * fallback — it simply never gets checked.
 *
 * `textSuccess` shipped exactly that way. hopper-theme, which shares this registry shape,
 * shipped it that way: `textSuccess` resolved to `#FECDD3` on a `#f5f5f5`
 * surface — **1.29:1** — against three floored siblings at 19.26:1.
 *
 * ## Why this is worse than the bug it replaced
 *
 * Before, the property was ABSENT, which the fallback-free contract makes loud
 * on purpose. Present-but-illegible is the NEH-278 defect: it renders, it looks
 * deliberate, and only a measurement disagrees. Fixing "missing" by supplying a
 * value without supplying the floor traded a loud failure for a silent one.
 *
 * ## Why a floor, rather than "choose a better default"
 *
 * The value comes from the HOST's palette, which this package never sees. Any
 * default is a guess about someone else's brand, and the floor is what makes a
 * guess safe. So this asserts not that the colour is right, but that the colour
 * is subject to review at all.
 */
describe("every text-only token is reachable by the contrast floor", () => {
  const textOnly = COMPONENT_TOKEN_GROUPS.filter(
    (g) => g.activeSlots.length === 1 && g.activeSlots[0] === "text",
  );

  /**
   * Logo wordmarks are exempt, and the exemption is WCAG's own: SC 1.4.3 places
   * no contrast requirement on "text that is part of a logo or brand name".
   * Flooring one would override the brand's chosen colour — the precise thing
   * the logotype exemption exists to permit.
   *
   * Note this reads `category` from the REGISTRY rather than listing keys here.
   * That matters: a hand-kept list in a test file is the `KNOWN_DEAD` shape
   * NEH-301 deleted, where the next unfloored token earns an entry instead of a
   * fix. Keyed on declared data, a new `title` token is exempt because someone
   * declared it a wordmark, and a new `text` token cannot become exempt without
   * changing what it claims to be.
   */
  const EXEMPT_CATEGORY = "title";

  it("finds groups and pairs on both sides, so this cannot pass vacuously", () => {
    expect(textOnly.length).toBeGreaterThan(4);
    expect(textOnly.filter((g) => g.category !== EXEMPT_CATEGORY).length).toBeGreaterThan(2);
    expect(RECIPE_CONTRAST_PAIRS.length).toBeGreaterThan(10);
  });

  it("pairs every non-wordmark one of them against a surface", () => {
    // A pair names LEGACY variable names, not registry keys — they are resolved
    // through LEGACY_TO_TOKEN_MAP. For the text groups the two spellings happen
    // to coincide, so comparing keys directly would pass by luck and break the
    // day one of them diverges. Go through the group's declared legacy name.
    const paired = new Set(RECIPE_CONTRAST_PAIRS.map((p) => p.fgToken));
    const unfloored = textOnly
      .filter((g) => g.category !== EXEMPT_CATEGORY)
      .filter((g) => {
        const legacy = g.legacyVariables.text;
        return !legacy || !paired.has(legacy);
      })
      .map((g) => g.key);

    // Named, not counted — the name IS the fix, and the whole failure was that
    // nobody could tell which token had slipped past the floor.
    expect(unfloored).toEqual([]);
  });

  it("pairs each against a token that actually paints a surface", () => {
    // Both halves have to resolve, and the background half has to be a real
    // background. A pair naming a token nothing defines, or measuring one text
    // colour against another, satisfies the check above while measuring
    // nothing — the same shape of hole as the missing entry itself.
    const meaningLegacy = new Set(
      textOnly
        .filter((g) => g.category !== EXEMPT_CATEGORY)
        .map((g) => g.legacyVariables.text)
        .filter(Boolean),
    );
    const bad: string[] = [];
    for (const pair of RECIPE_CONTRAST_PAIRS) {
      if (!meaningLegacy.has(pair.fgToken)) continue;
      if (!semanticTokenToCssVar(pair.fgToken)) {
        bad.push(`${pair.fgToken} resolves to no CSS variable`);
        continue;
      }
      const bg = LEGACY_TO_TOKEN_MAP[pair.bgToken];
      if (!bg) {
        bad.push(`${pair.fgToken} paired with ${pair.bgToken}, which resolves to nothing`);
        continue;
      }
      if (bg.slot !== "bg") {
        bad.push(
          `${pair.fgToken} paired with ${pair.bgToken}, whose slot is ${bg.slot}, not a surface`,
        );
      }
    }

    expect(bad).toEqual([]);
  });

  it("resolves the pair added for textSuccess to the variables production reads", () => {
    // Named, because the sweep above would stay green if this entry were
    // deleted and textSuccess recategorised. Production served #FECDD3 at
    // 1.29:1 for want of exactly this row.
    const pair = RECIPE_CONTRAST_PAIRS.find((p) => p.fgToken === "textSuccess");
    expect(pair).toBeDefined();
    // Asserted through the same resolver the product uses rather than against
    // a literal var name, because this package's prefix is configurable and a
    // hardcoded `--stonedog-*` would pin a detail the test does not care about.
    const fg = semanticTokenToCssVar("textSuccess");
    const bg = semanticTokenToCssVar(pair!.bgToken);
    expect(fg).toMatch(/text-success-text$/);
    expect(bg).toMatch(/box-main-bg$/);
  });

  it("keeps the wordmark exemption honest — it covers logos and nothing else", () => {
    // If a meaning token were ever recategorised to slip the check above, this
    // is what notices. `text` is where meaning lives; `title` is the wordmark.
    for (const key of ["textPop", "textError", "textWarning", "textSuccess"]) {
      const group = COMPONENT_TOKEN_GROUPS.find((g) => g.key === key);
      expect(group?.category).toBe("text");
    }
    const exempt = textOnly.filter((g) => g.category === EXEMPT_CATEGORY).map((g) => g.key);
    expect(exempt).toEqual(["titlePrimary", "titleSecondary", "titleAccent"]);
  });
});
