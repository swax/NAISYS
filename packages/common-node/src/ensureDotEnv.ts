import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

/**
 * Checks for a .env file in the current working directory.
 * If missing, prints the .env.example contents and offers to copy it.
 * Exits the process so the user can review settings before starting.
 */
export async function ensureDotEnv(exampleUrl: URL): Promise<void> {
  const dotenvPath = path.resolve(".env");

  if (fs.existsSync(dotenvPath)) {
    return;
  }

  const examplePath = fileURLToPath(exampleUrl);
  const hasExample = fs.existsSync(examplePath);

  console.log(`\n  .env file not found at: ${dotenvPath}`);

  if (hasExample && process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        `\n  Create .env from ${examplePath}? (y/N) `,
        resolve,
      );
    });
    rl.close();

    if (answer.toLowerCase().startsWith("y")) {
      fs.copyFileSync(examplePath, dotenvPath);
      console.log(`\n  Created: ${dotenvPath}`);
      console.log(`  Edit the file (especially NAISYS_FOLDER which controls where data is stored) and restart.\n`);
      process.exit(0);
    }
  }

  console.log(`\n  Please create a .env file to configure the application.`);
  if (hasExample) {
    console.log(`  See: ${examplePath}`);
  }
  console.log();
  process.exit(1);
}
