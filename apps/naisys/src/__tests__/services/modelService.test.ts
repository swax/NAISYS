import {
  builtInImageModels,
  builtInLlmModels,
  findLlmModel,
} from "@naisys/common";
import { HubEvents } from "@naisys/hub-protocol";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { HubClient } from "../../hub/hubClient.js";
import { createModelService } from "../../services/agent/modelService.js";

const { loadCustomModels } = vi.hoisted(() => ({ loadCustomModels: vi.fn() }));
vi.mock("@naisys/common-node", () => ({ loadCustomModels }));

describe("modelService aliases", () => {
  beforeEach(() =>
    loadCustomModels.mockReturnValue({ llmModels: [], imageModels: [] }),
  );

  test("standalone agents can use old names with custom overrides", async () => {
    const model = findLlmModel(builtInLlmModels, "claude_opus")!;
    loadCustomModels.mockReturnValue({
      llmModels: [{ ...model, key: "claude4opus", versionName: "pinned" }],
    });
    const service = createModelService(undefined);
    await service.waitForModels();
    expect(service.getLlmModel("claude4opus")).toBe(
      service.getLlmModel("claude_opus"),
    );
    expect(service.getLlmModel("claude4opus").versionName).toBe("pinned");
    expect(() => service.getLlmModel("missing")).toThrow("LLM model not found");
    expect(service.getImageModel("gptimage1high")).toBe(
      service.getImageModel("gpt_image_high"),
    );
  });

  test("hub aliases survive schema parsing and follow live model updates", async () => {
    const handlers = new Map<string, (data: unknown) => void>();
    const hub = {
      registerEvent: (event: string, handler: (data: unknown) => void) =>
        handlers.set(event, handler),
    } as unknown as HubClient;
    const service = createModelService(hub);
    const push = handlers.get(HubEvents.MODELS_UPDATED)!;
    push({
      success: true,
      llmModels: builtInLlmModels,
      imageModels: builtInImageModels,
    });
    await service.waitForModels();
    expect(service.getLlmModel("claude4sonnet").key).toBe("claude_sonnet");
    expect(service.getImageModel("gptimage1high").key).toBe("gpt_image_high");
    const model = service.getLlmModel("claude_sonnet");
    push({
      success: true,
      llmModels: [{ ...model, versionName: "next-version" }],
    });
    expect(service.getLlmModel("claude4sonnet").versionName).toBe(
      "next-version",
    );
  });
});
