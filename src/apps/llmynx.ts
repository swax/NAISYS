import { exec } from "child_process";
import * as config from "../config.js";
import { getLLModel } from "../llm/llModels.js";
import * as output from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import * as llmService from "../llm/llmService.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";

// A bad play on words, but this is like lynx but for LLMs..

const debugMode = false;

export async function handleCommand(cmdArgs: string) {
  outputInDebugMode("LLMYNX DEBUG MODE IS ON");

  const argParams = cmdArgs.split(" ");
  const defualtTokenMax = 400;

  if (!argParams[0]) {
    argParams[0] = "help";
  }

  switch (argParams[0]) {
    case "help":
      return `llmynx Commands: (results will be reduced to the given token count which is ${defualtTokenMax} if not specified)
  search <query>: Search google for the given query
  open <url> <token_count>: Opens the given url
  follow <link number> <token_count>: Opens the given link number`;
    case "search": {
      const query = argParams.slice(1).join(" ");

      return await _getContent(
        "https://www.google.com/search?q=" + encodeURIComponent(query),
        2500,
      );
    }
    case "open": {
      const url = argParams[1];
      const isNumber = !isNaN(parseInt(argParams[2]));
      const tokenMax = isNumber ? parseInt(argParams[2]) : defualtTokenMax;
      return await _getContent(url, tokenMax);
    }
    case "follow": {
      const url = parseInt(argParams[1]);
      const isNumber = !isNaN(parseInt(argParams[2]));
      const tokenMax = isNumber ? parseInt(argParams[2]) : defualtTokenMax;
      throw new Error("Not implemented");
      //return await _getContent(url, tokenMax);
    }
    default:
      return "Unknown llmynx command: " + argParams[0];
  }
}

async function _getContent(url: string, tokenMax: number) {
  let content = await _runLynx(url);
  let links = "";

  // Reverse find 'References: ' and cut everything after it from the content
  const refPos = content.lastIndexOf("References\n");
  if (refPos > 0) {
    links = content.slice(refPos);
    content = content.slice(0, refPos);
  }

  // Get the token size of the output
  const contentTokenSize = utilities.getTokenCount(content);
  const linksTokenSize = utilities.getTokenCount(links);

  outputInDebugMode(
    `Content Token size: ${contentTokenSize}\n` +
      `Links Token size: ${linksTokenSize}`,
  );

  if (contentTokenSize < tokenMax) {
    outputInDebugMode(`Content is already under ${tokenMax} tokens.`);
    return content;
  }

  const model = getLLModel(config.agent.webModel);

  // For example if context is 16k, and max tokens is 2k, 3k with 1.5x overrun
  // That would be 3k for the current compressed content, 10k for the chunk, and 3k for the output
  const tokenChunkSize = model.maxTokens - tokenMax * 2 * 1.5;

  outputInDebugMode(`Token max chunk size: ${tokenChunkSize}`);

  const pieceCount = Math.ceil(contentTokenSize / tokenChunkSize);
  const pieceSize = content.length / pieceCount;
  let reducedOutput = "";

  for (let i = 0; i < pieceCount; i++) {
    const startPos = i * pieceSize;
    const pieceStr = content.substring(startPos, startPos + pieceSize);

    outputInDebugMode(
      `Processing Piece ${i + 1}/${pieceCount}:\n` +
        `  Reduced output tokens: ${utilities.getTokenCount(reducedOutput)}\n` +
        `  Current Piece tokens: ${utilities.getTokenCount(pieceStr)}`,
    );

    reducedOutput = await _llmReduce(
      url,
      reducedOutput,
      i + 1,
      pieceCount,
      pieceStr,
      tokenMax,
    );
  }

  const finalTokenSize = utilities.getTokenCount(reducedOutput);

  outputInDebugMode(`Final reduced output tokens: ${finalTokenSize}`);

  return reducedOutput;
}

async function _runLynx(url: string) {
  return new Promise<string>((resolve) => {
    // Option here to output the content and links separately, might be useful in future
    // mode == RunMode.Content ? "-nolist" : "-listonly";
    const modeParams = "";

    exec(`wsl lynx -dump ${modeParams} ${url}`, (error, stdout, stderr) => {
      if (error) {
        resolve(`error: ${error.message}`);
        return;
      }

      if (stderr) {
        resolve(`stderr: ${stderr}`);
        return;
      }

      resolve(stdout);
    });
  });
}

async function _llmReduce(
  url: string,
  reducedOutput: string,
  pieceNumber: number,
  pieceTotal: number,
  pieceStr: string,
  tokenMax: number,
) {
  const reducedTokenCount = utilities.getTokenCount(reducedOutput);
  const pieceTokenCount = utilities.getTokenCount(pieceStr);

  const systemMessage = `You will be iteratively fed the web page ${url} broken into ${pieceTotal} sequential equally sized pieces.
Each piece should be reduced into the final content in order to maintain the meaning of the page while reducing verbosity and duplication.
The final output should be around ${tokenMax} tokens. 
Maintain links which are represented as numbers in brackets which prefix the word they are linking. Like this: [1]link.
Try to prioritize content of substance over navigation and advertising content.`;

  const content = `Web page piece ${pieceNumber} of ${pieceTotal} (${pieceTokenCount} tokens): 
${pieceStr}

Current reduced content (${reducedTokenCount} tokens): 
${reducedOutput}

Please merge the new piece into the existing reduced content above while keeping the reduced content around ${tokenMax} tokens.

Just output the new reduced content so it can be fed into the next iteration. Thank you.`;

  const context: LlmMessage = {
    role: LlmRole.User,
    content,
  };

  return await llmService.query(
    config.agent.webModel,
    systemMessage,
    [context],
    "llmynx",
  );
}

function outputInDebugMode(msg: string) {
  if (debugMode) {
    output.comment(msg);
  }
}
