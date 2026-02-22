import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources";
import { ContentBlock, LlmMessage, LlmRole } from "../llmDtos.js";
import { QuerySources, VendorDeps } from "./vendorTypes.js";

export async function sendWithAnthropic(
  deps: VendorDeps,
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: QuerySources,
  apiKey?: string,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const {
    modelService,
    costTracker,
    tools,
    useToolsForLlmConsoleResponses,
    useThinking,
  } = deps;
  const model = modelService.getLlmModel(modelKey);

  if (!apiKey) {
    throw `Error, set ${model.apiKeyVar} variable`;
  }

  const anthropic = new Anthropic({
    apiKey,
    baseURL: model.baseUrl,
  });

  const createParams: Anthropic.MessageCreateParams = {
    model: model.versionName,
    max_tokens: 4096, // Blows up on anything higher
    messages: [
      {
        role: "user",
        content: systemMessage,
      },
      {
        role: "assistant",
        content:
          context.length === 0
            ? [
                {
                  type: "text",
                  text: "Understood",
                  cache_control: { type: "ephemeral" },
                },
              ]
            : "Understood",
      },
      ...context.map((msg) => {
        return {
          role: msg.role == LlmRole.Assistant ? "assistant" : "user",
          content: formatContentForAnthropic(msg.content, msg.cachePoint),
        } satisfies MessageParam;
      }),
    ],
  };

  if (useThinking) {
    createParams.thinking = {
      type: "enabled",
      budget_tokens: createParams.max_tokens! / 2,
    };
  }

  if (source === "console" && useToolsForLlmConsoleResponses) {
    createParams.tools = [tools.consoleToolAnthropic];
    if (useThinking) {
      createParams.tool_choice = {
        // With thinking enabled, only "auto" is supported
        type: "auto",
      };
    } else {
      createParams.tool_choice = {
        type: "tool",
        name: tools.consoleToolAnthropic.name,
      };
    }
  }

  const msgResponse = await anthropic.messages.create(createParams, {
    signal: abortSignal,
  });

  // Record token usage
  if (msgResponse.usage) {
    await costTracker.recordTokens(
      source,
      model.key,
      msgResponse.usage.input_tokens,
      msgResponse.usage.output_tokens,
      msgResponse.usage.cache_creation_input_tokens || 0,
      msgResponse.usage.cache_read_input_tokens || 0,
    );
  } else {
    throw "Error, no usage data returned from Anthropic API.";
  }

  if (createParams.tools) {
    const commandsFromTool = tools.getCommandsFromAnthropicToolUse(
      msgResponse.content,
    );

    if (commandsFromTool) {
      return commandsFromTool;
    }
  }

  return [msgResponse.content.find((c) => c.type == "text")?.text || ""];
}

function formatContentForAnthropic(
  content: string | ContentBlock[],
  cachePoint?: boolean,
): string | Array<any> {
  if (typeof content === "string") {
    if (cachePoint) {
      return [
        {
          type: "text",
          text: content,
          cache_control: { type: "ephemeral" },
        },
      ];
    }
    return content;
  }
  // ContentBlock[] — map to Anthropic content blocks
  const blocks = content.map((block, index) => {
    if (block.type === "text") {
      const textBlock: any = { type: "text", text: block.text };
      // Apply cache_control to the last block if cachePoint
      if (cachePoint && index === content.length - 1) {
        textBlock.cache_control = { type: "ephemeral" };
      }
      return textBlock;
    }
    const imageBlock: any = {
      type: "image",
      source: {
        type: "base64",
        media_type: block.mimeType,
        data: block.base64,
      },
    };
    // Apply cache_control to the last block if cachePoint
    if (cachePoint && index === content.length - 1) {
      imageBlock.cache_control = { type: "ephemeral" };
    }
    return imageBlock;
  });
  return blocks;
}
