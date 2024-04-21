module.exports = {
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist/"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  root: true,
  rules: {
    "alias-match-filename": "error",
    //"module-local-underscore": "error",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/no-floating-promises": "error",
  },
};
