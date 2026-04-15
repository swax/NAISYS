import OpenAI from "openai";

import {
  extractDesktopActions,
  formatInputWithComputerUse,
  prepareComputerUse,
} from "../../computer-use/openai-computer-use.js";
import type { ContentBlock, LlmMessage } from "../llmDtos.js";
import type { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

const clientCache = new Map<string, OpenAI>();

function getClient(apiKey: string, baseURL?: string): OpenAI {
  const cacheKey = `${baseURL || ""}|${apiKey}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new OpenAI({ baseURL, apiKey });
    clientCache.set(cacheKey, client);
  }
  return client;
}

export async function sendWithOpenAiStandard(
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

  const openAI = getClient(apiKey, model.baseUrl);

  const useConsoleTools =
    source === "console" && useToolsForLlmConsoleResponses;

  // Build tools array — console and desktop tools can coexist
  const toolsDefs: any[] = [];
  if (useConsoleTools) {
    toolsDefs.push({
      type: "function" as const,
      name: tools.consoleToolOpenAI.function.name,
      description: tools.consoleToolOpenAI.function.description,
      parameters: tools.consoleToolOpenAI.function.parameters,
      strict: false,
    });
  }
  if (desktopConfig) {
    toolsDefs.push({ type: "computer" });
  }

  // Force console tool only when desktop is not also enabled
  let toolChoice: any = undefined;
  if (useConsoleTools && !desktopConfig) {
    toolChoice = {
      type: "function" as const,
      name: tools.consoleToolOpenAI.function.name,
    };
  }

  // Computer use: compute scale factor for image resizing / coordinate mapping
  const cuSetup = desktopConfig ? prepareComputerUse(desktopConfig) : undefined;

  const response = await openAI.responses.create(
    {
      model: model.versionName,
      instructions: systemMessage,
      input: desktopConfig
        ? formatInputWithComputerUse(
            context,
            formatContentBlocks,
            formatSingleBlock,
          )
        : context.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: formatContentBlocks(m.content, m.role),
          })),
      reasoning: { effort: useThinking ? "medium" : "none" },
      tools: toolsDefs.length > 0 ? toolsDefs : undefined,
      tool_choice: toolChoice,
    },
    { signal: abortSignal },
  );

  if (!response.usage) {
    throw "Error, no usage data returned from OpenAI Responses API.";
  }

  const inputTokens = response.usage.input_tokens || 0;
  const outputTokens = response.usage.output_tokens || 0;
  const messagesTokenCount = inputTokens;
  const cacheReadTokens =
    response.usage.input_tokens_details?.cached_tokens || 0;
  const nonCachedPromptTokens = Math.max(0, inputTokens - cacheReadTokens);

  costTracker.recordTokens(
    source,
    model.key,
    nonCachedPromptTokens,
    outputTokens,
    0,
    cacheReadTokens,
  );

  // Extract desktop actions (computer_call items), scaling coordinates back to native
  const desktopActions = desktopConfig
    ? extractDesktopActions(response.output, cuSetup!.scaleFactor)
    : [];

  // Extract console commands (function_call items)
  const consoleCommands = useConsoleTools
    ? extractConsoleCommands(response.output, tools)
    : undefined;

  // Extract text
  const textParts: string[] = response.output_text
    ? [response.output_text]
    : [];

  // Desktop actions take priority (same pattern as Anthropic vendor)
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

function extractConsoleCommands(
  output: any[],
  tools: VendorDeps["tools"],
): string[] | undefined {
  const toolCalls = output
    .filter((item: any) => item.type === "function_call")
    .map((item: any) => ({
      type: "function",
      function: { name: item.name, arguments: item.arguments },
    }));

  return tools.getCommandsFromOpenAiToolUse(toolCalls) || undefined;
}

// --- Content formatting helpers (shared with openai-computer-use) ---

function formatContentBlocks(
  content: string | ContentBlock[],
  role: string,
): any[] {
  const textType = role === "assistant" ? "output_text" : "input_text";
  if (typeof content === "string") {
    return [{ type: textType, text: content }];
  }
  return content.map((b) => formatSingleBlock(b, role)).filter(Boolean);
}

function formatSingleBlock(block: ContentBlock, role: string): any | null {
  const textType = role === "assistant" ? "output_text" : "input_text";
  switch (block.type) {
    case "text":
      return { type: textType, text: block.text };
    case "image":
      return {
        type: "input_image",
        image_url: `data:${block.mimeType};base64,${block.base64}`,
      };
    case "tool_use":
      // Fallback when desktop is not enabled — include as text description
      return {
        type: textType,
        text: `[Desktop action: ${JSON.stringify(block.input)}]`,
      };
    case "tool_result":
      return { type: textType, text: "[Desktop screenshot]" };
    case "audio":
      return null;
    default:
      return null;
  }
}
