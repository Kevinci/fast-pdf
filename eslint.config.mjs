import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "docs/demo.tw.css"],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },

    rules: {
      /**
       * PDF-Code darf Binary-RegEx enthalten
       * z.B. \x00
       */
      "no-control-regex": "off",

      /**
       * Variablenprüfung
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      /**
       * any erlauben, aber melden
       */
      "@typescript-eslint/no-explicit-any": "warn",

      /**
       * Standard JS Regeln
       */
      "prefer-const": "error",
      "no-var": "error",
      "object-shorthand": "error",
    },
  },

  /**
   * Library Code
   */
  {
    files: ["src/**/*.{ts,js}"],

    rules: {
      "no-console": "warn",
      "no-debugger": "error",
    },
  },

  /**
   * Tools / Beispiele dürfen console benutzen
   */
  {
    files: ["examples/**/*", "scripts/**/*", "bench/**/*", "docs/**/*", "tests/**/*"],

    rules: {
      "no-console": "off",
    },
  },

  /**
   * Prettier überschreibt Stilregeln
   */
  eslintConfigPrettier,
);
