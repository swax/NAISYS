import { describe, expect, test } from "vitest";

import type { AgentConfigFile } from "../src/agent/agentConfigFile.js";
import {
  adminAgentConfig,
  applyAdminConfigInvariants,
} from "../src/agent/agentConfigFile.js";

describe("applyAdminConfigInvariants", () => {
  test("forces shellModel to none even when a real model is set", () => {
    const result = applyAdminConfigInvariants({
      ...adminAgentConfig,
      shellModel: "claude-opus-4-7",
    });
    expect(result.shellModel).toBe("none");
  });

  test("strips loop-only fields that mean nothing without a model", () => {
    const armed: AgentConfigFile = {
      ...adminAgentConfig,
      shellModel: "claude-opus-4-7",
      completeSessionEnabled: true,
      autoCompact: true,
      continuity: "full",
      commandProtection: "auto",
      multipleCommandsEnabled: true,
      workspacesEnabled: true,
      schedules: [{ name: "wake", cron: "0 * * * *", enabled: true }],
    };

    const result = applyAdminConfigInvariants(armed);

    expect(result.shellModel).toBe("none");
    expect(result.completeSessionEnabled).toBeUndefined();
    expect(result.autoCompact).toBeUndefined();
    expect(result.continuity).toBeUndefined();
    expect(result.commandProtection).toBeUndefined();
    expect(result.multipleCommandsEnabled).toBeUndefined();
    expect(result.workspacesEnabled).toBeUndefined();
    expect(result.schedules).toBeUndefined();
  });

  test("preserves console-relevant settings", () => {
    const result = applyAdminConfigInvariants({
      ...adminAgentConfig,
      title: "Ops Console",
      imageModel: "some-image-model",
      tokenMax: 50_000,
      spendLimitDollars: 10,
      spendLimitHours: 12,
      webEnabled: true,
      browserEnabled: true,
      mailEnabled: true,
      chatEnabled: true,
      wakeOnMessage: true,
      debugPauseSeconds: 30,
    });

    expect(result.title).toBe("Ops Console");
    expect(result.imageModel).toBe("some-image-model");
    expect(result.tokenMax).toBe(50_000);
    expect(result.spendLimitDollars).toBe(10);
    expect(result.spendLimitHours).toBe(12);
    expect(result.webEnabled).toBe(true);
    expect(result.browserEnabled).toBe(true);
    expect(result.mailEnabled).toBe(true);
    expect(result.chatEnabled).toBe(true);
    expect(result.wakeOnMessage).toBe(true);
    expect(result.debugPauseSeconds).toBe(30);
  });

  test("leaves the canonical adminAgentConfig unchanged", () => {
    expect(applyAdminConfigInvariants(adminAgentConfig)).toEqual(
      adminAgentConfig,
    );
  });
});
