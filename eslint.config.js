import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import aliasMatchFilename from "./eslint-rules/alias-match-filename.js";
import requireJsExtension from "./eslint-rules/require-js-extension.js";

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
    files: [
      "apps/*/src/**/*.{ts,tsx}",
      "apps/*/*/src/**/*.{ts,tsx}",
      "packages/*/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "simple-import-sort": simpleImportSort,
      "unused-imports": unusedImports,
      "custom-rules": {
        rules: {
          "alias-match-filename": aliasMatchFilename,
          "require-js-extension": requireJsExtension,
        },
      },
    },
    rules: {
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "unused-imports/no-unused-imports": "error",
      "custom-rules/alias-match-filename": "error",
      "custom-rules/require-js-extension": "error",
    },
  },
  // Client apps use bundler resolution (Vite) which doesn't need .js extensions
  {
    files: ["apps/*/client/src/**/*.ts", "apps/*/client/src/**/*.tsx"],
    rules: {
      "custom-rules/require-js-extension": "off",
    },
  },
];
