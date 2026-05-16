import { LlmApiType } from "@naisys/common";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createDesktopClaimService } from "../../computer-use/desktopClaimService.js";
import { getConfirmation } from "../../utils/input/confirmation.js";
import { buildDesktopService } from "../builders/desktop.js";

vi.mock("../../utils/input/confirmation.js", () => ({
  getConfirmation: vi.fn().mockResolvedValue(true),
}));

describe("desktop focus commands", () => {
  test("maps screenshot focus coordinates into native desktop focus", async () => {
    const { desktopService, computerService, output } = buildDesktopService({
      config: {
        nativeDisplayWidth: 3840,
        nativeDisplayHeight: 2160,
        viewport: { x: 0, y: 0, width: 3840, height: 2160 },
        scaleFactor: 0.359375,
      },
      computerService: {
        setFocus: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      },
    });

    await expect(
      desktopService.handleCommand("focus 0 0 690 388"),
    ).resolves.toBe(
      "Focused on (0, 0, 690x388). That 690x388 region is now shown as scaled 1380x776. Use 'ns-desktop focus clear' to return to the full desktop.",
    );
    expect(output.commentAndLog).toHaveBeenCalledWith(
      "Focus changes can increase next-turn cost because computer-use context has to be refreshed.",
    );

    expect(computerService.setFocus).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  test("stamps every action with the viewport it was emitted against, including full-desktop", async () => {
    const { desktopService, contextManager } = buildDesktopService({
      computerService: {
        executeAction: vi.fn(async () => {}),
        captureScaledScreenshot: vi.fn(() =>
          Promise.resolve({
            base64: "abc",
            filepath: "/tmp/screenshot.png",
          }),
        ),
      },
    });

    await desktopService.confirmAndExecuteActions("", [
      {
        id: "call-1",
        name: "computer",
        input: {
          actions: [{ action: "left_click", coordinate: [10, 20] }],
        },
      },
    ]);

    const toolBlocks = (contextManager.appendDesktopRequest as any).mock
      .calls[0][1];
    expect(toolBlocks[0].input.viewport).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  test("adds the scaled screenshot to context for non-computer-use models", async () => {
    const { desktopService, contextManager } = buildDesktopService({
      computerService: {
        captureScaledScreenshot: vi.fn(() =>
          Promise.resolve({
            base64: "abc123",
            filepath: "/tmp/llm-view.png",
          }),
        ),
      },
      model: { supportsComputerUse: false },
    });

    await expect(desktopService.handleCommand("screenshot")).resolves.toBe("");
    expect(contextManager.appendImage).toHaveBeenCalledWith(
      "abc123",
      "image/png",
      "/tmp/llm-view.png",
    );
  });

  test("forwards appendImage rejection reason from screenshot command", async () => {
    const { desktopService, contextManager } = buildDesktopService({
      computerService: {
        captureScaledScreenshot: vi.fn(() =>
          Promise.resolve({
            base64: "abc",
            filepath: "/tmp/s.png",
          }),
        ),
      },
      model: { apiType: LlmApiType.Anthropic },
    });
    (contextManager.appendImage as any).mockReturnValue(
      "Error: images are blocked",
    );

    await expect(desktopService.handleCommand("screenshot")).resolves.toBe(
      "Error: images are blocked",
    );
  });

  test("maps manual click coordinates from the current screenshot to viewport pixels", async () => {
    const { desktopService, computerService } = buildDesktopService({
      config: {
        nativeDisplayWidth: 3840,
        nativeDisplayHeight: 2160,
        viewport: { x: 0, y: 0, width: 3840, height: 2160 },
        scaleFactor: 0.359375,
        desktopPlatform: "Windows (WSL)",
      },
      computerService: {
        executeAction: vi.fn(async () => {}),
      },
    });

    await expect(desktopService.handleCommand("click 828 764")).resolves.toBe(
      "Clicked (left) at screenshot (828, 764)",
    );

    expect(computerService.executeAction).toHaveBeenCalledWith({
      actions: [{ action: "left_click", coordinate: [828, 764] }],
    });
  });

  test("shows desktop status before help output", async () => {
    const { desktopService } = buildDesktopService({
      config: {
        viewport: { x: 100, y: 50, width: 1600, height: 900 },
        scaleFactor: 0.8625,
      },
      model: { supportsComputerUse: false },
    });

    const helpText = await desktopService.handleCommand("");

    expect(helpText).toContain("Desktop Status");
    expect(helpText).toContain("Native Screen: 1920x1080");
    expect(helpText).toContain("Viewport: (100, 50, 1600x900)");
    expect(helpText).toContain("LLM View:");
    expect(helpText).toContain("Model Coordinates: scaled pixel space");
    expect(helpText).toContain("Manual Focus Args: current screenshot pixels");
    expect(helpText).toContain("Manual Click Args: current screenshot pixels");
    expect(helpText).toContain("ns-desktop <command>");
    expect(helpText).toContain("key <combo>");
    expect(helpText).toContain(
      "Send a manual key combo or sequence (e.g. enter, escape, ctrl+c, alt+tab, up up right)",
    );
  });
});

describe("desktop claim sharing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("first modifying action claims the desktop and surfaces in status", async () => {
    const claim = createDesktopClaimService();
    const { desktopService } = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: vi.fn(async () => {}) },
    });

    await desktopService.handleCommand("click 100 100");
    expect(claim.getStatus()?.agentUsername).toBe("alice");

    const status = await desktopService.handleCommand("");
    expect(status).toContain("Claim: held by you");
  });

  test("second agent is blocked while first agent's claim is fresh", async () => {
    const claim = createDesktopClaimService();
    const aliceExec = vi.fn(async () => {});
    const bobExec = vi.fn(async () => {});

    const alice = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: aliceExec },
    });
    const bob = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "bob",
      computerService: { executeAction: bobExec },
    });

    await alice.desktopService.handleCommand("click 50 50");
    expect(aliceExec).toHaveBeenCalledTimes(1);

    await expect(bob.desktopService.handleCommand("click 60 60")).rejects.toBe(
      "Unable to modify desktop, alice currently holds it. Ask them to release it if you need it.",
    );
    expect(bobExec).not.toHaveBeenCalled();

    const bobStatus = await bob.desktopService.handleCommand("");
    expect(bobStatus).toContain("Claim: held by alice");
  });

  test("stale claim (>10 min idle) is silently taken by the next agent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));

    const claim = createDesktopClaimService();
    const alice = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: vi.fn(async () => {}) },
    });
    const bobExec = vi.fn(async () => {});
    const bob = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "bob",
      computerService: { executeAction: bobExec },
    });

    await alice.desktopService.handleCommand("click 50 50");
    expect(claim.getStatus()?.agentUsername).toBe("alice");

    vi.setSystemTime(new Date("2026-01-01T12:11:00Z"));

    await bob.desktopService.handleCommand("click 60 60");
    expect(bobExec).toHaveBeenCalledTimes(1);
    expect(claim.getStatus()?.agentUsername).toBe("bob");
  });

  test("release subcommand frees the claim for other agents", async () => {
    const claim = createDesktopClaimService();
    const alice = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: vi.fn(async () => {}) },
    });
    const bobExec = vi.fn(async () => {});
    const bob = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "bob",
      computerService: { executeAction: bobExec },
    });

    await alice.desktopService.handleCommand("click 10 10");
    await alice.desktopService.handleCommand("release");
    expect(claim.getStatus()).toBeNull();

    await bob.desktopService.handleCommand("click 20 20");
    expect(bobExec).toHaveBeenCalledTimes(1);
  });

  test("release no-ops when called by an agent that doesn't hold the claim", async () => {
    const claim = createDesktopClaimService();
    const alice = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: vi.fn(async () => {}) },
    });
    const bob = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "bob",
    });

    await alice.desktopService.handleCommand("click 10 10");

    await expect(bob.desktopService.handleCommand("release")).resolves.toBe(
      "Desktop is held by alice, not you. Nothing to release.",
    );
    expect(claim.getStatus()?.agentUsername).toBe("alice");
  });

  test("agent shutdown cleanup releases its claim", async () => {
    const claim = createDesktopClaimService();
    const alice = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: vi.fn(async () => {}) },
    });

    await alice.desktopService.handleCommand("click 5 5");
    expect(claim.getStatus()?.agentUsername).toBe("alice");

    alice.desktopService.cleanup();
    expect(claim.getStatus()).toBeNull();
  });

  test("screenshot does not claim the desktop", async () => {
    const claim = createDesktopClaimService();
    const { desktopService } = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: {
        captureScaledScreenshot: vi.fn(() =>
          Promise.resolve({ base64: "x", filepath: "/tmp/s.png" }),
        ),
      },
    });

    await desktopService.handleCommand("screenshot");
    expect(claim.getStatus()).toBeNull();
  });

  test("operator rejection releases a claim acquired by this batch", async () => {
    const claim = createDesktopClaimService();
    const { desktopService } = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: vi.fn(async () => {}) },
    });

    (getConfirmation as any).mockResolvedValueOnce(false);

    await desktopService.confirmAndExecuteActions("", [
      {
        id: "call-1",
        name: "computer",
        input: { actions: [{ action: "left_click", coordinate: [10, 20] }] },
      },
    ]);

    expect(claim.getStatus()).toBeNull();
  });

  test("operator rejection preserves a claim that was already held before this batch", async () => {
    const claim = createDesktopClaimService();
    const { desktopService } = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: vi.fn(async () => {}) },
    });

    // Pre-existing claim from an earlier shell action — must survive a
    // later rejected LLM batch since alice already had the desktop.
    await desktopService.handleCommand("click 5 5");
    expect(claim.getStatus()?.agentUsername).toBe("alice");

    (getConfirmation as any).mockResolvedValueOnce(false);

    await desktopService.confirmAndExecuteActions("", [
      {
        id: "call-2",
        name: "computer",
        input: { actions: [{ action: "left_click", coordinate: [10, 20] }] },
      },
    ]);

    expect(claim.getStatus()?.agentUsername).toBe("alice");
  });

  test("LLM tool path blocks all actions in batch with conflict error when held by another agent", async () => {
    const claim = createDesktopClaimService();
    const aliceExec = vi.fn(async () => {});
    const alice = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "alice",
      computerService: { executeAction: aliceExec },
    });
    const bobExec = vi.fn(async () => {});
    const bob = buildDesktopService({
      desktopClaimService: claim,
      agentUsername: "bob",
      computerService: {
        executeAction: bobExec,
        captureScaledScreenshot: vi.fn(() =>
          Promise.resolve({ base64: "x", filepath: "/tmp/s.png" }),
        ),
      },
    });

    await alice.desktopService.handleCommand("click 5 5");

    await bob.desktopService.confirmAndExecuteActions("", [
      {
        id: "call-1",
        name: "computer",
        input: { actions: [{ action: "left_click", coordinate: [10, 20] }] },
      },
    ]);

    expect(bobExec).not.toHaveBeenCalled();
    expect(bob.contextManager.appendDesktopError).toHaveBeenCalledWith(
      "call-1",
      "Unable to modify desktop, alice currently holds it. Ask them to release it if you need it.",
    );
  });
});
