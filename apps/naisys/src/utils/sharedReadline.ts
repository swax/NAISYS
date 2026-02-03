import * as readline from "readline";

/**
 * Singleton readline interface shared across all agent instances.
 * This prevents conflicts when multiple agents are running but only one is active on the console.
 *
 * Lazily initialized to avoid setting stdin to raw mode at import time,
 * which would prevent Ctrl+C from working during startup (e.g. hub connection).
 */
let instance: readline.Interface | null = null;

export function getSharedReadline(): readline.Interface {
  if (!instance) {
    instance = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      // With this set to true, after an abort the second input will not be processed, see:
      // https://gist.github.com/swax/964a2488494048c8e03d05493d9370f8
      // With this set to false, the stdout.write event above will not be triggered
      terminal: true,
    });
    instance.pause();
  }
  return instance;
}
