import { mimeFromFilename } from "@naisys/common";
import fs from "fs";
import path from "path";

import { AgentConfig } from "../agent/agentConfig.js";
import { lookCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ShellWrapper } from "../command/shellWrapper.js";
import { ContextManager } from "../llm/contextManager.js";
import { LLMService } from "../llm/llmService.js";
import { ModelService } from "../services/modelService.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

/** Detect actual MIME type from file magic bytes, ignoring the file extension */
function detectMimeType(buffer: Buffer): string | undefined {
  if (buffer.length < 12) return undefined;

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: 47 49 46 38 ("GIF8")
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return "image/gif";
  }

  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return undefined;
}

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

    // Detect actual MIME type from file content, fall back to extension
    const detectedMime = detectMimeType(fileBuffer);
    const extensionMime = mimeFromFilename(filepath);
    const mimeType = detectedMime ?? extensionMime;

    if (!mimeType) {
      return `Error: Could not determine image type for '${filepath}'.`;
    }

    // Note: if extension and content disagree, we use the detected (content-based) MIME type
    // since that's what the LLM API validates against

    if (describe) {
      // One-shot: send image to LLM for a text description
      const describeSystemPrompt =
        "You are an image description assistant. Describe the given image in detail, including layout, colors, text, and any notable elements. Be concise but thorough.";

      const result = await llmService.query(
        shellModel,
        describeSystemPrompt,
        [
          {
            role: "user",
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
