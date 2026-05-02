// Thin entry-point dispatcher. When this process is the wrapper-eligible
// outer parent (hub mode, auto-update on, not under PM2, not already a
// child), spawn a fresh Node child running this same script and loop on
// exit code 75 so auto-update can request a clean restart. Otherwise drop
// straight into the app.
//
// Heavy imports live in ./naisysMain.js — they're loaded lazily *only*
// after the wrapper decision. That keeps the parent process's RSS at the
// Node baseline (~25–30 MB) instead of also pulling the full app
// (commander, hub client, agent manager, etc.) into the supervisor process,
// which is what doubled NAISYS's memory footprint in earlier versions.
import dotenv from "dotenv";

import {
  runWithRestartWrapper,
  shouldUseRestartWrapper,
} from "./services/restartManager.js";

// Load .env before the wrapper guard so users can set NAISYS_* knobs
// (notably NAISYS_DISABLE_RESTART_WRAPPER) in .env rather than having to
// export them from the shell. The spawned wrapper child inherits the
// resolved process.env, so naisysMain.ts doesn't need to reload dotenv.
dotenv.config({ quiet: true });

if (shouldUseRestartWrapper()) {
  process.exit(await runWithRestartWrapper());
}

await import("./naisysMain.js");
