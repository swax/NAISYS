import aliasMatchFilename from "./eslint-rules/alias-match-filename.js";
import moduleLocalUnderscore from "./eslint-rules/module-local-underscore.js";

export default [
  {
    ignores: ["dist/**"],
  },
  {
    files: ["**/*.js", "**/*.ts"],
    languageOptions: {
      parser: (await import("@typescript-eslint/parser")).default,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": (await import("@typescript-eslint/eslint-plugin"))
        .default,
      "custom-rules": {
        rules: {
          "alias-match-filename": aliasMatchFilename,
          "module-local-underscore": moduleLocalUnderscore,
        },
      },
    },
    rules: {
      "custom-rules/alias-match-filename": "error",
      // 'custom-rules/module-local-underscore': 'error', // Commented out as it was in original config
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
];
