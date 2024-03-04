import { exec } from "child_process";
import * as os from "os";
import * as config from "../config.js";
import { getLLModel } from "../llm/llModels.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import * as llmService from "../llm/llmService.js";
import * as output from "../utils/output.js";
import * as utilities from "../utils/utilities.js";

// A bad play on words, but this is like lynx but for LLMs..

let debugMode = false;

/** Links numbers are unique in the context so that `llmynx follow <linknum>` can be called on all previous output */
const _globalLinkMap = new Map<number, string>();
const _globalUrlMap = new Map<string, number>();
let _nextGlobalLinkNum = 1;

export async function handleCommand(cmdArgs: string) {
  outputInDebugMode("LLMYNX DEBUG MODE IS ON");

  const argParams = cmdArgs.split(" ");
  const defualtTokenMax = config.tokenMax / 8;

  if (!argParams[0]) {
    argParams[0] = "help";
  }

  switch (argParams[0]) {
    case "help":
      return `llmynx Commands: (results will be reduced to around ${defualtTokenMax})
  search <query>: Search google for the given query
  open <url>: Opens the given url. Links are represented as numbers in brackets which prefix the word they are linking like [123]
  follow <link number>: Opens the given link number. Link numbers work across all previous outputs
  links <url> <page>: Lists only the links for the given url. Use the page number to get more links`;
    case "search": {
      const query = argParams.slice(1).join(" ");

      return await loadUrl(
        "https://www.google.com/search?q=" + encodeURIComponent(query),
        2500,
        true,
      );
    }
    case "open": {
      const url = argParams[1];
      const isNumber = !isNaN(parseInt(argParams[2]));
      const tokenMax = isNumber ? parseInt(argParams[2]) : defualtTokenMax;
      return await loadUrl(url, tokenMax, false);
    }
    case "follow": {
      const linkNum = parseInt(argParams[1]);
      const isNumber = !isNaN(parseInt(argParams[2]));
      const tokenMax = isNumber ? parseInt(argParams[2]) : defualtTokenMax;

      const linkUrl = _globalLinkMap.get(linkNum);
      if (!linkUrl) {
        return "Link number not found";
      }

      return await loadUrl(linkUrl, tokenMax, true);
    }
    case "links": {
      const url = argParams[1];
      const isNumber = !isNaN(parseInt(argParams[2]));
      const pageNumber = isNumber ? parseInt(argParams[2]) : 1;
      return await loadUrl(url, 600, false, pageNumber);
    }
    // Secret command to toggle debug mode
    case "debug":
      debugMode = !debugMode;
      return "Debug mode toggled " + (debugMode ? "on" : "off");
    default:
      return "Unknown llmynx command: " + argParams[0];
  }
}

async function loadUrl(
  url: string,
  tokenMax: number,
  showUrl: boolean,
  linkPageAsContent?: number,
) {
  let content = await runLynx(url);
  let links = "";

  // Reverse find 'References: ' and cut everything after it from the content
  const refPos = content.lastIndexOf("References\n");
  if (refPos > 0) {
    links = content.slice(refPos);
    content = content.slice(0, refPos);
  }

  if (linkPageAsContent) {
    content = links;
  }

  // Get the token size of the output
  const contentTokenSize = utilities.getTokenCount(content);
  const linksTokenSize = utilities.getTokenCount(links);

  outputInDebugMode(
    `Content Token size: ${contentTokenSize}\n` +
      `Links Token size: ${linksTokenSize}`,
  );

  // Reduce content using LLM if it's over the token max
  if (contentTokenSize > tokenMax) {
    const model = getLLModel(config.agent.webModel);

    // For example if context is 16k, and max tokens is 2k, 3k with 1.5x overrun
    // That would be 3k for the current compressed content, 10k for the chunk, and 3k for the output
    let tokenChunkSize = model.maxTokens - tokenMax * 2 * 1.5;
    if (linkPageAsContent) {
      tokenChunkSize = tokenMax;
    }

    outputInDebugMode(`Token max chunk size: ${tokenChunkSize}`);

    const pieceCount = Math.ceil(contentTokenSize / tokenChunkSize);
    const pieceSize = content.length / pieceCount;
    let reducedOutput = "";

    for (let i = 0; i < pieceCount; i++) {
      const startPos = i * pieceSize;
      const pieceStr = content.substring(startPos, startPos + pieceSize);

      if (linkPageAsContent) {
        if (linkPageAsContent === i + 1) {
          return formatLinkPiece(pieceStr);
        }
        continue;
      }

      output.comment(`Processing Piece ${i + 1} of ${pieceCount}...`);

      outputInDebugMode(
        `  Reduced output tokens: ${utilities.getTokenCount(reducedOutput)}\n` +
          `  Current Piece tokens: ${utilities.getTokenCount(pieceStr)}`,
      );

      reducedOutput = await llmReduce(
        url,
        reducedOutput,
        i + 1,
        pieceCount,
        pieceStr,
        tokenMax,
      );
    }

    if (linkPageAsContent) {
      return "";
    }

    content = reducedOutput;

    const finalTokenSize = utilities.getTokenCount(reducedOutput);

    output.comment(
      `Content reduced from ${contentTokenSize} to ${finalTokenSize} tokens`,
    );
  } else {
    output.comment(`Content is already under ${tokenMax} tokens.`);
  }

  // Prefix content with url if following as otherwise the url is never shown
  if (showUrl) {
    content = `URL: ${url}\n` + content;
  }

  return storeMapSetLinks(content, links);
}

