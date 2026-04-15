import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

import { runSetupWizard, type WizardConfig } from "./setupWizard.js";

/**
 * Checks for a .env file in the current working directory.
 * If missing and a wizardConfig is provided, offers to run the setup wizard.
 * Otherwise prints the .env.example contents and offers to copy it.
 * Exits the process so the user can review settings before starting.
 */
export async function ensureDotEnv(
  exampleUrl: URL,
  wizardConfig?: WizardConfig,
): Promise<void> {
  const dotenvPath = path.resolve(".env");

  if (fs.existsSync(dotenvPath)) {
    return;
  }

  const examplePath = fileURLToPath(exampleUrl);
  const hasExample = fs.existsSync(examplePath);

  console.log(`\n  .env file not found at: ${dotenvPath}`);

  if (process.stdin.isTTY) {
    // Offer setup wizard if config is provided
    if (wizardConfig) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.on("SIGINT", () => {
        rl.close();
        console.log("\n");
        process.exit(0);
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          "  Would you like to run the setup wizard? (Y/n) ",
          resolve,
        );
      });
      rl.close();

      if (!answer || answer.toLowerCase().startsWith("y")) {
        await runSetupWizard(dotenvPath, exampleUrl, wizardConfig);
        process.exit(0);
      }
    }

    // Fall back to copying the example file
    if (hasExample) {
      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl2.on("SIGINT", () => {
        rl2.close();
        console.log("\n");
        process.exit(0);
      });

      const answer = await new Promise<string>((resolve) => {
        rl2.question(`  Create .env from ${examplePath}? (y/N) `, resolve);
      });
      rl2.close();

      if (answer.toLowerCase().startsWith("y")) {
        fs.copyFileSync(examplePath, dotenvPath);
        console.log(`  Created: ${dotenvPath}`);
        console.log(
          `  Edit the file (especially NAISYS_FOLDER which controls where data is stored) and restart.`,
        );
        process.exit(0);
      }
    }
  }

  console.log(`  Please create a .env file to configure the application.`);
  if (hasExample) {
    console.log(`  See: ${examplePath}`);
  }
  process.exit(1);
}
