import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import aliasMatchFilename from "./eslint-rules/alias-match-filename.js";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "custom-rules": {
        rules: {
          "alias-match-filename": aliasMatchFilename,
        },
      },
    },
    rules: {
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "custom-rules/alias-match-filename": "error",
    },
  },
];
