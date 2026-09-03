import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/**
 * Flat config, migrated from `.eslintrc.cjs`.
 *
 * eslint 9 deprecated eslintrc and eslint 10 removes it, so this was a
 * migration rather than a version bump. Translated faithfully from the old
 * file rather than copied from a sibling — see the note on `__test__` below
 * for why that distinction was not academic.
 *
 * ## `env` has no flat-config equivalent
 *
 * The old config declared `env: { node: true, es2024: true, jest: true }`.
 * Flat config has no `env`; globals are declared explicitly.
 *
 * `node: true` is NOT carried over wholesale. The globals declared below are
 * the ones eslint itself reported as undefined — enumerated by the tool rather
 * than grepped for, after a hand-written pattern list missed `URL` and `fetch`
 * entirely and reported the source as using none.
 *
 * `URL` and `fetch` are WHATWG globals present in both browsers and modern
 * Node, used by `fetchPageStyles`. `console`, `process` and `__dirname` are
 * deliberately absent: every reference to those in this package is inside a
 * comment, and declaring a global the source does not use lets one appear
 * later without review — which matters because this package is imported into
 * browser bundles where `process` is not there to be used.
 */
export default [
  {
    // From the old `ignorePatterns`. `*.cjs` was there for the eslintrc file
    // itself, which no longer exists; kept because the build emits none and
    // removing it is a separate decision from this migration.
    ignores: ["dist/**", "node_modules/**", "coverage/**", "**/*.cjs"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: {
        // WHATWG, available in browsers and in Node >= 18. Used by
        // `fetchPageStyles` in extraction.ts and nowhere else.
        URL: "readonly",
        fetch: "readonly",
      },
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // `__test__`, SINGULAR. Sibling packages use `__tests__`, and copying that
    // glob here would match nothing — leaving 418 `expect` calls and 394 `it`
    // calls as no-undef errors, or worse, silently unlinted if the rule were
    // then relaxed to make it pass.
    files: ["src/__test__/**/*.ts"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly",
      },
    },
  },
];
