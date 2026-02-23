import fs from "fs";
import path from "path";
import { AgentConfig } from "../agent/agentConfig.js";
import { lookCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ShellWrapper } from "../command/shellWrapper.js";
import { ContextManager } from "../llm/contextManager.js";
import { LlmRole } from "../llm/llmDtos.js";
import { LLMService } from "../llm/llmService.js";
import { ModelService } from "../services/modelService.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function createLookService(
  { agentConfig }: AgentConfig,
  modelService: ModelService,
  contextManager: ContextManager,
  llmService: LLMService,
  shellWrapper: ShellWrapper,
) {
  async function handleCommand(args: string): Promise<string> {
    const trimmed = args.trim();

    // Parse --describe flag
    let describe = false;
    let filepath: string;

    if (trimmed.startsWith("--describe ")) {
      describe = true;
      filepath = trimmed.slice("--describe ".length).trim();
    } else {
      filepath = trimmed;
    }

    if (!filepath) {
      return `Usage: ${lookCmd.name} ${lookCmd.usage}`;
    }

    // Resolve relative paths against the shell's current working directory
    if (!path.isAbsolute(filepath)) {
      const cwd = await shellWrapper.getCurrentPath();
      if (cwd) {
        filepath = path.resolve(cwd, filepath);
      }
    }

    // Validate the agent's shellModel supports vision
    const shellModel = agentConfig().shellModel;
    const model = modelService.getLlmModel(shellModel);
    if (!model.supportsVision) {
      return `Error: Model '${shellModel}' does not support vision. ns-look requires a vision-capable model.`;
    }

    // Validate file exists
    if (!fs.existsSync(filepath)) {
      return `Error: File not found: ${filepath}`;
    }

    // Validate extension
    const ext = path.extname(filepath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return `Error: Unsupported image type '${ext}'. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`;
    }

    // Read file and encode to base64
    const fileBuffer = fs.readFileSync(filepath);
    const base64 = fileBuffer.toString("base64");
    const mimeType = MIME_TYPES[ext];

    if (describe) {
      // One-shot: send image to LLM for a text description
      const describeSystemPrompt =
        "You are an image description assistant. Describe the given image in detail, including layout, colors, text, and any notable elements. Be concise but thorough.";

      const result = await llmService.query(
        shellModel,
        describeSystemPrompt,
        [
          {
            role: LlmRole.User,
            content: [
              {
                type: "text",
                text: `Describe this image (${filepath}):`,
              },
              {
                type: "image",
                base64,
                mimeType,
              },
            ],
          },
        ],
        "look",
      );

      return `[${filepath}]\n${result.responses.join("\n")}`;
    }

    // Default: pin image into context
    contextManager.appendImage(base64, mimeType, filepath);

    // Return empty — the image message is already in context
    return "";
  }

  const registrableCommand: RegistrableCommand = {
    command: lookCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type LookService = ReturnType<typeof createLookService>;
