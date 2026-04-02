import { LlmApiType, TARGET_MEGAPIXELS } from "@naisys/common";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import stringArgv from "string-argv";

import { AgentConfig } from "../agent/agentConfig.js";
import { desktopCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import { DesktopAction, DesktopInfo } from "../llm/vendors/vendorTypes.js";
import { ModelService } from "../services/modelService.js";
import {
  CoordScale,
  ComputerService,
  checkActionBounds,
  formatDesktopAction,
  formatDesktopActions,
} from "./computerService.js";
import { OutputService } from "../utils/output.js";
import { getSharedReadline } from "../utils/sharedReadline.js";

// Re-export for consumers
export { formatDesktopAction } from "./computerService.js";
export type { CoordScale } from "./computerService.js";

export function createDesktopService(
  computerService: ComputerService,
  contextManager: ContextManager,
  output: OutputService,
  agentConfig: AgentConfig,
  modelService: ModelService,
) {

  /** Handle the screenshot subcommand */
  async function handleScreenshot(): Promise<string> {
    const config = computerService.getConfig();
    if (!config) {
      return "Desktop mode is not enabled or failed to initialize.";
    }

    const baseDir = process.env.NAISYS_FOLDER || os.tmpdir();
    const outDir = path.join(baseDir, "home", agentConfig.agentConfig().username, "screenshots");
    fs.mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Save full-size native screenshot
    const native = await computerService.captureNativeScreenshot();
    const fullPath = path.join(outDir, `screenshot-${timestamp}-full.png`);
    fs.writeFileSync(fullPath, Buffer.from(native.base64, "base64"));

    // Save scaled screenshot (same resolution the LLM sees)
    const scaled = await computerService.captureScaledScreenshot();
    const scaledPath = path.join(
      outDir,
      `screenshot-${timestamp}-scaled.png`,
    );
    fs.copyFileSync(scaled.filepath, scaledPath);

    return `Full: ${fullPath}\nScaled: ${scaledPath}`;
  }

  /** Handle ns-desktop commands */
  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);
    const firstArg = (argv[0] || "").toLowerCase();

    if (firstArg === "screenshot") {
      return handleScreenshot();
    }

    return `Usage: ${desktopCmd.name} screenshot`;
  }

  /**
   * Show preview, prompt for y/n confirmation (defaults to yes on timeout),
   * then execute or reject the desktop actions.
   */
  async function confirmAndExecuteActions(
    textContent: string,
    actions: DesktopAction[],
    coordScale?: CoordScale,
  ): Promise<void> {
    for (const action of actions) {
      const desc = formatDesktopAction(action.input, coordScale) || action.name;
      output.commentAndLog(`Desktop Action: ${desc}`);
    }

    const approved = await getDesktopConfirmation(
      agentConfig.agentConfig().debugPauseSeconds,
    );

    // Add the deferred assistant response (text + tool_use blocks) to context
    contextManager.appendDesktopRequest(
      textContent,
      actions,
      formatDesktopActions(actions, coordScale),
    );

    if (approved) {
      const desktopConfig = computerService.getConfig();

      for (const action of actions) {
        if (desktopConfig && coordScale) {
          const boundsError = checkActionBounds(
            action.input,
            desktopConfig.displayWidth,
            desktopConfig.displayHeight,
            coordScale,
          );
          if (boundsError) {
            const { base64, filepath } =
              await computerService.captureScaledScreenshot();
            contextManager.appendDesktopError(
              action.id,
              `${boundsError}. All coordinates must be within bounds. Use the screenshot to identify the correct position and retry.`,
              { base64, mimeType: "image/png", filepath },
            );
            continue;
          }
        }

        const desc =
          formatDesktopAction(action.input, coordScale) || action.name;
        output.commentAndLog(`[Executing: ${desc}]`);

        try {
          await computerService.executeAction(action.input);

          const { base64, filepath } = await computerService.captureScaledScreenshot();
          contextManager.appendDesktopResult(
            action.id,
            base64,
            "image/png",
            filepath,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          output.errorAndLog(`Desktop action failed: ${msg}`);
          contextManager.appendDesktopError(action.id, msg);
        }
      }
    } else {
      for (const action of actions) {
        contextManager.appendDesktopError(
          action.id,
          "Action rejected by operator",
        );
      }
    }
  }

  /** Prompt for y/n confirmation with a timeout that defaults to yes */
  function getDesktopConfirmation(timeoutSeconds: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!output.isConsoleEnabled()) {
        resolve(true);
        return;
      }

      const rl = getSharedReadline();
      const controller = new AbortController();
      let timeout: NodeJS.Timeout | undefined;

      if (timeoutSeconds > 0) {
        timeout = setTimeout(() => {
          controller.abort();
          try {
            rl.pause();
          } catch {
            // On Windows, readline may already be closed after abort
          }
          resolve(true);
        }, timeoutSeconds * 1000);
      }

      rl.question(
        chalk.greenBright(
          `Execute desktop actions? [Y/n]${timeoutSeconds > 0 ? ` (${timeoutSeconds}s)` : ""} `,
        ),
        { signal: controller.signal },
        (answer) => {
          clearTimeout(timeout);
          rl.pause();
          const trimmed = answer.trim().toLowerCase();
          resolve(trimmed !== "n" && trimmed !== "no");
        },
      );
    });
  }

  /** Log desktop dimensions, scale info, and Anthropic warnings at startup */
  function logStartup(desktopInfo: DesktopInfo): void {
    const { desktopPlatform, initError } = desktopInfo;

    if (initError) {
      output.errorAndLog(
        `Desktop: ${desktopPlatform} — failed to initialize, desktop mode disabled. ${initError}`,
      );
      return;
    }

    const { nativeWidth, nativeHeight, scaledWidth, scaledHeight } = desktopInfo;
    const nativeMP = ((nativeWidth! * nativeHeight!) / 1_000_000).toFixed(2);
    const scaledMP = ((scaledWidth! * scaledHeight!) / 1_000_000).toFixed(2);

    contextManager.append(
      `Desktop Access Enabled: ${desktopPlatform} desktop, screen resolution ${scaledWidth}x${scaledHeight}. Use it as needed, but prefer the shell.` +
        ` Each action costs time and tokens. Avoid repeating the same action over and over if it is not working.`,
      ContentSource.Console,
    );
    output.commentAndLog(
      `Desktop: ${desktopPlatform}, native ${nativeWidth}x${nativeHeight} (${nativeMP}MP), scaled to ${scaledWidth}x${scaledHeight} (${scaledMP}MP, target ${TARGET_MEGAPIXELS}MP)`,
    );

    // Anthropic constrains images to 1568px longest edge and ~1.15MP.
    // If we exceed either limit, the API silently downscales, wasting the
    // resolution we carefully chose. Warn so TARGET_MEGAPIXELS can be reduced.
    const shellModel = modelService.getLlmModel(agentConfig.agentConfig().shellModel);
    if (shellModel.apiType === LlmApiType.Anthropic) {
      const longestEdge = Math.max(scaledWidth!, scaledHeight!);
      const scaledPixels = scaledWidth! * scaledHeight!;
      if (longestEdge > 1568) {
        output.errorAndLog(
          `Warning: Scaled longest edge ${longestEdge}px exceeds Anthropic's 1568px limit — API will internally downscale. Reduce TARGET_MEGAPIXELS to avoid.`,
        );
      } else if (scaledPixels > 1_150_000) {
        output.errorAndLog(
          `Warning: Scaled resolution ${scaledWidth}x${scaledHeight} (${scaledMP}MP) exceeds Anthropic's ~1.15MP limit — API will internally downscale. Reduce TARGET_MEGAPIXELS to avoid.`,
        );
      }
    }
  }

  const registrableCommand: RegistrableCommand = {
    command: desktopCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    logStartup,
    confirmAndExecuteActions,
  };
}

export type DesktopService = ReturnType<typeof createDesktopService>;
