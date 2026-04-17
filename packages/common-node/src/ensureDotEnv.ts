import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { expandNaisysFolder } from "./expandEnv.js";
import {
  askQuestion,
  runSetupWizard,
  type WizardConfig,
} from "./setupWizard.js";

/**
 * Checks for a .env file in the current working directory.
 * If missing and a wizardConfig is provided, offers to run the setup wizard.
 * Otherwise prints the .env.example contents and offers to copy it.
 * Exits the process so the user can review settings before starting.
 */
export async function ensureDotEnv(
  exampleUrl: URL,
  wizardConfig?: WizardConfig,
): Promise<boolean> {
  const dotenvPath = path.resolve(".env");

  if (fs.existsSync(dotenvPath)) {
    return false;
  }

  const examplePath = fileURLToPath(exampleUrl);
  const hasExample = fs.existsSync(examplePath);

  console.log(`\n  .env file not found at: ${dotenvPath}`);

  if (process.stdin.isTTY) {
    // Offer setup wizard if config is provided
    if (wizardConfig) {
      const answer = await askQuestion(
        "  Would you like to run the setup wizard? (Y/n) ",
      );

      if (!answer || answer.toLowerCase().startsWith("y")) {
        await runSetupWizard(dotenvPath, exampleUrl, wizardConfig);
        expandNaisysFolder();
        return true;
      }
    }

    // Fall back to copying the example file
    if (hasExample) {
      const answer = await askQuestion(
        `  Create .env from ${examplePath}? (y/N) `,
      );

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
