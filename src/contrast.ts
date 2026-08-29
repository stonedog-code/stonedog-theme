/**
 * WCAG Contrast Utilities (consolidated from apps/web/lib/contrast.ts
 * and apps/web/lib/utils/contrast.ts).
 *
 * @see https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
 */

import type { ContrastResult, ContrastPairResult, RgbColor } from "./types";
import { hexToRgb, rgbToHex, getLuminance } from "./color-math";

/**
 * The hex ⇄ rgb primitives and the luminance formula now live in
 * `color-math.ts`, shared with `extraction.ts` (NEH-285). They are re-exported
 * here unchanged: this module has been their public home since the package was
 * extracted, and callers should not have to know where the arithmetic moved.
 */
export { hexToRgb, rgbToHex, getLuminance };

/**
 * Calculate contrast ratio between two hex colors.
 * Returns a value between 1 and 21.
 */
export function getContrastRatio(color1: string, color2: string): number {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Get WCAG compliance level for a given contrast ratio.
 */
export function getWCAGLevel(
  ratio: number,
  isLargeText: boolean = false,
): "AAA" | "AA" | "Fail" {
  const aaaThreshold = isLargeText ? 4.5 : 7;
  const aaThreshold = isLargeText ? 3 : 4.5;

  if (ratio >= aaaThreshold) return "AAA";
  if (ratio >= aaThreshold) return "AA";
  return "Fail";
}

/**
 * Comprehensive contrast analysis for a foreground/background pair.
 */
export function analyzeContrast(
  foreground: string,
  background: string,
): ContrastResult {
  const ratio = getContrastRatio(foreground, background);

  return {
    ratio,
    level: getWCAGLevel(ratio, false),
    largeTextLevel: getWCAGLevel(ratio, true),
    passes: {
      aaaLargeText: ratio >= 4.5,
      aaaNormalText: ratio >= 7,
      aaLargeText: ratio >= 3,
      aaNormalText: ratio >= 4.5,
    },
  };
}

/**
 * Find the closest shade in a palette that meets AAA contrast
 * against a given background color.
 */
export function findAAACompliantShade(
  backgroundColor: string,
  palette: Array<{ shade: string | number; hexValue: string }>,
  isLargeText: boolean = false,
): { shade: string | number; hexValue: string } | null {
  const aaaThreshold = isLargeText ? 4.5 : 7;

  const compliantShades = palette
    .map((shade) => ({
      shade,
      ratio: getContrastRatio(backgroundColor, shade.hexValue),
    }))
    .filter((item) => item.ratio >= aaaThreshold)
    .sort((a, b) => a.ratio - b.ratio);

  const closest = compliantShades[0];
  return closest ? closest.shade : null;
}

/**
 * Suggest a contrast fix by finding the best compliant shade.
 */
export function suggestContrastFix(
  foreground: string,
  background: string,
  palette: Array<{ shade: string | number; hexValue: string }>,
): { shade: { shade: string | number; hexValue: string }; direction: "lighter" | "darker" } | null {
  const fgLuminance = getLuminance(foreground);
  const aaaThreshold = 7;

  const compliantShades = palette
    .map((shade) => ({
      shade,
      ratio: getContrastRatio(background, shade.hexValue),
      luminance: getLuminance(shade.hexValue),
    }))
    .filter((item) => item.ratio >= aaaThreshold);

  compliantShades.sort(
    (a, b) =>
      Math.abs(a.luminance - fgLuminance) - Math.abs(b.luminance - fgLuminance),
  );

  // One guard instead of a length check plus an unchecked [0]: an empty
  // palette and a palette with nothing compliant are the same answer.
  const best = compliantShades[0];
  if (!best) return null;

  const direction: "lighter" | "darker" =
    best.luminance > fgLuminance ? "lighter" : "darker";

  return { shade: best.shade, direction };
}

/**
 * The relative luminance at which black and white are equally legible against a
 * surface — solve `(L + 0.05) / 0.05 === 1.05 / (L + 0.05)` for L.
 *
 * ≈ **0.1791**, and it is the pivot `adjustForContrast` used to get wrong
 * (NEH-898). Exported because two consumers had already re-derived the literal
 * `0.179` by hand; a number this easy to mistype for `0.5` should have exactly
 * one definition, and this package owns the arithmetic it comes from.
 */
export const CONTRAST_CROSSOVER_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;

/** How far each channel moves per step of the search. */
const ADJUST_STEP = 5;

/**
 * 52 steps of 5 spans the full 0–255 range, so both walks always terminate at
 * their endpoint (`#000000` / `#ffffff`) rather than relying on the target
 * being reachable at all.
 */
const ADJUST_MAX_STEPS = 52;

function stepChannels(rgb: RgbColor, delta: number): RgbColor {
  return {
    r: Math.max(0, Math.min(255, rgb.r + delta)),
    g: Math.max(0, Math.min(255, rgb.g + delta)),
    b: Math.max(0, Math.min(255, rgb.b + delta)),
  };
}

/**
 * Adjust a foreground color to achieve a target contrast ratio against a
 * background, and **never return a pairing worse than the one handed in**.
 *
 * ## The defect this replaces (NEH-898)
 *
 * The direction used to come from one test, `bgLuminance < 0.5`. The crossover
 * where black and white are equally legible is at
 * `CONTRAST_CROSSOVER_LUMINANCE` ≈ 0.179, not 0.5 — so for any surface in the
 * band `0.179 ≤ L < 0.5` the search walked toward **white** when **black** was
 * the direction that gains contrast, ran out of room, and returned `#ffffff`.
 *
 * That is not merely a failure to reach the target. Against Bright's real
 * `buttonPrimary` background `#acb0b9` (L = 0.433), `#2b3038` starts at
 * **6.11:1** and the old function answered `#ffffff` at **2.17:1** — a pairing
 * already past AA "corrected" below AA, and the Theme Editor renders that
 * answer under the words "Suggested fix for AAA compliance" with an Apply
 * button next to it.
 *
 * ## The contract, stated deliberately
 *
 * A function asked to reach 7:1 that hands back 2.17:1 has failed whichever
 * direction it walked, so the fix is not only the pivot:
 *
 * - **It searches BOTH directions** rather than predicting one, and returns the
 *   first candidate to clear `targetRatio` — the smallest move that works, so
 *   the author's hue survives where it can. Comparing the two directly also
 *   means the crossover is never applied by hand, and cannot drift again.
 * - **It never lowers contrast.** If neither direction reaches the target it
 *   returns the highest-contrast candidate it saw, and if nothing beat the
 *   colour handed in — a foreground already at `#000000` or `#ffffff` — it
 *   returns that colour untouched. Returning something worse is the one answer
 *   this function must never give, because every caller treats the result as an
 *   improvement.
 *
 * A caller that needs "the most legible colour available" rather than "the
 * nearest colour that clears the bar" should ask for a target it cannot reach
 * (21), which now yields the endpoint honestly instead of by accident.
 */
export function adjustForContrast(
  foreground: string,
  background: string,
  targetRatio: number = 7,
): string {
  const bgRgb = hexToRgb(background);
  const fgRgb = hexToRgb(foreground);

  if (!bgRgb || !fgRgb) {
    return foreground;
  }

  const startingRatio = getContrastRatio(foreground, background);
  if (startingRatio >= targetRatio) {
    return foreground;
  }

  let darker = fgRgb;
  let lighter = fgRgb;
  let best = foreground;
  let bestRatio = startingRatio;

  for (let i = 0; i < ADJUST_MAX_STEPS; i++) {
    darker = stepChannels(darker, -ADJUST_STEP);
    lighter = stepChannels(lighter, ADJUST_STEP);

    const candidates = [rgbToHex(darker), rgbToHex(lighter)].map((hex) => ({
      hex,
      ratio: getContrastRatio(hex, background),
    }));

    // Both directions are examined on the same step, so whichever clears first
    // is the smaller move. A step where both clear is settled by contrast.
    const cleared = candidates
      .filter((c) => c.ratio >= targetRatio)
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (cleared) {
      return cleared.hex;
    }

    for (const candidate of candidates) {
      if (candidate.ratio > bestRatio) {
        bestRatio = candidate.ratio;
        best = candidate.hex;
      }
    }
  }

  // Unreachable target: the most legible colour found, which is one of the two
  // endpoints — or the original, when it was already an endpoint itself.
  return best;
}

/**
 * Validate contrast for a ComponentToken's bg/text pair in a given color mode.
 * Returns null if the token has no text slot (i.e. text is "transparent").
 */
export function validateComponentTokenContrast(
  bgColor: string,
  textColor: string,
): ContrastPairResult | null {
  if (bgColor === "transparent" || textColor === "transparent") {
    return null;
  }

  const ratio = getContrastRatio(bgColor, textColor);
  return {
    bg: bgColor,
    text: textColor,
    ratio,
    wcagLevel: getWCAGLevel(ratio),
  };
}

/**
 * Format contrast ratio for display (e.g. "7.2:1").
 */
export function formatContrastRatio(ratio: number): string {
  return `${ratio.toFixed(1)}:1`;
}
