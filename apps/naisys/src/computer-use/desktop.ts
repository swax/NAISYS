import { LlmApiType, TARGET_MEGAPIXELS } from "@naisys/common";
import fs from "fs";
import path from "path";
import stringArgv from "string-argv";

import type { AgentConfig } from "../agent/agentConfig.js";
import { desktopCmd } from "../command/commandDefs.js";
import type {
  CommandResponse,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { NextCommandAction, timedWait } from "../command/commandRegistry.js";
import type { ShellWrapper } from "../command/shellWrapper.js";
import type { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import type {
  DesktopAction,
  DesktopActionInput,
  DesktopConfig,
} from "../llm/vendors/vendorTypes.js";
import type { ModelService } from "../services/modelService.js";
import type { CommandLoopStateService } from "../utils/commandLoopState.js";
import { getConfirmation } from "../utils/confirmation.js";
import type { InputModeService } from "../utils/inputMode.js";
import type { OutputService } from "../utils/output.js";
import type { ComputerService } from "./computerService.js";
import {
  checkActionBounds,
  formatDesktopAction,
  formatDesktopActions,
  isDesktopFocused,
  mapCoordinateBetweenSpaces,
  WAIT_DEFAULT_SECONDS,
} from "./computerService.js";

export function createDesktopService(
  computerService: ComputerService,
  contextManager: ContextManager,
  output: OutputService,
  agentConfig: AgentConfig,
  modelService: ModelService,
  shellWrapper: ShellWrapper,
  commandLoopState: CommandLoopStateService,
  inputMode: InputModeService,
) {
  type DesktopRuntimeState = {
    desktopConfig: ReturnType<ComputerService["getConfig"]>;
  };
  type VisibleDesktopState = {
    desktopConfig: DesktopConfig;
  };
  type DesktopSubcommand = keyof NonNullable<typeof desktopCmd.subcommands>;

  const shellModel = modelService.getLlmModel(
    agentConfig.agentConfig().shellModel,
  );
  const actionByButton: Partial<
    Record<
      string,
      | "left_click"
      | "right_click"
      | "middle_click"
      | "double_click"
      | "triple_click"
    >
  > = {
    left: "left_click",
    right: "right_click",
    middle: "middle_click",
    double: "double_click",
    triple: "triple_click",
  };
  // The briefing returned when focus was last set; replayed on no-args
  // `ns-desktop focus` so the LLM sees the same "where am I" story it got
  // at focus time. Cleared by `ns-desktop focus clear`.
  let lastFocusResponse: string | null = null;

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
    return { desktopConfig };
  }

  function requireVisibleDesktopState(): VisibleDesktopState {
    const { desktopConfig } = getDesktopRuntimeState();
    if (!desktopConfig) {
      throw "Desktop mode is not enabled or failed to initialize.";
    }
    return { desktopConfig };
  }

  function throwIfOutOfBounds(
    input: DesktopActionInput,
    state: VisibleDesktopState,
  ): void {
    const error = checkActionBounds(
      input,
      state.desktopConfig.scaledWidth,
      state.desktopConfig.scaledHeight,
    );
    if (error) throw `${error}.`;
  }

  /**
   * Map a point from scaled space to viewport space (native pixels,
   * 0..viewport.width, 0..viewport.height — relative to the viewport origin,
   * NOT the full display). Add viewport.x/y to get an absolute native coord.
   */
  function scaledPointToViewportPoint(
    x: number,
    y: number,
    state: VisibleDesktopState,
  ): number[] {
    return mapCoordinateBetweenSpaces(
      [x, y],
      state.desktopConfig.scaledWidth,
      state.desktopConfig.scaledHeight,
      state.desktopConfig.viewport.width,
      state.desktopConfig.viewport.height,
    );
  }

  /**
   * Map a rect from scaled space to native space (absolute native pixels,
   * relative to the full display origin). Used by focus, which takes
   * absolute native rects.
   */
  function scaledRectToNativeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    state: VisibleDesktopState,
  ): { x: number; y: number; width: number; height: number } {
    const [startX, startY] = scaledPointToViewportPoint(x, y, state);
    const [endX, endY] = scaledPointToViewportPoint(
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
    "move",
    "scroll",
    "drag",
    "wait",
  ]);

  function formatCommandHelp(): string {
    const allEntries = Object.entries(desktopCmd.subcommands!);
    const visible: typeof allEntries = [];
    const hidden: typeof allEntries = [];
    for (const entry of allEntries) {
      if (
        shellModel.supportsComputerUse &&
        TOOLING_REDUNDANT_SUBCOMMANDS.has(entry[0])
      ) {
        hidden.push(entry);
      } else {
        visible.push(entry);
      }
    }
    const showHidden = inputMode.isDebug() && hidden.length > 0;
    const usageWidth = Math.max(
      ...visible.map(([, s]) => s.usage.length),
      ...(showHidden ? hidden.map(([, s]) => s.usage.length) : []),
    );
    const lines = [formatDesktopStatus(), "", `${desktopCmd.name} <command>`];
    for (const [, s] of visible) {
      lines.push(`  ${s.usage.padEnd(usageWidth)}  ${s.description}`);
    }
    if (showHidden) {
      lines.push("", "Hidden because model supports computer use:");
      for (const [, s] of hidden) {
        lines.push(`  ${s.usage.padEnd(usageWidth)}  ${s.description}`);
      }
    }
    // The chaining tip only matters when click/type are visible — models with
    // computer-use tooling auto-screenshot per action and don't see them.
    if (!shellModel.supportsComputerUse) {
      lines.push(
        "",
        `Tip: chain ${desktopCmd.name} commands on separate lines in one ` +
          "response (e.g., 'click 100 200' then 'screenshot') to act and " +
          "observe in a single turn.",
      );
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

    const { desktopConfig } = getDesktopRuntimeState();
    if (!desktopConfig) {
      return "Desktop Status\n  State: unavailable";
    }
    const { scaleFactor, scaledWidth, scaledHeight, viewport } = desktopConfig;
    const modelCoordSpace =
      shellModel.supportsComputerUse && shellModel.apiType === LlmApiType.Google
        ? "0..999 normalized grid"
        : `scaled pixel space (${scaledWidth}x${scaledHeight})`;
    const viewportDesc = isDesktopFocused(desktopConfig)
      ? `(${viewport.x}, ${viewport.y}, ${viewport.width}x${viewport.height})`
      : "same as native screen";

    return [
      "Desktop Status",
      `  Platform: ${desktopConfig.desktopPlatform}`,
      `  Native Screen: ${desktopConfig.nativeDisplayWidth}x${desktopConfig.nativeDisplayHeight}`,
      `  Viewport: ${viewportDesc}`,
      `  LLM View: ${scaledWidth}x${scaledHeight}`,
      `  Model Coordinates: ${modelCoordSpace}`,
      `  Scale Factor: ${scaleFactor.toFixed(4)}`,
      `  Manual Focus Args: current screenshot pixels (${scaledWidth}x${scaledHeight})`,
      `  Manual Click Args: current screenshot pixels (${scaledWidth}x${scaledHeight})`,
    ].join("\n");
  }

  /**
   * Stamp every action with the viewport it was emitted against (focused
   * or not). Replay paths derive their coord frame from this stamp, so
   * actions are self-describing and a later focus change cannot misalign
   * a previously-emitted action.
   */
  function attachViewportToActions(
    actions: DesktopAction[],
    desktopConfig?: DesktopConfig,
  ): DesktopAction[] {
    if (!desktopConfig) return actions;

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
    const full = await computerService.captureFullScreenshot();
    const fullPath = path.join(outDir, `screenshot-${timestamp}-full.png`);
    fs.copyFileSync(full.filepath, fullPath);

    // Save native viewport screenshot
    const viewportNative = await computerService.captureViewportScreenshot();
    const viewportNativePath = path.join(
      outDir,
      `screenshot-${timestamp}-viewport.png`,
    );
    fs.writeFileSync(
      viewportNativePath,
      Buffer.from(viewportNative.base64, "base64"),
    );

    // Save scaled viewport screenshot (same resolution the LLM sees)
    const scaled = await computerService.captureScaledScreenshot();
    const scaledPath = path.join(outDir, `screenshot-${timestamp}-scaled.png`);
    fs.copyFileSync(scaled.filepath, scaledPath);

    return `Full: ${fullPath}\nViewport: ${viewportNativePath}\nScaled: ${scaledPath}`;
  }

  function handleFocusCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): string {
    if (!argv[1]) {
      const { desktopConfig } = requireVisibleDesktopState();
      if (!isDesktopFocused(desktopConfig)) {
        return `Focus not active. Scaled desktop: ${desktopConfig.scaledWidth}x${desktopConfig.scaledHeight}.`;
      }
      return (
        lastFocusResponse ??
        `Focus active. Scaled view: ${desktopConfig.scaledWidth}x${desktopConfig.scaledHeight}. Use 'ns-desktop focus clear' to return to the full desktop.`
      );
    }

    if (argv[1].toLowerCase() === "clear") {
      computerService.setFocus(undefined);
      output.commentAndLog(getFocusChangeCostNote());
      lastFocusResponse = null;
      const { desktopConfig } = requireVisibleDesktopState();
      return `Focus cleared. Now viewing full scaled desktop ${desktopConfig.scaledWidth}x${desktopConfig.scaledHeight}.`;
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
      x + width > state.desktopConfig.scaledWidth ||
      y + height > state.desktopConfig.scaledHeight
    ) {
      throw `Focus rect (${x}, ${y}, ${width}, ${height}) is outside the current screenshot bounds ${state.desktopConfig.scaledWidth}x${state.desktopConfig.scaledHeight}.`;
    }

    computerService.setFocus(
      scaledRectToNativeRect(x, y, width, height, state),
    );
    output.commentAndLog(getFocusChangeCostNote());
    const { desktopConfig: newConfig } = requireVisibleDesktopState();
    lastFocusResponse = `Focused on (${x}, ${y}, ${width}x${height}). That ${width}x${height} region is now shown as scaled ${newConfig.scaledWidth}x${newConfig.scaledHeight}. Use 'ns-desktop focus clear' to return to the full desktop.`;
    return lastFocusResponse;
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
    const button = (argv[3] || "left").toLowerCase();
    const action = actionByButton[button];
    if (!action) {
      throw `Unknown button "${button}". Use left, right, middle, double, or triple.`;
    }

    const input: DesktopActionInput = {
      actions: [{ action, coordinate: [x, y] }],
    };
    throwIfOutOfBounds(input, state);

    await computerService.executeAction(input);
    return `Clicked (${button}) at screenshot (${x}, ${y})`;
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

  async function handleMoveCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): Promise<string> {
    const x = Number(argv[1]);
    const y = Number(argv[2]);
    const state = requireVisibleDesktopState();

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw usageError("move");
    }

    const input: DesktopActionInput = {
      actions: [{ action: "mouse_move", coordinate: [x, y] }],
    };
    throwIfOutOfBounds(input, state);

    await computerService.executeAction(input);
    return `Moved mouse to screenshot (${x}, ${y})`;
  }

  async function handleScrollCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): Promise<string> {
    const x = Number(argv[1]);
    const y = Number(argv[2]);
    const direction = (argv[3] || "").toLowerCase();
    const amount = Number(argv[4]);
    const state = requireVisibleDesktopState();

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      throw usageError("scroll");
    }
    if (
      direction !== "up" &&
      direction !== "down" &&
      direction !== "left" &&
      direction !== "right"
    ) {
      throw `Unknown scroll direction "${argv[3]}". Use up, down, left, or right.`;
    }

    const input: DesktopActionInput = {
      actions: [
        {
          action: "scroll",
          coordinate: [x, y],
          scroll_direction: direction,
          scroll_amount: amount,
        },
      ],
    };
    throwIfOutOfBounds(input, state);

    await computerService.executeAction(input);
    return `Scrolled ${direction} by ${amount} at screenshot (${x}, ${y})`;
  }

  async function handleDragCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): Promise<string> {
    const x1 = Number(argv[1]);
    const y1 = Number(argv[2]);
    const x2 = Number(argv[3]);
    const y2 = Number(argv[4]);
    const state = requireVisibleDesktopState();

    if (
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      !Number.isFinite(x2) ||
      !Number.isFinite(y2)
    ) {
      throw usageError("drag");
    }

    const input: DesktopActionInput = {
      actions: [
        {
          action: "left_click_drag",
          start_coordinate: [x1, y1],
          coordinate: [x2, y2],
        },
      ],
    };
    throwIfOutOfBounds(input, state);

    await computerService.executeAction(input);
    return `Dragged from (${x1}, ${y1}) to (${x2}, ${y2})`;
  }

  function handleWaitCommand(
    argv: string[],
    usageError: (sub: DesktopSubcommand) => string,
  ): CommandResponse {
    let duration = WAIT_DEFAULT_SECONDS;
    if (argv[1] !== undefined) {
      const parsed = Number(argv[1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw usageError("wait");
      }
      duration = parsed;
    }
    // Defer to the session loop's interruptible wait (same machinery as
    // ns-session wait) so a long duration doesn't block the command loop and
    // the agent can be woken by mail or other events.
    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
        wait: timedWait(duration),
      },
    };
  }

  /** Handle ns-desktop commands */
  async function handleCommand(
    args: string,
  ): Promise<string | CommandResponse> {
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

      case "move": {
        return handleMoveCommand(argv, usageError);
      }

      case "scroll": {
        return handleScrollCommand(argv, usageError);
      }

      case "drag": {
        return handleDragCommand(argv, usageError);
      }

      case "wait": {
        return handleWaitCommand(argv, usageError);
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
    const { desktopConfig } = getDesktopRuntimeState();
    const actionsWithViewport = attachViewportToActions(actions, desktopConfig);

    for (const action of actionsWithViewport) {
      const desc = action.validationError
        ? `Unsupported action — ${action.validationError}`
        : formatDesktopAction(action.input, desktopConfig) || action.name;
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
      formatDesktopActions(actionsWithViewport, desktopConfig),
    );

    if (approved) {
      for (const action of actionsWithViewport) {
        if (action.validationError) {
          contextManager.appendDesktopError(
            action.id,
            `${action.validationError}. Re-issue with a supported action shape.`,
          );
          continue;
        }
        if (desktopConfig) {
          const boundsError = checkActionBounds(
            action.input,
            desktopConfig.scaledWidth,
            desktopConfig.scaledHeight,
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
          formatDesktopAction(action.input, desktopConfig) || action.name;
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

    const { desktopConfig } = getDesktopRuntimeState();
    if (!desktopConfig) return;

    const {
      nativeDisplayWidth: nativeWidth,
      nativeDisplayHeight: nativeHeight,
      scaledWidth,
      scaledHeight,
      desktopPlatform,
    } = desktopConfig;
    const nativeMP = ((nativeWidth * nativeHeight) / 1_000_000).toFixed(2);
    const scaledMP = ((scaledWidth * scaledHeight) / 1_000_000).toFixed(2);

    const howToInteract = shellModel.supportsComputerUse
      ? `Use native computer-use tooling for clicking, typing, and keypresses; use \`${desktopCmd.name}\` for screenshots, focus, and hold-key (see \`${desktopCmd.name} help\`).`
      : `Use \`${desktopCmd.name}\` commands to interact (see \`${desktopCmd.name} help\`). The shell is still available to run text commands.`;

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
        `Model '${agentConfig.agentConfig().shellModel}' does not explicitly support computer use through tooling, so position based actions like clicking may be unreliable`,
      );
    }

    // Anthropic constrains images to 1568px longest edge and ~1.15MP.
    // If we exceed either limit, the API silently downscales, wasting the
    // resolution we carefully chose. Warn so TARGET_MEGAPIXELS can be reduced.
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
    confirmAndExecuteActions,
  };
}

export type DesktopService = ReturnType<typeof createDesktopService>;
