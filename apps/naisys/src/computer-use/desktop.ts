import { LlmApiType, TARGET_MEGAPIXELS } from "@naisys/common";
import fs from "fs";
import path from "path";
import stringArgv from "string-argv";

import type { AgentConfig } from "../agent/agentConfig.js";
import { desktopCmd } from "../command/commandDefs.js";
import type { RegistrableCommand } from "../command/commandRegistry.js";
import type { ShellWrapper } from "../command/shellWrapper.js";
import type { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import type { DesktopAction } from "../llm/vendors/vendorTypes.js";
import type { ModelService } from "../services/modelService.js";
import type { CommandLoopStateService } from "../utils/commandLoopState.js";
import { getConfirmation } from "../utils/confirmation.js";
import type { OutputService } from "../utils/output.js";
import type { ComputerService, CoordScale } from "./computerService.js";
import {
  checkActionBounds,
  describeDesktopViewport,
  formatDesktopAction,
  formatDesktopActions,
  getTargetScaleFactor,
  isDesktopFocused,
} from "./computerService.js";

export function createDesktopService(
  computerService: ComputerService,
  contextManager: ContextManager,
  output: OutputService,
  agentConfig: AgentConfig,
  modelService: ModelService,
  shellWrapper: ShellWrapper,
  commandLoopState: CommandLoopStateService,
) {
  const shellModel = modelService.getLlmModel(
    agentConfig.agentConfig().shellModel,
  );

  function getFocusChangeCostNote(): string {
    if (shellModel.apiType === LlmApiType.Anthropic) {
      return "Focus changes can increase next-turn cost by invalidating computer-use prompt caching, especially on Anthropic.";
    }
    return "Focus changes can increase next-turn cost because computer-use context has to be refreshed.";
  }

  function getDesktopRuntimeState(): {
    desktopConfig: ReturnType<ComputerService["getConfig"]>;
    coordScale?: CoordScale;
    scaledWidth?: number;
    scaledHeight?: number;
  } {
    const desktopConfig =
      agentConfig.agentConfig().controlDesktop && shellModel.supportsComputerUse
        ? computerService.getConfig()
        : undefined;

    if (!desktopConfig) {
      return { desktopConfig };
    }

    const { displayWidth: w, displayHeight: h } = desktopConfig;
    const scaleFactor = getTargetScaleFactor(w, h);

    return {
      desktopConfig,
      scaledWidth: Math.floor(w * scaleFactor),
      scaledHeight: Math.floor(h * scaleFactor),
      coordScale:
        shellModel.apiType === LlmApiType.Google
          ? { x: 1000 / w, y: 1000 / h }
          : { x: scaleFactor, y: scaleFactor },
    };
  }

  function attachViewportToActions(
    actions: DesktopAction[],
    desktopConfig?: NonNullable<ReturnType<ComputerService["getConfig"]>>,
  ): DesktopAction[] {
    if (!desktopConfig || !isDesktopFocused(desktopConfig)) {
      return actions;
    }

    return actions.map((action) => ({
      ...action,
      input: {
        ...action.input,
        viewport: { ...desktopConfig.viewport },
      },
    }));
  }

  /** Handle the screenshot subcommand */
  async function handleScreenshot(): Promise<string> {
    const cwd = await shellWrapper.getCurrentPath();
    const outDir = path.join(cwd || process.cwd(), "screenshots");
    fs.mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Save full native desktop screenshot
    const full = await computerService.captureFullNativeScreenshot();
    const fullPath = path.join(outDir, `screenshot-${timestamp}-full.png`);
    fs.copyFileSync(full.filepath, fullPath);

    // Save scaled viewport screenshot (same resolution the LLM sees)
    const scaled = await computerService.captureScaledScreenshot();
    const scaledPath = path.join(outDir, `screenshot-${timestamp}-scaled.png`);
    fs.copyFileSync(scaled.filepath, scaledPath);

    const desktopConfig = computerService.getConfig();
    const viewportLine = desktopConfig
      ? `\nViewport: ${describeDesktopViewport(desktopConfig)}`
      : "";

    return `Full: ${fullPath}\nScaled: ${scaledPath}${viewportLine}`;
  }

  /** Handle ns-desktop commands */
  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);
    const subs = desktopCmd.subcommands!;
    const usageError = (sub: keyof typeof subs) =>
      `Invalid parameters. Usage: ${desktopCmd.name} ${subs[sub].usage}`;

    if (!argv[0]) {
      argv[0] = "help";
    }

    const sub = argv[0].toLowerCase();

    if (sub === "help") {
      const lines = [`${desktopCmd.name} <command>`];
      for (const s of Object.values(subs)) {
        lines.push(`  ${s.usage.padEnd(40)}${s.description}`);
      }
      return lines.join("\n");
    }

    if (!computerService.getConfig()) {
      throw "Desktop mode is not enabled or failed to initialize.";
    }

    switch (sub) {
      case "screenshot": {
        return handleScreenshot();
      }

      case "focus": {
        if (!argv[1]) {
          return `Desktop focus: ${describeDesktopViewport(computerService.getConfig()!)}`;
        }

        if (argv[1].toLowerCase() === "clear") {
          computerService.setFocus(undefined);
          return `Desktop focus cleared. Using ${describeDesktopViewport(computerService.getConfig()!)}\n${getFocusChangeCostNote()}`;
        }

        const x = Number(argv[1]);
        const y = Number(argv[2]);
        const width = Number(argv[3]);
        const height = Number(argv[4]);
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          !Number.isInteger(width) ||
          !Number.isInteger(height)
        ) {
          throw usageError("focus");
        }

        const viewport = computerService.setFocus({ x, y, width, height });
        return `Desktop focus set to (${viewport!.x}, ${viewport!.y}, ${viewport!.width}x${viewport!.height}) in native screen pixels.\n${getFocusChangeCostNote()}`;
      }

      case "key": {
        const key = argv.slice(1).join(" ");
        if (!key) {
          throw usageError("key");
        }
        await computerService.executeAction({
          actions: [{ action: "key", text: key }],
        });
        return `Pressed key: ${key}`;
      }

      case "click": {
        const x = Number(argv[1]);
        const y = Number(argv[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw usageError("click");
        }
        const button = (argv[3] || "left").toLowerCase();
        const actionByButton: Record<string, string> = {
          left: "left_click",
          right: "right_click",
          middle: "middle_click",
          double: "double_click",
        };
        const action = actionByButton[button];
        if (!action) {
          throw `Unknown button "${button}". Use left, right, middle, or double.`;
        }
        await computerService.executeAction({
          actions: [{ action, coordinate: [x, y] }],
        });
        return `Clicked (${button}) at (${x}, ${y}) relative to the current viewport`;
      }

      case "type": {
        const text = argv.slice(1).join(" ");
        if (!text) {
          throw usageError("type");
        }
        await computerService.executeAction({
          actions: [{ action: "type", text }],
        });
        return `Typed: ${text}`;
      }

      default: {
        const helpResponse = await handleCommand("help");
        return `Unknown ${desktopCmd.name} subcommand '${argv[0]}'. See valid commands below:\n${helpResponse}`;
      }
    }
  }

  /**
   * Show preview, prompt for y/n confirmation (defaults to yes on timeout),
   * then execute or reject the desktop actions.
   */
  async function confirmAndExecuteActions(
    textContent: string,
    actions: DesktopAction[],
  ): Promise<void> {
    const { desktopConfig, coordScale } = getDesktopRuntimeState();
    const actionsWithViewport = attachViewportToActions(actions, desktopConfig);

    for (const action of actionsWithViewport) {
      const desc = formatDesktopAction(action.input, coordScale) || action.name;
      output.commentAndLog(`Desktop Action: ${desc}`);
    }

    // getConfirmation auto-approves when unfocused, so only surface the
    // Confirming state if the operator can actually respond
    if (output.isConsoleEnabled()) {
      commandLoopState.setState("Confirming");
    }
    const approved = await getConfirmation(
      output,
      "Execute desktop actions? [Y/n]",
      {
        defaultAccept: true,
        timeoutSeconds: agentConfig.agentConfig().debugPauseSeconds,
      },
    );
    commandLoopState.setState("Executing");

    // Add the deferred assistant response (text + tool_use blocks) to context
    contextManager.appendDesktopRequest(
      textContent,
      actionsWithViewport,
      formatDesktopActions(actionsWithViewport, coordScale),
    );

    if (approved) {
      for (const action of actionsWithViewport) {
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

          const { base64, filepath } =
            await computerService.captureScaledScreenshot();
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
      for (const action of actionsWithViewport) {
        contextManager.appendDesktopError(
          action.id,
          "Action rejected by operator",
        );
      }
    }
  }

  /** Log desktop dimensions, scale info, and Anthropic warnings at startup */
  function logStartup(): void {
    if (!agentConfig.agentConfig().controlDesktop) return;

    if (computerService.initError) {
      const platform = computerService.platformName ?? "Unknown";
      output.errorAndLog(
        `Desktop: ${platform} — failed to initialize, desktop mode disabled. ${computerService.initError}`,
      );
      return;
    }

    const { desktopConfig, scaledWidth, scaledHeight } = getDesktopRuntimeState();
    if (!desktopConfig || !scaledWidth || !scaledHeight) return;

    const {
      nativeDisplayWidth: nativeWidth,
      nativeDisplayHeight: nativeHeight,
      desktopPlatform,
    } = desktopConfig;
    const nativeMP = ((nativeWidth * nativeHeight) / 1_000_000).toFixed(2);
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
