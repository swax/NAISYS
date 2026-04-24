import type {
  Content,
  CreateChatParameters,
  FunctionDeclaration,
  Part,
  Tool,
} from "@google/genai";
import {
  Environment,
  FunctionCallingConfigMode,
  GoogleGenAI,
} from "@google/genai";

import {
  extractDesktopActions,
  formatContextWithComputerUse,
  isGoogleComputerUseAction,
} from "../../computer-use/vendors/google-computer-use.js";
import type { ContentBlock, LlmMessage } from "../llmDtos.js";
import type { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

const clientCache = new Map<string, GoogleGenAI>();

function getClient(apiKey: string, baseUrl?: string): GoogleGenAI {
  const cacheKey = `${baseUrl || ""}|${apiKey}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: baseUrl ? { baseUrl } : undefined,
    });
    clientCache.set(cacheKey, client);
  }
  return client;
}

export async function sendWithGoogle(
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

  const ai = getClient(apiKey, model.baseUrl);

  const lastMessage = context[context.length - 1];

  // Build history from context (excluding last message)
  let history: Content[];
  // Last message parts formatted for sendMessage
  let cuLastMessageParts: Part[] | undefined;
  if (desktopConfig) {
    // Format ALL messages in one pass so the tool_use ID → name map is
    // available when processing tool_result blocks (which may be the last message)
    const allFormatted = formatContextWithComputerUse(
      context,
      desktopConfig,
      formatPartsForGoogle,
    );
    history = allFormatted.slice(0, -1);
    cuLastMessageParts = allFormatted[allFormatted.length - 1]?.parts;
  } else {
    history = context
      .filter((m) => m !== lastMessage)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: formatPartsForGoogle(m.content),
      }));
  }

  // Prepare config with system instruction
  const chatConfig: CreateChatParameters = {
    model: model.versionName,
    config: {
      systemInstruction: systemMessage,
      thinkingConfig: {
        // -1 is dynamic thinking, 0 is no thinking
        thinkingBudget: useThinking ? -1 : 0,
      },
    },
    history,
  };

  // Build tools array — console and desktop tools can coexist
  const toolsDefs: Tool[] = [];

  if (source === "console" && useToolsForLlmConsoleResponses) {
    // consoleToolGoogle's properties are typed as a union per
    // multipleCommandsEnabled; FunctionDeclaration expects a flat record,
    // so go through unknown to reconcile
    toolsDefs.push({
      functionDeclarations: [
        tools.consoleToolGoogle as unknown as FunctionDeclaration,
      ],
    });
  }

  if (desktopConfig) {
    toolsDefs.push({
      computerUse: { environment: Environment.ENVIRONMENT_BROWSER },
    });
  }

  if (toolsDefs.length > 0) {
    chatConfig.config!.tools = toolsDefs;

    // Only force console tool when desktop is not also enabled
    if (
      source === "console" &&
      useToolsForLlmConsoleResponses &&
      !desktopConfig
    ) {
      chatConfig.config!.toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
        },
      };
    }
  }

  const chat = ai.chats.create(chatConfig);

  const lastMessageParts =
    cuLastMessageParts || formatPartsForGoogle(lastMessage.content);

  const result = await chat.sendMessage({
    message: lastMessageParts,
    // Merge abortSignal into the full config — passing { abortSignal } alone
    // replaces the chat config entirely, losing tools and other settings
    config: abortSignal ? { ...chatConfig.config!, abortSignal } : undefined,
  });

  // Use actual token counts from Google API response
  if (!result.usageMetadata) {
    throw "Error, no usage metadata returned from Google API.";
  }

  const inputTokens = result.usageMetadata.promptTokenCount || 0;
  const outputTokens = result.usageMetadata.candidatesTokenCount || 0;
  // Excludes output_tokens because it contains thinking tokens that don't persist in context;
  // the actual response text is estimated locally by contextManager.getTokenCount()
  const messagesTokenCount = inputTokens;
  const cachedTokenCount = result.usageMetadata.cachedContentTokenCount || 0;

  costTracker.recordTokens(
    source,
    model.key,
    inputTokens - cachedTokenCount,
    outputTokens,
    0, // Cache write tokens (not separately reported)
    cachedTokenCount, // Cache read tokens
  );

  // Extract desktop actions from raw response parts (not result.functionCalls)
  // so we can capture thoughtSignature which lives at the Part level
  const responseParts: Part[] = result.candidates?.[0]?.content?.parts || [];

  const desktopActions = desktopConfig
    ? extractDesktopActions(
        responseParts.filter(
          (p) =>
            p.functionCall && isGoogleComputerUseAction(p.functionCall.name!),
        ),
        desktopConfig.displayWidth,
        desktopConfig.displayHeight,
      )
    : [];

  // Extract console commands (non-computer-use function calls)
  const consoleFunctionCalls = responseParts
    .filter(
      (p) =>
        p.functionCall && !isGoogleComputerUseAction(p.functionCall.name!),
    )
    .map((p) => p.functionCall!);
  const consoleCommands = chatConfig.config!.tools
    ? tools.getCommandsFromGoogleToolUse(consoleFunctionCalls)
    : undefined;

  // Extract text directly from response parts to avoid the SDK warning
  // that fires when accessing .text on a response containing function calls
  const textParts: string[] = [];
  const candidateParts = result.candidates?.[0]?.content?.parts;
  if (candidateParts) {
    for (const part of candidateParts) {
      if (part.text) {
        textParts.push(part.text);
      }
    }
  }

  // Desktop actions take priority (same pattern as Anthropic/OpenAI vendors)
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

function formatPartsForGoogle(content: string | ContentBlock[]): Part[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return content
    .map((block): Part | null => {
      if (block.type === "text") {
        return { text: block.text };
      }
      if (block.type === "image" || block.type === "audio") {
        return {
          inlineData: { mimeType: block.mimeType, data: block.base64 },
        };
      }
      if (block.type === "tool_use") {
        return { text: `[Desktop action: ${JSON.stringify(block.input)}]` };
      }
      if (block.type === "tool_result") {
        return { text: "[Desktop screenshot]" };
      }
      return null;
    })
    .filter((p): p is Part => p !== null);
}
