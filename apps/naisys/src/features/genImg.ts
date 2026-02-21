import type { ImageModel } from "@naisys/common";
import OpenAI from "openai";
import path from "path";
import sharp from "sharp";
import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import { genImgCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { CostTracker } from "../llm/costTracker.js";
import * as pathService from "../services/pathService.js";
import { OutputService } from "../utils/output.js";

export function createGenImg(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  costTracker: CostTracker,
  output: OutputService,
  getImageModel: (key: string) => ImageModel,
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

    const model = getImageModel(imageModelName);

    const apiKey = model.apiKeyVar
      ? globalConfig().variableMap[model.apiKeyVar]
      : undefined;

    if (!apiKey) {
      throw `Error, set ${model.apiKeyVar} variable`;
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: model.baseUrl,
    });

    const response = await openai.images.generate({
      prompt: description,
      model: model.versionName,
      size: model.size as "1024x1024",
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
    command: genImgCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type GenImg = ReturnType<typeof createGenImg>;
