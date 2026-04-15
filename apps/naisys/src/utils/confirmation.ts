import chalk from "chalk";

import type { OutputService } from "./output.js";
import { getSharedReadline } from "./sharedReadline.js";

export interface ConfirmOptions {
  /** If true, empty answer and timeout resolve to true. Default: false */
  defaultAccept?: boolean;
  /** Timeout in seconds. If > 0, auto-resolves to defaultAccept on expiry */
  timeoutSeconds?: number;
}

/**
 * Prompt the operator for y/n confirmation.
 * When the console is not available, resolves to defaultAccept immediately.
 */
export function getConfirmation(
  output: OutputService,
  prompt: string,
  options?: ConfirmOptions,
): Promise<boolean> {
  const defaultAccept = options?.defaultAccept ?? false;
  const timeoutSeconds = options?.timeoutSeconds;

  return new Promise<boolean>((resolve) => {
    const rl = output.isConsoleEnabled() ? getSharedReadline() : null;

    if (!rl) {
      const reason = !output.isConsoleEnabled()
        ? "console disabled"
        : "no interactive terminal";
      output.comment(
        prompt + (defaultAccept ? "<auto-approved>" : `<denied: ${reason}>`),
      );
      resolve(defaultAccept);
      return;
    }
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;

    if (timeoutSeconds && timeoutSeconds > 0) {
      timeout = setTimeout(() => {
        controller.abort();
        try {
          rl.pause();
        } catch {
          // readline may already be closed after abort
        }
        resolve(defaultAccept);
      }, timeoutSeconds * 1000);
    }

    const timeoutHint =
      timeoutSeconds && timeoutSeconds > 0 ? ` (${timeoutSeconds}s)` : "";

    rl.question(
      chalk.greenBright(`${prompt}${timeoutHint} `),
      { signal: controller.signal },
      (answer) => {
        clearTimeout(timeout);
        rl.pause();
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === "") {
          resolve(defaultAccept);
        } else {
          resolve(trimmed === "y" || trimmed === "yes");
        }
      },
    );
  });
}
