import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources";

import { ContentBlock, LlmMessage, LlmRole } from "../llmDtos.js";
import { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

export async function sendWithAnthropic(
  deps: VendorDeps,
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: QuerySources,
  apiKey?: string,
  abortSignal?: AbortSignal,
): Promise<QueryResult> {
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
  if (!msgResponse.usage) {
    throw "Error, no usage data returned from Anthropic API.";
  }

  const inputTokens = msgResponse.usage.input_tokens;
  const outputTokens = msgResponse.usage.output_tokens;
  const cacheCreationTokens =
    msgResponse.usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = msgResponse.usage.cache_read_input_tokens || 0;
  // input_tokens only counts non-cached tokens, so add back cached portions for the full context size
  // Excludes output_tokens because it contains thinking tokens that don't persist in context;
  // the actual response text is estimated locally by contextManager.getTokenCount()
  const messagesTokenCount =
    inputTokens + cacheCreationTokens + cacheReadTokens;

  await costTracker.recordTokens(
    source,
    model.key,
    inputTokens,
    outputTokens,
    msgResponse.usage.cache_creation_input_tokens || 0,
    msgResponse.usage.cache_read_input_tokens || 0,
  );

  if (createParams.tools) {
    const commandsFromTool = tools.getCommandsFromAnthropicToolUse(
      msgResponse.content,
    );

    if (commandsFromTool) {
      return { responses: commandsFromTool, messagesTokenCount };
    }
  }

  return {
    responses: [msgResponse.content.find((c) => c.type == "text")?.text || ""],
    messagesTokenCount,
  };
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
    if (block.type === "audio") {
      throw new Error(
        "Anthropic does not support audio input. Use an OpenAI or Google model for audio.",
      );
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
