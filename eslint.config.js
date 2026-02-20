import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
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
