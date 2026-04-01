import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources";

import { ContentBlock, LlmMessage } from "../llmDtos.js";
import {
  extractDesktopActions,
  prepareComputerUse,
} from "../../computer-use/anthropic-computer-use.js";
import { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

const clientCache = new Map<string, Anthropic>();

function getClient(apiKey: string, baseURL?: string): Anthropic {
  const cacheKey = `${baseURL || ""}|${apiKey}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new Anthropic({ apiKey, baseURL });
    clientCache.set(cacheKey, client);
  }
  return client;
}

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
    desktopConfig,
  } = deps;
  const model = modelService.getLlmModel(modelKey);

  if (!apiKey) {
    throw `Error, set ${model.apiKeyVar} variable`;
  }

  const anthropic = getClient(apiKey, model.baseUrl);

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
          role: msg.role == "assistant" ? "assistant" : "user",
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

  // Build tools array — console and desktop tools can coexist
  if (source === "console" && useToolsForLlmConsoleResponses) {
    createParams.tools = [tools.consoleToolAnthropic];
    if (useThinking) {
      createParams.tool_choice = { type: "auto" };
    } else {
      createParams.tool_choice = {
        type: "tool",
        name: tools.consoleToolAnthropic.name,
      };
    }
  }

  // Computer use: add tool, resize screenshots, scale dimensions
  let desktopScaleFactor = 1;
  let desktopBetaFlag = "";

  if (desktopConfig) {
    const setup = await prepareComputerUse(
      desktopConfig,
      model.versionName,
      createParams.messages as any[],
    );
    desktopScaleFactor = setup.scaleFactor;
    desktopBetaFlag = setup.betaFlag;

    if (createParams.tools) {
      createParams.tools.push(setup.computerTool as any);
      createParams.tool_choice = { type: "auto" };
    } else {
      createParams.tools = [setup.computerTool as any];
    }
  }

  // Use beta endpoint when computer use tool is present, otherwise normal
  const msgResponse = desktopConfig
    ? await (anthropic.beta.messages.create as Function)(
        { ...createParams, betas: [desktopBetaFlag] },
        { signal: abortSignal },
      )
    : await anthropic.messages.create(createParams, { signal: abortSignal });

  // Record token usage
  if (!msgResponse.usage) {
    throw "Error, no usage data returned from Anthropic API.";
  }

  const inputTokens = msgResponse.usage.input_tokens;
  const outputTokens = msgResponse.usage.output_tokens;
  const cacheCreationTokens =
    msgResponse.usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = msgResponse.usage.cache_read_input_tokens || 0;
  const messagesTokenCount =
    inputTokens + cacheCreationTokens + cacheReadTokens;

  costTracker.recordTokens(
    source,
    model.key,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
  );

  // Extract desktop actions, scaling coordinates back to native
  const desktopActions = desktopConfig
    ? extractDesktopActions(msgResponse.content, desktopScaleFactor)
    : [];

  // Extract console commands (submit_commands tool_use blocks)
  const consoleCommands = createParams.tools
    ? tools.getCommandsFromAnthropicToolUse(msgResponse.content)
    : undefined;

  // Extract text blocks
  const textParts: string[] = msgResponse.content
    .filter((c: any) => c.type === "text" && c.text)
    .map((c: any) => c.text);

  // Desktop actions present — they take priority for the response flow.
  // Console commands (if any) are folded into the text so the model sees them
  // in context and can re-issue after the desktop actions complete.
  if (desktopActions.length > 0) {
    const allText = [...textParts, ...(consoleCommands || [])];
    return { responses: allText, messagesTokenCount, desktopActions };
  }

  if (consoleCommands) {
    return { responses: consoleCommands, messagesTokenCount };
  }

  return {
    responses: textParts.length > 0 ? textParts : [""],
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
    const isLast = index === content.length - 1;

    if (block.type === "text") {
      const textBlock: any = { type: "text", text: block.text };
      if (cachePoint && isLast) {
        textBlock.cache_control = { type: "ephemeral" };
      }
      return textBlock;
    }
    if (block.type === "audio") {
      throw new Error(
        "Anthropic does not support audio input. Use an OpenAI or Google model for audio.",
      );
    }
    if (block.type === "tool_use") {
      // Unwrap the standardized { actions: [...] } back to a single action for Anthropic
      const input =
        block.name === "computer"
          ? (block.input.actions as Record<string, unknown>[])[0]
          : block.input;
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input,
      };
    }
    if (block.type === "tool_result") {
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        ...(block.isError ? { is_error: true } : {}),
        content: block.resultContent.map((c) => {
          if (c.type === "image") {
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: c.mimeType,
                data: c.base64,
              },
            };
          }
          return { type: "text", text: c.text };
        }),
      };
    }
    // image block
    const imageBlock: any = {
      type: "image",
      source: {
        type: "base64",
        media_type: block.mimeType,
        data: block.base64,
      },
    };
    if (cachePoint && isLast) {
      imageBlock.cache_control = { type: "ephemeral" };
    }
    return imageBlock;
  });
  return blocks;
}
