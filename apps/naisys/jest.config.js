/** @type {import('jest').Config} */
export default {
  // Only run .test.js files
  testMatch: ["**/*.test.js"],
  // Ignore TypeScript declaration files
  modulePathIgnorePatterns: ["\\.d\\.ts$"],
  // Use ESM
  testEnvironment: "node",
  // Increase timeout for database operations
  testTimeout: 30000,
};
