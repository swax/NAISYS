/**
 * Utility for listening to ESC key presses during async operations.
 * Uses raw mode stdin to capture key events without requiring Enter.
 */

const ESC_KEY = "\x1b";

export interface EscKeyListener {
  /** Start listening for ESC key. Returns cleanup function. */
  start(onEsc: () => void): () => void;
}

export function createEscKeyListener(): EscKeyListener {
  function start(onEsc: () => void): () => void {
    // Store original raw mode state
    const wasRaw = process.stdin.isRaw;

    // Handler for keypress data
    const onData = (data: Buffer) => {
      const key = data.toString();
      if (key === ESC_KEY) {
        onEsc();
      }
    };

    // Enable raw mode to get individual keystrokes
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onData);
    }

    // Return cleanup function
    return () => {
      if (process.stdin.isTTY) {
        process.stdin.off("data", onData);
        // Restore original raw mode state
        if (!wasRaw) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      }
    };
  }

  return {
    start,
  };
}
