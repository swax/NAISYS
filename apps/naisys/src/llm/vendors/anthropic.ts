import Anthropic from "@anthropic-ai/sdk";
import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
  Message,
  MessageParam,
  TextBlockParam,
  ToolUnion,
} from "@anthropic-ai/sdk/resources";
import { LlmApiType, type LlmModel } from "@naisys/common";

import {
  extractDesktopActions,
  prepareComputerUse,
} from "../../computer-use/vendors/anthropic-computer-use.js";
import type { ContentBlock, LlmMessage } from "../llmDtos.js";
import type { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

/** Anthropic's computer-use beta rejects requests that include computer tool
 *  output alongside more than one standalone image input. To stay under that
 *  limit, we disallow adding standalone images (via ns-look, ns-desktop
 *  screenshot, etc.) whenever the agent is running with the computer tool
 *  active. The model should request screenshots through the computer tool. */
export function getImageContextBlockReason(
  model: LlmModel,
  controlDesktop: boolean | undefined,
): string | undefined {
  if (
    model.apiType === LlmApiType.Anthropic &&
    model.supportsComputerUse &&
    controlDesktop
  ) {
    return "Error: Cannot add images to context while the computer tool is active (Anthropic rejects >1 image alongside computer output). Open the image on the desktop and request a screenshot via the computer tool instead.";
  }
  return undefined;
}

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

  // Computer use: add tool, scale dimensions
  let desktopScaleFactor = 1;
  let desktopBetaFlag = "";

  if (desktopConfig) {
    const setup = prepareComputerUse(desktopConfig, model.versionName);
    desktopScaleFactor = setup.scaleFactor;
    desktopBetaFlag = setup.betaFlag;

    // computerTool is a Beta tool (not in the non-beta ToolUnion) but we
    // route through the beta endpoint below — cast to appease the shared
    // createParams shape.
    const computerTool = setup.computerTool as unknown as ToolUnion;
    if (createParams.tools) {
      createParams.tools.push(computerTool);
      createParams.tool_choice = { type: "auto" };
    } else {
      createParams.tools = [computerTool];
    }
  }

  // Use beta endpoint when computer use tool is present, otherwise normal.
  // The beta endpoint uses BetaMessageCreateParams/BetaMessage which are
  // structurally compatible with the non-beta equivalents for our usage;
  // cast here rather than duplicating the request construction.
  const msgResponse: Message = desktopConfig
    ? ((await anthropic.beta.messages.create(
        { ...createParams, betas: [desktopBetaFlag] } as unknown as Parameters<
          typeof anthropic.beta.messages.create
        >[0],
        { signal: abortSignal },
      )) as unknown as Message)
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

  // Extract desktop actions, scaling coordinates back to viewport space
  const desktopActions = desktopConfig
    ? extractDesktopActions(msgResponse.content, desktopScaleFactor)
    : [];

  // Extract console commands (submit_commands tool_use blocks)
  const consoleCommands = createParams.tools
    ? tools.getCommandsFromAnthropicToolUse(msgResponse.content)
    : undefined;

  // Extract text blocks
  const textParts: string[] = msgResponse.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => (c as Extract<typeof c, { type: "text" }>).text);

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
): string | Array<ContentBlockParam> {
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
      const textBlock: TextBlockParam = { type: "text", text: block.text };
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
        type: "tool_use" as const,
        id: block.id,
        name: block.name,
        input,
      };
    }
    if (block.type === "tool_result") {
      return {
        type: "tool_result" as const,
        tool_use_id: block.toolUseId,
        ...(block.isError ? { is_error: true } : {}),
        content: block.resultContent.map((c) => {
          if (c.type === "image") {
            return {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: c.mimeType as Base64ImageSource["media_type"],
                data: c.base64,
              },
            };
          }
          return { type: "text" as const, text: c.text };
        }),
      };
    }
    // image block — cast mimeType because our ImageBlock uses `string` while
    // Anthropic narrows to a literal union of supported media types
    const imageBlock: ImageBlockParam = {
      type: "image",
      source: {
        type: "base64",
        media_type: block.mimeType as Base64ImageSource["media_type"],
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
