import OpenAI from "openai";
import { ChatCompletionCreateParamsNonStreaming } from "openai/resources";
import { ContentBlock, LlmMessage, LlmRole } from "../llmDtos.js";
import { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

export async function sendWithOpenAiCompatible(
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

  const chatRequest: ChatCompletionCreateParamsNonStreaming = {
    model: model.versionName,
    stream: false,
    reasoning_effort: useThinking ? "medium" : "none",
    messages: [
      {
        role: LlmRole.System,
        content: systemMessage,
      },
      ...context.map((m) => ({
        content: formatContentForOpenAI(m.content),
        role: m.role,
      })),
    ],
  };

  if (source === "console" && useToolsForLlmConsoleResponses) {
    chatRequest.tools = [tools.consoleToolOpenAI];
    chatRequest.tool_choice = {
      type: "function",
      function: { name: tools.consoleToolOpenAI.function.name },
    };
  }

  const chatResponse = await openAI.chat.completions.create(chatRequest, {
    signal: abortSignal,
  });

  if (!model.inputCost && !model.outputCost) {
    // Don't cost models with no costs
  }
  // Record token usage
  if (!chatResponse.usage) {
    throw "Error, no usage data returned from OpenAI API.";
  }

  const inputTokens = chatResponse.usage.prompt_tokens || 0;
  const outputTokens = chatResponse.usage.completion_tokens || 0;
  // Excludes output_tokens because it contains reasoning tokens that don't persist in context;
  // the actual response text is estimated locally by contextManager.getTokenCount()
  const messagesTokenCount = inputTokens;
  const cacheReadTokens =
    chatResponse.usage.prompt_tokens_details?.cached_tokens || 0;

  // Remove cached tokens so we only bill fresh tokens at the full input rate.
  const nonCachedPromptTokens = Math.max(0, inputTokens - cacheReadTokens);

  await costTracker.recordTokens(
    source,
    model.key,
    nonCachedPromptTokens,
    outputTokens,
    0, // OpenAI doesn't report cache write tokens separately - it's automatic
    cacheReadTokens,
  );

  if (chatRequest.tools) {
    const commandsFromTool = tools.getCommandsFromOpenAiToolUse(
      chatResponse.choices.at(0)?.message?.tool_calls,
    );

    if (commandsFromTool) {
      return { responses: commandsFromTool, messagesTokenCount };
    }
  }

  return {
    responses: [chatResponse.choices[0].message.content || ""],
    messagesTokenCount,
  };
}

const AUDIO_MIME_TO_FORMAT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

function formatContentForOpenAI(
  content: string | ContentBlock[],
): string | Array<any> {
  if (typeof content === "string") {
    return content;
  }
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "audio") {
      const format = AUDIO_MIME_TO_FORMAT[block.mimeType] || "mp3";
      return {
        type: "input_audio",
        input_audio: { data: block.base64, format },
      };
    }
    return {
      type: "image_url",
      image_url: {
        url: `data:${block.mimeType};base64,${block.base64}`,
      },
    };
  });
}
