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
import type {
  DesktopAction,
  DesktopConfig,
} from "../llm/vendors/vendorTypes.js";
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
  mapCoordinateBetweenSpaces,
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
  type DesktopRuntimeState = {
    desktopConfig: ReturnType<ComputerService["getConfig"]>;
    scaleFactor?: number;
    coordScale?: CoordScale;
    scaledWidth?: number;
    scaledHeight?: number;
  };
  type VisibleDesktopState = {
    desktopConfig: DesktopConfig;
    scaleFactor: number;
    scaledWidth: number;
    scaledHeight: number;
  };
  type DesktopSubcommand = keyof NonNullable<typeof desktopCmd.subcommands>;

  const shellModel = modelService.getLlmModel(
    agentConfig.agentConfig().shellModel,
  );
  const actionByButton: Record<string, string> = {
    left: "left_click",
    right: "right_click",
    middle: "middle_click",
    double: "double_click",
  };

  function getFocusChangeCostNote(): string {
    if (shellModel.apiType === LlmApiType.Anthropic) {
      return "Focus changes can increase next-turn cost by invalidating computer-use prompt caching, especially on Anthropic.";
    }
    return "Focus changes can increase next-turn cost because computer-use context has to be refreshed.";
  }

  function getDesktopRuntimeState(): DesktopRuntimeState {
    const desktopConfig = agentConfig.agentConfig().controlDesktop
      ? computerService.getConfig()
      : undefined;

    if (!desktopConfig) {
      return { desktopConfig };
    }

    const { displayWidth: w, displayHeight: h } = desktopConfig;
    const scaleFactor = getTargetScaleFactor(w, h);

    return {
      desktopConfig,
      scaleFactor,
      scaledWidth: Math.floor(w * scaleFactor),
      scaledHeight: Math.floor(h * scaleFactor),
      coordScale:
        shellModel.supportsComputerUse &&
        shellModel.apiType === LlmApiType.Google
          ? { x: 1000 / w, y: 1000 / h }
          : { x: scaleFactor, y: scaleFactor },
    };
  }

  function requireVisibleDesktopState(): VisibleDesktopState {
    const { desktopConfig, scaleFactor, scaledWidth, scaledHeight } =
      getDesktopRuntimeState();

    if (!desktopConfig || !scaleFactor || !scaledWidth || !scaledHeight) {
      throw "Desktop mode is not enabled or failed to initialize.";
    }

    return { desktopConfig, scaleFactor, scaledWidth, scaledHeight };
  }

  function mapScreenshotPointToViewport(
    x: number,
    y: number,
    state: VisibleDesktopState,
  ): number[] {
    return mapCoordinateBetweenSpaces(
      [x, y],
      state.scaledWidth,
      state.scaledHeight,
      state.desktopConfig.displayWidth,
      state.desktopConfig.displayHeight,
    );
  }

  function mapScreenshotRectToNative(
    x: number,
    y: number,
    width: number,
    height: number,
    state: VisibleDesktopState,
  ): { x: number; y: number; width: number; height: number } {
    const [startX, startY] = mapScreenshotPointToViewport(x, y, state);
    const [endX, endY] = mapScreenshotPointToViewport(
      x + width,
      y + height,
      state,
    );

    return {
      x: state.desktopConfig.viewport.x + startX,
      y: state.desktopConfig.viewport.y + startY,
      width: Math.max(1, endX - startX),
      height: Math.max(1, endY - startY),
    };
  }

  // Subcommands that duplicate native computer-use tool actions — hidden from
  // help when the model has tooling, since the model should use the native
  // actions instead. `hold` stays visible because not every vendor supports it
  // natively (only Anthropic) and even there the shell gives finer timing.
  const TOOLING_REDUNDANT_SUBCOMMANDS = new Set([
    "screenshot",
    "key",
    "click",
    "type",
  ]);

  function formatCommandHelp(): string {
    const lines = [formatDesktopStatus(), "", `${desktopCmd.name} <command>`];
    for (const [name, s] of Object.entries(desktopCmd.subcommands!)) {
      if (
        shellModel.supportsComputerUse &&
        TOOLING_REDUNDANT_SUBCOMMANDS.has(name)
      ) {
        continue;
      }
      lines.push(`  ${s.usage.padEnd(40)}${s.description}`);
    }
    return lines.join("\n");
  }

  function formatDesktopStatus(): string {
    if (!agentConfig.agentConfig().controlDesktop) {
      return "Desktop Status\n  State: disabled";
    }

    if (computerService.initError) {
      const platform = computerService.platformName ?? "Unknown";
      return [
        "Desktop Status",
        `  State: unavailable`,
        `  Platform: ${platform}`,
        `  Reason: ${computerService.initError}`,
      ].join("\n");
    }

    const { desktopConfig, scaleFactor, scaledWidth, scaledHeight } =
      getDesktopRuntimeState();
    if (!desktopConfig || !scaleFactor || !scaledWidth || !scaledHeight) {
      return "Desktop Status\n  State: unavailable";
    }
    const modelCoordSpace =
      shellModel.supportsComputerUse && shellModel.apiType === LlmApiType.Google
        ? "0..999 normalized grid"
        : `scaled pixel space (${scaledWidth}x${scaledHeight})`;

    return [
      "Desktop Status",
      `  Platform: ${desktopConfig.desktopPlatform}`,
      `  Native Screen: ${desktopConfig.nativeDisplayWidth}x${desktopConfig.nativeDisplayHeight}`,
      `  Viewport: ${describeDesktopViewport(desktopConfig)}`,
      `  LLM View: ${scaledWidth}x${scaledHeight}`,
      `  Model Coordinates: ${modelCoordSpace}`,
      `  Scale Factor: ${scaleFactor.toFixed(4)}`,
      `  Manual Focus Args: current screenshot pixels (${scaledWidth}x${scaledHeight})`,
      `  Manual Click Args: current screenshot pixels (${scaledWidth}x${scaledHeight})`,
    ].join("\n");
  }

  function attachViewportToActions(
    actions: DesktopAction[],
    desktopConfig?: DesktopConfig,
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

  async function getScreenshotOutputDir(): Promise<string> {
    const cwd = await shellWrapper.getCurrentPath();
    const outDir = path.join(cwd || process.cwd(), "screenshots");
    fs.mkdirSync(outDir, { recursive: true });
    return outDir;
  }

  /** Handle the screenshot subcommand */
  async function handleScreenshot(): Promise<string> {
    if (!shellModel.supportsVision) {
      return `Error: Model '${agentConfig.agentConfig().shellModel}' does not support vision. ${desktopCmd.name} screenshot requires a vision-capable model.`;
    }

    const scaled = await computerService.captureScaledScreenshot();
    return contextManager.appendImage(
      scaled.base64,
      "image/png",
      scaled.filepath,
    );
  }

  /** Handle the dump subcommand */
  async function handleDump(): Promise<string> {
    const outDir = await getScreenshotOutputDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Save full native desktop screenshot
    const full = await computerService.captureFullNativeScreenshot();
    const fullPath = path.join(outDir, `screenshot-${timestamp}-full.png`);
    fs.copyFileSync(full.filepath, fullPath);

    // Save native viewport screenshot
    const viewportNative = await computerService.captureNativeScreenshot();
    const viewportNativePath = path.join(
      outDir,
      `screenshot-${timestamp}-viewport-native.png`,
    );
    fs.writeFileSync(
      viewportNativePath,
      Buffer.from(viewportNative.base64, "base64"),
    );

    // Save scaled viewport screenshot (same resolution the LLM sees)
    const scaled = await computerService.captureScaledScreenshot();
    const scaledPath = path.join(outDir, `screenshot-${timestamp}-scaled.png`);
    fs.copyFileSync(scaled.filepath, scaledPath);

    const desktopConfig = computerService.getConfig();
    const { scaledWidth, scaledHeight } = getDesktopRuntimeState();
    const viewportLine = desktopConfig
      ? `\nViewport: ${describeDesktopViewport(desktopConfig)}`
      : "";
    const clickLine =
      scaledWidth && scaledHeight
        ? `\nManual Click Coords: scaled screenshot ${scaledWidth}x${scaledHeight}`
        : "";

    return `Full: ${fullPath}\nViewport Native: ${viewportNativePath}\nScaled: ${scaledPath}${viewportLine}${clickLine}`;
  }

  function handleFocusCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): string {
    const desktopConfig = computerService.getConfig();
    if (!argv[1]) {
      return `Desktop focus: ${describeDesktopViewport(desktopConfig!)}`;
    }

    if (argv[1].toLowerCase() === "clear") {
      computerService.setFocus(undefined);
      output.commentAndLog(getFocusChangeCostNote());
      return `Desktop focus cleared. Using ${describeDesktopViewport(desktopConfig!)}`;
    }

    const x = Number(argv[1]);
    const y = Number(argv[2]);
    const width = Number(argv[3]);
    const height = Number(argv[4]);
    const state = requireVisibleDesktopState();

    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw usageError("focus");
    }
    if (
      x < 0 ||
      y < 0 ||
      x + width > state.scaledWidth ||
      y + height > state.scaledHeight
    ) {
      throw `Focus rect (${x}, ${y}, ${width}, ${height}) is outside the current screenshot bounds ${state.scaledWidth}x${state.scaledHeight}.`;
    }

    const viewport = computerService.setFocus(
      mapScreenshotRectToNative(x, y, width, height, state),
    );
    output.commentAndLog(getFocusChangeCostNote());
    return `Desktop focus set from screenshot (${x}, ${y}, ${width}x${height}) -> native (${viewport!.x}, ${viewport!.y}, ${viewport!.width}x${viewport!.height}).`;
  }

  async function handleKeyCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): Promise<string> {
    const key = argv.slice(1).join(" ");
    if (!key) {
      throw usageError("key");
    }
    await computerService.executeAction({
      actions: [{ action: "key", text: key }],
    });
    return `Pressed key: ${key}`;
  }

  async function handleHoldCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): Promise<string> {
    // Last arg must be ms; everything before is the key combo.
    const ms = Number(argv[argv.length - 1]);
    const key = argv.slice(1, -1).join(" ");
    if (!key || !Number.isFinite(ms) || ms <= 0) {
      throw usageError("hold");
    }
    // Cap to prevent a stuck-key lockout if the agent picks a huge number.
    const HOLD_MAX_MS = 10000;
    if (ms > HOLD_MAX_MS) {
      throw `hold duration ${ms}ms exceeds max ${HOLD_MAX_MS}ms`;
    }
    await computerService.executeAction({
      actions: [{ action: "hold_key", text: key, duration: ms / 1000 }],
    });
    return `Held key: ${key} for ${ms}ms`;
  }

  async function handleClickCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): Promise<string> {
    const x = Number(argv[1]);
    const y = Number(argv[2]);
    const state = requireVisibleDesktopState();

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw usageError("click");
    }
    if (x < 0 || y < 0 || x >= state.scaledWidth || y >= state.scaledHeight) {
      throw `Click (${x}, ${y}) is outside the current screenshot bounds ${state.scaledWidth}x${state.scaledHeight}.`;
    }
    const button = (argv[3] || "left").toLowerCase();
    const action = actionByButton[button];
    if (!action) {
      throw `Unknown button "${button}". Use left, right, middle, or double.`;
    }

    const [viewportX, viewportY] = mapScreenshotPointToViewport(x, y, state);
    await computerService.executeAction({
      actions: [{ action, coordinate: [viewportX, viewportY] }],
    });
    return `Clicked (${button}) at screenshot (${x}, ${y}) -> viewport (${viewportX}, ${viewportY})`;
  }

  async function handleTypeCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): Promise<string> {
    const text = argv.slice(1).join(" ");
    if (!text) {
      throw usageError("type");
    }
    await computerService.executeAction({
      actions: [{ action: "type", text }],
    });
    return `Typed: ${text}`;
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
      return formatCommandHelp();
    }

    if (!computerService.getConfig()) {
      throw "Desktop mode is not enabled or failed to initialize.";
    }

    switch (sub) {
      case "screenshot": {
        return handleScreenshot();
      }

      case "dump": {
        return handleDump();
      }

      case "focus": {
        return handleFocusCommand(argv, usageError);
      }

      case "key": {
        return handleKeyCommand(argv, usageError);
      }

      case "hold": {
        return handleHoldCommand(argv, usageError);
      }

      case "click": {
        return handleClickCommand(argv, usageError);
      }

      case "type": {
        return handleTypeCommand(argv, usageError);
      }

      default: {
        const helpResponse = formatCommandHelp();
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

    const { desktopConfig, scaledWidth, scaledHeight } =
      getDesktopRuntimeState();
    if (!desktopConfig || !scaledWidth || !scaledHeight) return;

    const {
      nativeDisplayWidth: nativeWidth,
      nativeDisplayHeight: nativeHeight,
      desktopPlatform,
    } = desktopConfig;
    const nativeMP = ((nativeWidth * nativeHeight) / 1_000_000).toFixed(2);
    const scaledMP = ((scaledWidth! * scaledHeight!) / 1_000_000).toFixed(2);

    const howToInteract = shellModel.supportsComputerUse
      ? `Use native computer-use actions for clicking, typing, and keypresses; use \`${desktopCmd.name}\` for screenshots, focus, and hold-key (see \`${desktopCmd.name} help\`).`
      : `Use \`${desktopCmd.name}\` commands to interact (see \`${desktopCmd.name} help\`). The shell is still available alongside.`;

    contextManager.append(
      `Desktop Access Enabled: ${desktopPlatform} desktop, screen resolution ${scaledWidth}x${scaledHeight}. ${howToInteract}` +
        ` Each action costs time and tokens. Avoid repeating the same action over and over if it is not working.`,
      ContentSource.Console,
    );
    output.commentAndLog(
      `Desktop: ${desktopPlatform}, native ${nativeWidth}x${nativeHeight} (${nativeMP}MP), scaled to ${scaledWidth}x${scaledHeight} (${scaledMP}MP, target ${TARGET_MEGAPIXELS}MP)`,
    );

    if (!shellModel.supportsComputerUse) {
      output.errorAndLog(
        `Model '${agentConfig.agentConfig().shellModel}' does not explicitly support computer use through tooling, so position based actions like clicking may be very unreliable`,
      );
    }

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
