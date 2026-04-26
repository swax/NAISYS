import { ptyCmd } from "../command/commandDefs.js";
import type { RegistrableCommand } from "../command/commandRegistry.js";
import type { ShellWrapper } from "../command/shellWrapper.js";
import { getPlatformConfig } from "../services/shellPlatform.js";

/**
 * Wraps a command with `script -qfc` so the inner program sees a real PTY
 * on stdin/stdout. Lets the LLM drive `sudo`, `ssh`, `passwd`, and other
 * `isatty()`-gated prompts that the pipe-based shell wrapper can't handle.
 *
 * Calls shellWrapper directly (not shellCommand) so it can request the
 * inline-delimiter form — script inherits bash's stdin, so a delimiter on a
 * separate line would be eaten by script and reach the inner PTY as input.
 *
 * Output flow stays normal: when script exits the delimiter fires and the
 * existing wait/kill/input continuation handles any prompt cycle in between.
 */
export function createPtyService(shellWrapper: ShellWrapper) {
  const platformConfig = getPlatformConfig();

  async function handleCommand(args: string): Promise<string> {
    const command = args.trim();

    if (!command) {
      return `Usage: ${ptyCmd.name} ${ptyCmd.usage}\n${ptyCmd.description}`;
    }

    if (platformConfig.platform !== "linux") {
      return `${ptyCmd.name} is Linux-only — PowerShell has no equivalent of script(1).`;
    }

    if (shellWrapper.isShellSuspended()) {
      return `Cannot run ${ptyCmd.name} while another shell command is active. Use 'wait', 'kill', or send input to the running command first.`;
    }

    const wrapped = `script -qfc ${shellEscape(command)} /dev/null`;
    return await shellWrapper.executeCommand(wrapped, {
      inlineDelimiter: true,
      secure: true,
    });
  }

  const registrableCommand: RegistrableCommand = {
    command: ptyCmd,
    handleCommand,
  };

  return registrableCommand;
}

/** Single-quote-wrap a string for safe inclusion as one shell argument. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export type PtyService = ReturnType<typeof createPtyService>;
