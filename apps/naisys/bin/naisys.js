#!/usr/bin/env node

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = join(__dirname, "..", "dist", "naisys.js");

// If no arguments, show help and exit
if (process.argv.length <= 2) {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
  );
  console.log("NAISYS: Networked Agents Interface System");
  console.log(`  Version: ${pkg.version}`);
  console.log("  Usage: naisys <path to agent yaml or directory> [options]");
  console.log("  Options:");
  console.log("    --integrated-hub    Start Hub in the same process");
  console.log(
    "    --supervisor        Start Supervisor web UI (requires --integrated-hub)",
  );
  console.log(
    "    --erp               Start ERP web app (requires --supervisor)",
  );
  console.log("    --hub <url>         Connect to a remote Hub server");
  console.log("");
  console.log("  Pass a directory to run all agent yamls in that folder.");
  process.exit(1);
}

// Import and run the main entry point
await import(pathToFileURL(distEntry).href);
