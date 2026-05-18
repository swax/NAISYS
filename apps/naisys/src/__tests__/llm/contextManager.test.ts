import { LlmApiType } from "@naisys/common";
import { describe, expect, test, vi } from "vitest";

import { createContextManager } from "../../llm/contextManager.js";
import { ContentSource } from "../../llm/llmDtos.js";
import type { DesktopAction } from "../../llm/vendors/vendorTypes.js";
import type { ModelService } from "../../services/agent/modelService.js";
import { getTokenCount } from "../../utils/utilities.js";
import {
  createMockAgentConfig,
  createMockInputMode,
  createMockLogService,
  createMockOutputService,
  createMockWorkspacesFeature,
} from "../mocks.js";

function buildContextManager(initialWorkspace = "") {
  let workspaceContext = initialWorkspace;
  const baseAgentConfig = createMockAgentConfig();
  const agentConfig = {
    ...baseAgentConfig,
    agentConfig: () => ({
      ...baseAgentConfig.agentConfig(),
      shellModel: "test-model",
      workspacesEnabled: true,
    }),
  };
  const workspaces = {
    ...createMockWorkspacesFeature(),
    getContext: vi.fn(() => workspaceContext),
  };
  const inputMode = createMockInputMode();
  inputMode.isDebug.mockReturnValue(false);
  inputMode.isLLM.mockReturnValue(true);
  const modelService = {
    getLlmModel: vi.fn(() => ({
      key: "test-model",
      label: "Test Model",
      versionName: "test-model",
      apiType: LlmApiType.Mock,
      apiKeyVar: "",
      maxTokens: 100_000,
      inputCost: 0,
      outputCost: 0,
      supportsHearing: true,
      supportsVision: true,
    })),
    getImageModel: vi.fn(),
    waitForModels: vi.fn(() => Promise.resolve()),
  } as unknown as ModelService;

  return {
    contextManager: createContextManager(
      agentConfig as any,
      modelService,
      workspaces,
      "system message",
      createMockOutputService(),
      createMockLogService(),
      inputMode,
    ),
    setWorkspaceContext: (next: string) => {
      workspaceContext = next;
    },
  };
}

describe("contextManager token count", () => {
  test("applies workspace context deltas after anchoring to API token usage", () => {
    const initialWorkspace = "workspace file contents";
    const updatedWorkspace = `${initialWorkspace}\n${"extra context ".repeat(10)}`;
    const { contextManager, setWorkspaceContext } =
      buildContextManager(initialWorkspace);

    contextManager.append("first prompt", ContentSource.ConsolePrompt);
    contextManager.setMessagesTokenCount(100);

    expect(contextManager.getTokenCount()).toBe(100);

    setWorkspaceContext(updatedWorkspace);
    expect(contextManager.getTokenCount()).toBe(
      100 + getTokenCount(updatedWorkspace) - getTokenCount(initialWorkspace),
    );

    contextManager.append("assistant reply", ContentSource.LLM);
    expect(contextManager.getTokenCount()).toBe(
      100 +
        getTokenCount(updatedWorkspace) -
        getTokenCount(initialWorkspace) +
        getTokenCount("assistant reply"),
    );
  });

  test("estimates tool_use blocks added after the API token anchor", () => {
    const { contextManager } = buildContextManager();
    const action: DesktopAction = {
      id: "tool-1",
      name: "computer",
      input: {
        actions: [
          { action: "mouse_move", coordinate: [10, 20] as [number, number] },
        ],
      },
    };

    contextManager.setMessagesTokenCount(50);
    contextManager.appendDesktopRequest("moving mouse", [action], "move mouse");

    const toolUseTokens = getTokenCount(
      [action.name, action.id, JSON.stringify(action.input)].join(" "),
    );
    expect(contextManager.getTokenCount()).toBe(
      50 + getTokenCount("moving mouse") + toolUseTokens,
    );
  });
});
