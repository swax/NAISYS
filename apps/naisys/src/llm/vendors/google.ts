import { GoogleGenAI } from "@google/genai";
import { ContentBlock, LlmMessage, LlmRole } from "../llmDtos.js";
import { QuerySources, VendorDeps } from "./vendorTypes.js";

export async function sendWithGoogle(
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

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: model.baseUrl ? { baseUrl: model.baseUrl } : undefined,
  });

  const lastMessage = context[context.length - 1];

  // Build history from context (excluding last message)
  const history = context
    .filter((m) => m !== lastMessage)
    .map((m) => ({
      role: m.role === LlmRole.Assistant ? "model" : "user",
      parts: formatPartsForGoogle(m.content),
    }));

  // Prepare config with system instruction
  const chatConfig: any = {
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

  // Add tool if console source and tools are enabled
  if (source === "console" && useToolsForLlmConsoleResponses) {
    chatConfig.config.tools = [
      {
        functionDeclarations: [tools.consoleToolGoogle],
      },
    ];

    chatConfig.config.toolConfig = {
      functionCallingConfig: {
        // Set the mode to "ANY" to force the model to use the tool response
        mode: "ANY",
      },
    };
  }

  const chat = ai.chats.create(chatConfig);

  const result = await chat.sendMessage({
    message: formatPartsForGoogle(lastMessage.content),
    config: abortSignal ? { abortSignal } : undefined,
  });

  // Use actual token counts from Google API response
  if (result.usageMetadata) {
    const inputTokenCount = result.usageMetadata.promptTokenCount || 0;
    const outputTokenCount = result.usageMetadata.candidatesTokenCount || 0;
    const cachedTokenCount = result.usageMetadata.cachedContentTokenCount || 0;

    await costTracker.recordTokens(
      source,
      model.key,
      inputTokenCount - cachedTokenCount,
      outputTokenCount,
      0, // Cache write tokens (not separately reported)
      cachedTokenCount, // Cache read tokens
    );
  } else {
    throw "Error, no usage metadata returned from Google API.";
  }

  // Check for function calls if tools were enabled
  if (chatConfig.config.tools) {
    const commandsFromTool = tools.getCommandsFromGoogleToolUse(
      result.functionCalls,
    );

    if (commandsFromTool) {
      return commandsFromTool;
    }
  }

  return [result.text || ""];
}

function formatPartsForGoogle(content: string | ContentBlock[]): Array<any> {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return content.map((block) => {
    if (block.type === "text") {
      return { text: block.text };
    }
    return {
      inlineData: { mimeType: block.mimeType, data: block.base64 },
    };
  });
}
