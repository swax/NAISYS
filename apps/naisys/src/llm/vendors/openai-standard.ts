import OpenAI from "openai";
import { LlmMessage } from "../llmDtos.js";
import { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

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
  } = deps;
  const model = modelService.getLlmModel(modelKey);

  if (!apiKey) {
    throw `Error, set ${model.apiKeyVar} variable`;
  }

  const openAI = new OpenAI({
    baseURL: model.baseUrl,
    apiKey,
  });

  const useTools = source === "console" && useToolsForLlmConsoleResponses;

  const response = await openAI.responses.create(
    {
      model: model.versionName,
      instructions: systemMessage,
      input: context.map((m) => ({
        role: m.role,
        content: formatContentForResponses(m.content),
      })),
      reasoning: { effort: useThinking ? "medium" : "none" },
      tools: useTools
        ? [
            {
              type: "function" as const,
              name: tools.consoleToolOpenAI.function.name,
              description: tools.consoleToolOpenAI.function.description,
              parameters: tools.consoleToolOpenAI.function.parameters,
              strict: false,
            },
          ]
        : undefined,
      tool_choice: useTools
        ? {
            type: "function" as const,
            name: tools.consoleToolOpenAI.function.name,
          }
        : undefined,
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

  await costTracker.recordTokens(
    source,
    model.key,
    nonCachedPromptTokens,
    outputTokens,
    0,
    cacheReadTokens,
  );

  if (useTools) {
    // Convert Responses API function_call items to Chat Completions format for parsing
    const toolCalls = response.output
      .filter((item: any) => item.type === "function_call")
      .map((item: any) => ({
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      }));

    const commandsFromTool = tools.getCommandsFromOpenAiToolUse(toolCalls);

    if (commandsFromTool) {
      return { responses: commandsFromTool, messagesTokenCount };
    }
  }

  return {
    responses: [response.output_text || ""],
    messagesTokenCount,
  };
}

function formatContentForResponses(
  content: string | LlmMessage["content"],
): Array<any> {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }];
  }

  return content.map((block) => {
    if (block.type === "text") {
      return { type: "input_text", text: block.text };
    }
    return {
      type: "input_image",
      image_url: `data:${block.mimeType};base64,${block.base64}`,
    };
  });
}
