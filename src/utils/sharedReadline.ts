import * as readline from "readline";

/**
 * Singleton readline interface shared across all agent instances.
 * This prevents conflicts when multiple agents are running but only one is active on the console.
 */
class SharedReadline {
  private static instance: readline.Interface | null = null;

  static getInstance(): readline.Interface {
    if (!SharedReadline.instance) {
      SharedReadline.instance = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        // With this set to true, after an abort the second input will not be processed, see:
        // https://gist.github.com/swax/964a2488494048c8e03d05493d9370f8
        // With this set to false, the stdout.write event above will not be triggered
        terminal: true,
      });
      SharedReadline.instance.pause();
    }
    return SharedReadline.instance;
  }
}

export const sharedReadline = SharedReadline.getInstance();