async function runLynx(url: string) {
  return new Promise<string>((resolve) => {
    // Option here to output the content and links separately, might be useful in future
    // mode == RunMode.Content ? "-nolist" : "-listonly";
    const modeParams = "";

    const ifWindows = os.platform() === "win32" ? "wsl " : "";

    exec(`${ifWindows}lynx -dump ${modeParams} "${url}"`, (error, stdout, stderr) => {
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

async function llmReduce(
  url: string,
  reducedOutput: string,
  pieceNumber: number,
  pieceTotal: number,
  pieceStr: string,
  tokenMax: number,
) {
  const systemMessage = `You will be iteratively fed the web page ${url} broken into ${pieceTotal} sequential equally sized pieces.
Each piece should be reduced into the final content in order to maintain the meaning of the page while reducing verbosity and duplication.
The final output should be around ${tokenMax} tokens. 
Don't remove links which are represented as numbers in brackets which prefix the word they are linking like [123].
Try to prioritize content of substance over advertising content.`;

  const content = `Web page piece ${pieceNumber} of ${pieceTotal}: 
${pieceStr}

Current reduced content: 
${reducedOutput}

Please merge the new piece into the existing reduced content above while keeping the result to around ${tokenMax} tokens.

Merged reduced content:
`;

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

function storeMapSetLinks(content: string, links: string) {
  // Parse out links into a map link number -> url
  const linkMap = new Map<number, string>();

  const linkLines = links.split("\n");

  for (const linkLine of linkLines) {
    const dotPos = linkLine.indexOf(".");
    if (dotPos < 0) {
      continue;
    }

    const linkNum = parseInt(linkLine.substring(0, dotPos));
    const url = linkLine.substring(dotPos + 1).trim();

    linkMap.set(linkNum, url);
  }

  // Replace local link numbers with global link numbers
  return content.replace(/\[(\d+)\]/g, (match, linkStr: string) => {
    const localLinkNum = parseInt(linkStr)!;
    const url = linkMap.get(localLinkNum)!;

    const globalLinkNum = registerUrl(url);

    return `[${globalLinkNum}]`;
  });
}

export function clear() {
  _globalLinkMap.clear();
  _globalUrlMap.clear();
  _nextGlobalLinkNum = 1;
}

function registerUrl(url: string) {
  let globalLinkNum = _globalUrlMap.get(url);

  if (!globalLinkNum) {
    globalLinkNum = _nextGlobalLinkNum;
    _nextGlobalLinkNum++;

    _globalLinkMap.set(globalLinkNum, url);
    _globalUrlMap.set(url, globalLinkNum);
  }

  return globalLinkNum;
}

function formatLinkPiece(pieceStr: string) {
  const alreadySeen = new Set<string>();
  const linkLines = pieceStr.split("\n");
  let links = "";

  for (const linkLine of linkLines) {
    const dotPos = linkLine.indexOf(".");
    if (dotPos < 0) {
      continue;
    }

    const url = linkLine.substring(dotPos + 1).trim();
    if (alreadySeen.has(url)) {
      continue;
    }
    alreadySeen.add(url);

    const globalLinkNum = registerUrl(url);

    links += `[${globalLinkNum}]${url}\n`;
  }

  return links;
}
