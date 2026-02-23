import fs from "fs";
import path from "path";
import { AgentConfig } from "../agent/agentConfig.js";
import { listenCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ShellWrapper } from "../command/shellWrapper.js";
import { ContextManager } from "../llm/contextManager.js";
import { LlmRole } from "../llm/llmDtos.js";
import { LLMService } from "../llm/llmService.js";
import { ModelService } from "../services/modelService.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".flac",
  ".ogg",
  ".webm",
]);

const MIME_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
};

export function createListenService(
  { agentConfig }: AgentConfig,
  modelService: ModelService,
  contextManager: ContextManager,
  llmService: LLMService,
  shellWrapper: ShellWrapper,
) {
  async function handleCommand(args: string): Promise<string> {
    const trimmed = args.trim();

    // Parse --transcribe flag
    let transcribe = false;
    let filepath: string;

    if (trimmed.startsWith("--transcribe ")) {
      transcribe = true;
      filepath = trimmed.slice("--transcribe ".length).trim();
    } else {
      filepath = trimmed;
    }

    if (!filepath) {
      return `Usage: ${listenCmd.name} ${listenCmd.usage}`;
    }

    // Resolve relative paths against the shell's current working directory
    if (!path.isAbsolute(filepath)) {
      const cwd = await shellWrapper.getCurrentPath();
      if (cwd) {
        filepath = path.resolve(cwd, filepath);
      }
    }

    // Validate the agent's shellModel supports hearing
    const shellModel = agentConfig().shellModel;
    const model = modelService.getLlmModel(shellModel);
    if (!model.supportsHearing) {
      return `Error: Model '${shellModel}' does not support audio input. ns-listen requires an audio-capable model.`;
    }

    // Validate file exists
    if (!fs.existsSync(filepath)) {
      return `Error: File not found: ${filepath}`;
    }

    // Validate extension
    const ext = path.extname(filepath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return `Error: Unsupported audio type '${ext}'. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`;
    }

    // Read file and encode to base64
    const fileBuffer = fs.readFileSync(filepath);
    const base64 = fileBuffer.toString("base64");
    const mimeType = MIME_TYPES[ext];

    if (transcribe) {
      // One-shot: send audio to LLM for a text transcription
      const transcribeSystemPrompt =
        "You are an audio transcription assistant. Transcribe the given audio accurately. Include speaker labels if multiple speakers are detected. Be precise and faithful to the original audio.";

      const result = await llmService.query(
        shellModel,
        transcribeSystemPrompt,
        [
          {
            role: LlmRole.User,
            content: [
              {
                type: "text",
                text: `Transcribe this audio (${filepath}):`,
              },
              {
                type: "audio",
                base64,
                mimeType,
              },
            ],
          },
        ],
        "listen",
      );

      return `[${filepath}]\n${result.responses.join("\n")}`;
    }

    // Default: pin audio into context
    contextManager.appendAudio(base64, mimeType, filepath);

    // Return empty — the audio message is already in context
    return "";
  }

  const registrableCommand: RegistrableCommand = {
    command: listenCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type ListenService = ReturnType<typeof createListenService>;
