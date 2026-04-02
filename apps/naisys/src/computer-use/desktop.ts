import { LlmApiType, TARGET_MEGAPIXELS } from "@naisys/common";
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
import { getPlatformConfig } from "../services/shellPlatform.js";
import {
  CoordScale,
  ComputerService,
  checkActionBounds,
  formatDesktopAction,
  formatDesktopActions,
  getTargetScaleFactor,
  resizeScreenshot,
} from "./computerService.js";
import { OutputService } from "../utils/output.js";

// Re-export for consumers
export { formatDesktopAction } from "./computerService.js";
export type { CoordScale } from "./computerService.js";

/** Pending desktop batch: the full LLM response (text + actions) deferred until execution */
interface PendingBatch {
  textContent: string;
  actions: DesktopAction[];
  coordScale?: CoordScale;
}

export function createDesktopService(
  computerService: ComputerService,
  contextManager: ContextManager,
  output: OutputService,
  agentConfig: AgentConfig,
  modelService: ModelService,
) {
  let pendingBatch: PendingBatch | null = null;

  /** Handle the screenshot subcommand */
  async function handleScreenshot(): Promise<string> {
    const config = computerService.getConfig();
    if (!config) {
      return "Desktop mode is not enabled or failed to initialize.";
    }

    const baseDir = process.env.NAISYS_FOLDER || os.tmpdir();
    const outDir = path.join(baseDir, "home", agentConfig.agentConfig().username, "screenshots");
    fs.mkdirSync(outDir, { recursive: true });

    const { base64, width, height } = await computerService.captureScreenshot();
    const buffer = Buffer.from(base64, "base64");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fullPath = path.join(outDir, `screenshot-${timestamp}-full.png`);
    fs.writeFileSync(fullPath, buffer);

    const scaleFactor = getTargetScaleFactor(width, height);
    const scaledWidth = Math.floor(width * scaleFactor);
    const scaledHeight = Math.floor(height * scaleFactor);

    let scaledPath: string;
    if (scaleFactor < 1) {
      const scaledBase64 = await resizeScreenshot(
        base64,
        scaleFactor,
        width,
        height,
      );
      scaledPath = path.join(
        outDir,
        `screenshot-${timestamp}-${scaledWidth}x${scaledHeight}.png`,
      );
      fs.writeFileSync(scaledPath, Buffer.from(scaledBase64, "base64"));
    } else {
      // No scaling needed — full size is what the LLM sees
      scaledPath = fullPath;
    }

    return `Full: ${fullPath}\nScaled (${scaledWidth}x${scaledHeight}): ${scaledPath}`;
  }

  /** Handle ns-desktop commands */
  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);
    const firstArg = (argv[0] || "").toLowerCase();

    if (firstArg === "screenshot") {
      return handleScreenshot();
    }

    if (firstArg === "cancel") {
      if (!pendingBatch) {
        return "No pending desktop actions to cancel.";
      }

      const reason = argv[1] || "Action cancelled by operator";

      // Add the deferred assistant response + error tool_results so the model sees the rejection
      contextManager.appendDesktopRequest(
        pendingBatch.textContent,
        pendingBatch.actions,
        formatDesktopActions(pendingBatch.actions, pendingBatch.coordScale),
      );
      for (const action of pendingBatch.actions) {
        contextManager.appendDesktopError(action.id, reason);
      }

      pendingBatch = null;

      return "";
    }

    if (!firstArg) {
      return `Pending actions: ${pendingBatch?.actions.length ?? 0}.`;
    }

    return `Usage: ${desktopCmd.name} cancel ["<reason>"] | screenshot`;
  }

  /**
   * Execute all pending actions.
   * Adds the deferred tool_use (assistant) and tool_result (user) back-to-back
   * so they're always adjacent in context.
   */
  async function executePendingActions(): Promise<void> {
    if (!pendingBatch) return;

    const { textContent, actions, coordScale } = pendingBatch;
    pendingBatch = null;

    // Add the deferred assistant response (text + tool_use blocks) to context NOW
    contextManager.appendDesktopRequest(
      textContent,
      actions,
      formatDesktopActions(actions, coordScale),
    );

    // Execute each action and add its tool_result immediately after
    const desktopConfig = computerService.getConfig();

    for (const action of actions) {
      // Reject actions with out-of-bounds coordinates
      if (desktopConfig && coordScale) {
        const boundsError = checkActionBounds(
          action.input,
          desktopConfig.displayWidth,
          desktopConfig.displayHeight,
          coordScale,
        );
        if (boundsError) {
          const { base64, filepath } = await computerService.captureScreenshot();
          contextManager.appendDesktopError(
            action.id,
            `${boundsError}. All coordinates must be within bounds. Use the screenshot to identify the correct position and retry.`,
            { base64, mimeType: "image/png", filepath },
          );
          continue;
        }
      }

      const desc = formatDesktopAction(action.input, coordScale) || action.name;
      output.commentAndLog(`[Executing: ${desc}]`);
      await computerService.executeAction(action.input);

      const { base64, filepath } = await computerService.captureScreenshot();

      contextManager.appendDesktopResult(action.id, base64, "image/png", filepath);
    }
  }

  function hasPendingActions(): boolean {
    return pendingBatch !== null;
  }

  function setPendingBatch(
    textContent: string,
    actions: DesktopAction[],
    coordScale?: CoordScale,
  ): void {
    pendingBatch = { textContent, actions, coordScale };
  }

  /** Log desktop dimensions, scale info, and Anthropic warnings at startup */
  function logStartup(desktopInfo: DesktopInfo): void {
    const { nativeWidth, nativeHeight, scaledWidth, scaledHeight } = desktopInfo;
    const nativeMP = ((nativeWidth * nativeHeight) / 1_000_000).toFixed(2);
    const scaledMP = ((scaledWidth * scaledHeight) / 1_000_000).toFixed(2);
    const platformName = getPlatformConfig().displayName;

    contextManager.append(
      `Desktop Access Enabled: ${platformName} desktop, screen resolution ${scaledWidth}x${scaledHeight}. Use it as needed, but prefer the shell.` +
        ` Each action costs time and tokens. Avoid repeating the same action over and over if it is not working.`,
      ContentSource.Console,
    );
    output.commentAndLog(
      `Desktop: ${platformName}, native ${nativeWidth}x${nativeHeight} (${nativeMP}MP), scaled to ${scaledWidth}x${scaledHeight} (${scaledMP}MP, target ${TARGET_MEGAPIXELS}MP)`,
    );

    // Anthropic constrains images to 1568px longest edge and ~1.15MP.
    // If we exceed either limit, the API silently downscales, wasting the
    // resolution we carefully chose. Warn so TARGET_MEGAPIXELS can be reduced.
    const shellModel = modelService.getLlmModel(agentConfig.agentConfig().shellModel);
    if (shellModel.apiType === LlmApiType.Anthropic) {
      const longestEdge = Math.max(scaledWidth, scaledHeight);
      const scaledPixels = scaledWidth * scaledHeight;
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
    hasPendingActions,
    setPendingBatch,
    executePendingActions,
  };
}

export type DesktopService = ReturnType<typeof createDesktopService>;
