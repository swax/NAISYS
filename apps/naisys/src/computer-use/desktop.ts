import stringArgv from "string-argv";

import { desktopCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ContextManager } from "../llm/contextManager.js";
import { DesktopAction } from "../llm/vendors/vendorTypes.js";
import {
  CoordScale,
  ComputerService,
  checkActionBounds,
  formatDesktopAction,
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
) {
  let pendingBatch: PendingBatch | null = null;

  /** Handle ns-desktop commands (cancel with feedback) */
  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);
    const firstArg = (argv[0] || "").toLowerCase();

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

    return `Usage: ${desktopCmd.name} ${desktopCmd.usage}`;
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
