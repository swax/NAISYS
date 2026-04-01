import fs from "fs";
import os from "os";
import path from "path";
import stringArgv from "string-argv";

import { AgentConfig } from "../agent/agentConfig.js";
import { desktopCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ContextManager } from "../llm/contextManager.js";
import { getImageScaleForApiType } from "../llm/llmService.js";
import { DesktopAction } from "../llm/vendors/vendorTypes.js";
import { ModelService } from "../services/modelService.js";
import {
  CoordScale,
  ComputerService,
  checkActionBounds,
  formatDesktopAction,
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

    const model = modelService.getLlmModel(agentConfig.agentConfig().shellModel);
    const scaleFactor = getImageScaleForApiType(model.apiType, width, height);
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

      const reason = argv[1] || "Action rejected by operator";

      // Add the deferred assistant response + error tool_results so the model sees the rejection
      contextManager.appendToolResponse(
        pendingBatch.textContent,
        pendingBatch.actions,
      );
      for (const action of pendingBatch.actions) {
        contextManager.appendToolResultError(action.id, reason);
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
    contextManager.appendToolResponse(textContent, actions);

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
          const { base64 } = await computerService.captureScreenshot();
          contextManager.appendToolResultError(
            action.id,
            `${boundsError}. All coordinates must be within bounds. Use the screenshot to identify the correct position and retry.`,
            { base64, mimeType: "image/png" },
          );
          continue;
        }
      }

      const desc = formatDesktopAction(action.input, coordScale) || action.name;
      output.commentAndLog(`Executing: ${desc}`);
      await computerService.executeAction(action.input);

      const { base64 } = await computerService.captureScreenshot();

      contextManager.appendToolResult(action.id, base64, "image/png");
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

  const registrableCommand: RegistrableCommand = {
    command: desktopCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    hasPendingActions,
    setPendingBatch,
    executePendingActions,
  };
}

export type DesktopService = ReturnType<typeof createDesktopService>;
