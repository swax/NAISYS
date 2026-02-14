import { ImageModelKey } from "@naisys/common";
import OpenAI from "openai";
import path from "path";
import sharp from "sharp";
import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { CostTracker } from "../llm/costTracker.js";
import * as pathService from "../services/pathService.js";
import { OutputService } from "../utils/output.js";

export function createGenImg(
  { agentConfig }: AgentConfig,
  costTracker: CostTracker,
  output: OutputService,
) {
  /** genimg "<description>" <filepath>: Generate an image with the description and save it to the file path */
  async function handleCommand(args: string): Promise<string> {
    // genimg sholdn't even be presented as an available command unless it is defined in the config
    if (!agentConfig().imageModel) {
      throw "Agent config: Error, 'imageModel' is not defined";
    }

    const argv = stringArgv(args);

    // Expected: genimg "description" /path/to/file.png
    const description = argv[1];
    const filepath = argv[2] || "";

    if (!description) {
      throw "Invalid parameters: Description in quotes and fully qualified filepath with desired image extension are required";
    }

    if (!filepath) {
      throw "Error: Filepath is required";
    }

    // Validate path is fully qualified (Unix or Windows)
    if (!path.isAbsolute(filepath)) {
      throw "Error: Filepath must be fully qualified";
    }

    pathService.ensureFileDirExists(filepath);

    const imageModelName = agentConfig().imageModel;

    if (!imageModelName) {
      throw "Error: imageModel is not defined in agent config";
    }

    await output.commentAndLog(`Generating image with ${imageModelName}...`);

    const openai = new OpenAI();

    const model = getImageModel(imageModelName);

    const response = await openai.images.generate({
      prompt: description,
      model: model.name,
      size: model.size,
      quality: model.quality,
      response_format: "b64_json",
    });

    // save to filepath
    if (!response.data || response.data.length === 0) {
      throw "Error: No image data returned from OpenAI";
    }

    const base64Image = response.data[0].b64_json;

    if (!base64Image) {
      throw 'Error: "b64_json" not found in response';
    }

    // Convert the base64 string to a buffer
    const imageBuffer = Buffer.from(base64Image, "base64");

    // Use sharp to convert the buffer and save it as a JPG file
    const fileExtension = path.extname(filepath).substring(1);

    await sharp(imageBuffer)
      /*.resize(512, 512, {
      fit: "inside",
    })*/
      .toFormat(<any>fileExtension)
      .toFile(filepath);

    // Record the cost
    await costTracker.recordCost(model.cost, "genimg", model.key);

    return "1024x1024 Image generated and saved to " + filepath;
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-genimg",
    helpText: "Generate an image from a prompt",
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type GenImg = ReturnType<typeof createGenImg>;

interface ImageModel {
  key: ImageModelKey;
  name: "dall-e-2" | "dall-e-3";
  size: "1024x1024" | "512x512" | "256x256";
  quality?: "standard" | "hd";
  cost: number;
}

const imageModels: ImageModel[] = [
  {
    key: "dalle3-1024-HD",
    name: "dall-e-3",
    size: "1024x1024",
    quality: "hd",
    cost: 0.08,
  },
  {
    key: "dalle3-1024",
    name: "dall-e-3",
    size: "1024x1024",
    cost: 0.04,
  },
  {
    key: "dalle2-1024",
    name: "dall-e-2",
    size: "1024x1024",
    cost: 0.02,
  },
  {
    key: "dalle2-512",
    name: "dall-e-2",
    size: "512x512",
    cost: 0.018,
  },
  {
    key: "dalle2-256",
    name: "dall-e-2",
    size: "256x256",
    cost: 0.016,
  },
];

function getImageModel(key: string) {
  const model = imageModels.find((m) => m.key === key);

  if (!model) {
    throw `Error, image model not found: ${key}`;
  }

  return model;
}
