import OpenAI from "openai";
import type {
  FunctionTool,
  ResponseInput,
  ResponseInputContent,
  ResponseInputText,
  ResponseOutputItem,
  Tool,
  ToolChoiceFunction,
} from "openai/resources/responses/responses";

import {
  extractDesktopActions,
  formatInputWithComputerUse,
  prepareComputerUse,
} from "../../computer-use/openai-computer-use.js";
import type { ContentBlock, LlmMessage } from "../llmDtos.js";
import type { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

/** A relaxed output_text — the API accepts it as input even though the
 *  strict ResponseOutputText shape requires an `annotations` array. */
type OutputTextInput = { type: "output_text"; text: string };
type ContentPart = ResponseInputContent | OutputTextInput;

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
  const toolsDefs: Tool[] = [];
  if (useConsoleTools) {
    const functionTool: FunctionTool = {
      type: "function",
      name: tools.consoleToolOpenAI.function.name,
      description: tools.consoleToolOpenAI.function.description,
      parameters: tools.consoleToolOpenAI.function
        .parameters as FunctionTool["parameters"],
      strict: false,
    };
    toolsDefs.push(functionTool);
  }
  if (desktopConfig) {
    toolsDefs.push({ type: "computer" });
  }

  // Force console tool only when desktop is not also enabled
  let toolChoice: ToolChoiceFunction | undefined = undefined;
  if (useConsoleTools && !desktopConfig) {
    toolChoice = {
      type: "function",
      name: tools.consoleToolOpenAI.function.name,
    };
  }

  // Computer use: compute scale factor for image resizing / coordinate mapping
  const cuSetup = desktopConfig ? prepareComputerUse(desktopConfig) : undefined;

  const response = await openAI.responses.create(
    {
      model: model.versionName,
      instructions: systemMessage,
      input: (desktopConfig
        ? formatInputWithComputerUse(
            context,
            formatContentBlocks,
            formatSingleBlock,
          )
        : context.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: formatContentBlocks(m.content, m.role),
          }))) as ResponseInput,
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
  output: ResponseOutputItem[],
  tools: VendorDeps["tools"],
): string[] | undefined {
  const toolCalls = output
    .filter((item): item is Extract<ResponseOutputItem, { type: "function_call" }> =>
      item.type === "function_call",
    )
    .map((item) => ({
      type: "function",
      function: { name: item.name, arguments: item.arguments },
    }));

  return tools.getCommandsFromOpenAiToolUse(toolCalls) || undefined;
}

// --- Content formatting helpers (shared with openai-computer-use) ---

function makeTextPart(text: string, role: string): ContentPart {
  return role === "assistant"
    ? { type: "output_text", text }
    : ({ type: "input_text", text } satisfies ResponseInputText);
}

function formatContentBlocks(
  content: string | ContentBlock[],
  role: string,
): ContentPart[] {
  if (typeof content === "string") {
    return [makeTextPart(content, role)];
  }
  return content
    .map((b) => formatSingleBlock(b, role))
    .filter((p): p is ContentPart => p !== null);
}

function formatSingleBlock(
  block: ContentBlock,
  role: string,
): ContentPart | null {
  switch (block.type) {
    case "text":
      return makeTextPart(block.text, role);
    case "image":
      return {
        type: "input_image",
        image_url: `data:${block.mimeType};base64,${block.base64}`,
        detail: "auto",
      };
    case "tool_use":
      // Fallback when desktop is not enabled — include as text description
      return makeTextPart(
        `[Desktop action: ${JSON.stringify(block.input)}]`,
        role,
      );
    case "tool_result":
      return makeTextPart("[Desktop screenshot]", role);
    case "audio":
      return null;
    default:
      return null;
  }
}
