import {
  JsonThemeError,
  parseJsonTheme,
  validateJsonTheme,
  type JsonTheme,
} from "../json-theme";
import { resolveTokensToCssVars } from "../resolver";

const minimal: JsonTheme = {
  name: "Test",
  tokens: {
    boxPrimary: {
      bg: { light: "#1e293b", dark: "#0f172a" },
      text: { light: "#f8fafc", dark: "#e2e8f0" },
    },
  },
};

describe("the JSON theme format", () => {
  describe("validation", () => {
    it("accepts a well-formed theme", () => {
      expect(validateJsonTheme(minimal)).toEqual([]);
    });

    it("reports every problem at once, not just the first", () => {
      // A theme file is authored by hand. Fixing eight typos one failed build
      // at a time is eight builds.
      const problems = validateJsonTheme({
        name: "",
        tokens: {
          boxPrimary: { bg: { light: "not-a-colour", dark: "#000" } },
          nonsenseToken: { bg: { light: "#fff", dark: "#000" } },
        },
      });
      expect(problems.length).toBeGreaterThanOrEqual(3);
      expect(problems.join("\n")).toContain("`name`");
      expect(problems.join("\n")).toContain("not-a-colour");
      expect(problems.join("\n")).toContain("nonsenseToken");
    });

    it("rejects a token name the registry does not know", () => {
      // The defect this exists for: a typo'd token name is invisible. The
      // property it should have defined never appears, and the component paints
      // nothing — no error anywhere.
      const problems = validateJsonTheme({
        name: "T",
        tokens: { boxPrimry: { bg: { light: "#fff", dark: "#000" } } },
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("boxPrimry");
    });

    it("requires both modes whenever a slot is present", () => {
      // A slot with only `light` renders nothing in dark mode, silently.
      const problems = validateJsonTheme({
        name: "T",
        tokens: { boxPrimary: { bg: { light: "#fff" } } },
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("dark");
    });

    it("accepts the hex forms a designer actually pastes, plus transparent", () => {
      for (const colour of ["#fff", "#ffffff", "#ffffff80", "transparent"]) {
        expect(
          validateJsonTheme({
            name: "T",
            tokens: { boxPrimary: { bg: { light: colour, dark: colour } } },
          }),
        ).toEqual([]);
      }
    });

    it("rejects a non-object", () => {
      expect(validateJsonTheme(null)).toEqual(["theme must be an object"]);
      expect(validateJsonTheme("#fff")).toEqual(["theme must be an object"]);
    });
  });

  describe("parsing", () => {
    it("throws with every problem listed", () => {
      expect(() => parseJsonTheme({ name: "", tokens: {} })).toThrow(JsonThemeError);
      try {
        parseJsonTheme({ name: "", tokens: {} });
      } catch (error) {
        expect((error as JsonThemeError).problems.length).toBeGreaterThan(0);
        // The message carries them too — a thrown error is usually read in a
        // log, not destructured.
        expect((error as Error).message).toContain("`name`");
      }
    });

    it("returns a record for every registered token, not only the named ones", () => {
      // The resolver skips "transparent" slots, so an omitted token should
      // render as nothing deliberately rather than break the lookup.
      const records = parseJsonTheme(minimal);
      expect(records.length).toBeGreaterThan(1);
      expect(records.some((r) => r.name === "boxPrimary")).toBe(true);
    });

    it("carries both modes through to the record", () => {
      const record = parseJsonTheme(minimal).find((r) => r.name === "boxPrimary");
      expect(record).toMatchObject({
        bgLight: "#1e293b",
        bgDark: "#0f172a",
        textLight: "#f8fafc",
        textDark: "#e2e8f0",
      });
    });

    it("leaves a slot the file omits untouched", () => {
      // `minimal` sets no border. It must stay the registry default rather than
      // becoming undefined, which would resolve to the string "undefined".
      const record = parseJsonTheme(minimal).find((r) => r.name === "boxPrimary");
      expect(record?.borderLight).toBe("transparent");
      expect(record?.borderDark).toBe("transparent");
    });

    it("makes an explicitly transparent slot a real value (NEH-267)", () => {
      // Written literally, "transparent" is the resolver's sentinel for UNSET —
      // deliberately, so an unspoken slot leaves the var() palette fallback
      // chain intact. But it is also a colour an author legitimately means: a
      // plain button's background is transparent, and that is what makes it
      // plain.
      //
      // Before this, writing the obvious thing produced NO property, failed the
      // contract check, and gave no clue why. It cost a real debugging session
      // on RozCards' theme.
      const records = parseJsonTheme({
        name: "T",
        tokens: { buttonPlain: { bg: { light: "transparent", dark: "transparent" } } },
      });
      const plain = records.find((r) => r.name === "buttonPlain");
      expect(plain?.bgLight).toBe("#00000000");

      // The point of the translation: it actually emits now.
      const vars = resolveTokensToCssVars(records, "light");
      expect(vars["--hopper-button-plain-bg"]).toBe("#00000000");
    });

    it("lets a host declare the status surfaces, and emits all six properties (NEH-609)", () => {
      // The defect this closes: `validateJsonTheme` rejects any key the
      // registry does not know, so a theme naming `boxSuccess` failed with
      // `unknown token` — which made style's documented "define
      // --<prefix>-box-{success,warning,error}-{bg,border} to use your own"
      // contract unreachable through the theme layer. It was reachable only by
      // writing the custom property in raw CSS, going around this package.
      //
      // A brand whose danger colour is not red is the case that needs it.
      const theme: JsonTheme = {
        name: "Brand",
        tokens: {
          boxSuccess: {
            bg: { light: "#e6f4ea", dark: "#12291a" },
            border: { light: "#137333", dark: "#5bb974" },
          },
          boxWarning: {
            bg: { light: "#fef7e0", dark: "#2d2412" },
            border: { light: "#b06000", dark: "#fdd663" },
          },
          boxError: {
            bg: { light: "#fce8e6", dark: "#2d1614" },
            border: { light: "#a50e0e", dark: "#f28b82" },
          },
        },
      };

      expect(validateJsonTheme(theme)).toEqual([]);

      const vars = resolveTokensToCssVars(parseJsonTheme(theme), "light");
      expect(vars).toMatchObject({
        "--hopper-box-success-bg": "#e6f4ea",
        "--hopper-box-success-border": "#137333",
        "--hopper-box-warning-bg": "#fef7e0",
        "--hopper-box-warning-border": "#b06000",
        "--hopper-box-error-bg": "#fce8e6",
        "--hopper-box-error-border": "#a50e0e",
      });

      // Both modes, because an alert is painted in both and the dark values are
      // the ones a host is most likely to get wrong by omission.
      const dark = resolveTokensToCssVars(parseJsonTheme(theme), "dark");
      expect(dark["--hopper-box-error-bg"]).toBe("#2d1614");
      expect(dark["--hopper-box-error-border"]).toBe("#f28b82");
    });

    it("derives NO status colour for a theme that stays silent (NEH-609)", () => {
      // The other half, and the reason these three groups alone carry no
      // `defaultPaletteRef`. Style already ships good hue-fixed defaults for
      // these six. Deriving them from `accent` — the shrug the text meaning
      // tokens take — would paint all three chips from ONE colour and lose the
      // distinction they exist to draw, which is worse than deriving nothing.
      //
      // So registering them must NOT start emitting them. A host that says
      // nothing has to keep falling through to style's defaults.
      const vars = resolveTokensToCssVars(
        parseJsonTheme({ name: "Silent", tokens: {} }),
        "light",
      );
      for (const status of ["success", "warning", "error"]) {
        expect(vars[`--hopper-box-${status}-bg`]).toBeUndefined();
        expect(vars[`--hopper-box-${status}-border`]).toBeUndefined();
      }
    });

    it("still leaves a slot the file never mentions unset", () => {
      // The other half. If the translation also applied to defaults, every
      // unspoken slot would start emitting and override the palette fallback
      // chain — which is the thing the sentinel exists to protect.
      const vars = resolveTokensToCssVars(
        parseJsonTheme({ name: "T", tokens: {} }),
        "light",
      );
      expect(Object.keys(vars)).toHaveLength(0);
    });

    it("feeds the same resolver the database path uses", () => {
      // The whole point of ComponentTokenRecord being the seam.
      const light = resolveTokensToCssVars(parseJsonTheme(minimal), "light");
      const dark = resolveTokensToCssVars(parseJsonTheme(minimal), "dark");
      expect(light["--hopper-box-primary-bg"]).toBe("#1e293b");
      expect(dark["--hopper-box-primary-bg"]).toBe("#0f172a");
    });
  });
});
