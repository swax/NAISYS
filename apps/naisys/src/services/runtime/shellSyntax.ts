import { spawn } from "node:child_process";

import type { PlatformConfig } from "./shellPlatform.js";

/** Parse only, in a separate process: incomplete input must never reach the
 * persistent shell, where it could consume the completion marker as input.
 * stdin carries the source verbatim, without another layer of shell quoting. */
export async function validateShellSyntax(
  command: string,
  platform: Pick<PlatformConfig, "platform" | "shellCommand">,
): Promise<string | undefined> {
  const args =
    platform.platform === "windows"
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$source = [Console]::In.ReadToEnd(); $tokens = $null; $errors = $null; " +
            "[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors); " +
            "if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }",
        ]
      : ["--noprofile", "--norc", "-n"];
  const env = { ...process.env };
  delete env.BASH_ENV;
  delete env.ENV;
  return new Promise((resolve) => {
    const child = spawn(platform.shellCommand, args, {
      shell: false,
      windowsHide: true,
      env,
      stdio: "pipe",
    });
    let errors = "";
    let finished = false;
    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish("Shell syntax check timed out; command was not executed.");
    }, 5000);
    child.stderr.on("data", (data: Buffer) => {
      errors = (errors + data.toString()).slice(0, 2000);
    });
    child.stdout.resume();
    child.on("error", (error) =>
      finish(`Cannot check shell syntax: ${error.message}`),
    );
    child.stdin.on("error", () => {
      /* early parser exit is handled by close */
    });
    child.on("close", (code) => {
      // Bash reports an unterminated here-document as a warning with exit 0.
      finish(
        code === 0 && !errors
          ? undefined
          : errors.trim() || `Shell parser exited with code ${code}`,
      );
    });
    child.stdin.end(command + "\n");
  });
}
