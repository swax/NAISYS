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

const _contentCache = new Map<
  string,
  {
    originalContent: string;
    reducedContent: string;
  }
>();

/** Links numbers are unique in the context so that `llmynx follow <linknum>` can be called on all previous output */
const _globalLinkMap = new Map<number, string>();
const _globalUrlMap = new Map<string, number>();
let _nextGlobalLinkNum = 1;

export async function handleCommand(cmdArgs: string): Promise<string> {
  outputInDebugMode("LLMYNX DEBUG MODE IS ON");

  const argParams = cmdArgs.split(" ");

  if (!argParams[0]) {
    argParams[0] = "help";
  }

  switch (argParams[0]) {
    case "help":
      return `llmynx <command> (results will be reduced to around ${config.webTokenMax} tokens)
  search <query>: Search google for the given query
  open <url>: Opens the given url. Links are represented as numbers in brackets which prefix the word they are linking like [123]
  follow <link number>: Opens the given link number. Link numbers work across all previous outputs
  links <url> <page>: Lists only the links for the given url. Use the page number to get more links
  
*llmynx does not support input. Use llmynx or curl to call APIs directly*`;
    case "search": {
      const query = argParams.slice(1).join(" ");

      return await loadUrlContent(
        "https://www.google.com/search?q=" + encodeURIComponent(query),
        true,
        true,
      );
    }
    case "open": {
      const url = argParams[1];
      return await loadUrlContent(url, false, true);
    }
    case "follow": {
      const linkNum = parseInt(argParams[1]);

      const linkUrl = _globalLinkMap.get(linkNum);
      if (!linkUrl) {
        return "Link number not found";
      }

      return await loadUrlContent(linkUrl, true, false);
    }
    case "links": {
      const url = argParams[1];
      const isNumber = !isNaN(parseInt(argParams[2]));
      const pageNumber = isNumber ? parseInt(argParams[2]) : 1;
      return await loadUrlLinks(url, pageNumber);
    }
    // Secret command to toggle debug mode
    case "debug":
      debugMode = !debugMode;
      return "Debug mode toggled " + (debugMode ? "on" : "off");
    default:
      return (
        "Error, unknown command. See valid commands below:\n" +
        (await handleCommand("help"))
      );
  }
}

/** The content here is not reduced by an LLM, just a paged list of global links is returned */
async function loadUrlLinks(url: string, linkPageAsContent: number) {
  let content = await runLynx(url);
  let links = "";

  // Reverse find 'References: ' and cut everything after it from the content
  const refPos = content.lastIndexOf("References\n");
  if (refPos > 0) {
    links = content.slice(refPos);
    content = "";
  } else {
    return "No Links Found";
  }

  // Iterate links and de-duplicate
  const linkLines = links.split("\n");
  const linkSet = new Set<string>();
  for (const linkLine of linkLines) {
    const dotPos = linkLine.indexOf(".");
    if (dotPos < 0) {
      continue;
    }

    const url = linkLine.substring(dotPos + 1).trim();

    if (!linkSet.has(url)) {
      linkSet.add(url);
      content += url + "\n";
    }
  }

  // Get the token size of the output
  const linksTokenSize = utilities.getTokenCount(content);

  outputInDebugMode(`Links Token size: ${linksTokenSize}`);

  // Reduce content using LLM if it's over the token max
  if (linksTokenSize > config.webTokenMax) {
    content = await reduceContent(
      url,
      content,
      linksTokenSize,
      linkPageAsContent,
    );
  } else {
    output.comment(
      `Link Content is already under ${config.webTokenMax} tokens.`,
    );

    content = globalizeLinkList(content);
  }

  return content;
}

async function loadUrlContent(
  url: string,
  showUrl: boolean,
  showFollowHint: boolean,
) {
  const originalContent = await runLynx(url);
  let content = originalContent;
  let links = "";

  // Reverse find 'References: ' and cut everything after it from the content
  const refPos = content.lastIndexOf("References\n");
  if (refPos > 0) {
    links = content.slice(refPos);
    content = content.slice(0, refPos);
  }

  let usingCachedContent = false;

  if (_contentCache.has(url)) {
    const cachedContent = _contentCache.get(url)!;
    if (cachedContent.originalContent === originalContent) {
      content = cachedContent.reducedContent;
      usingCachedContent = true;
    }
  }

  // Get the token size of the output
  const contentTokenSize = utilities.getTokenCount(content);
  const linksTokenSize = utilities.getTokenCount(links);

  outputInDebugMode(
    `Content Token size: ${contentTokenSize}\n` +
      `Links Token size: ${linksTokenSize}`,
  );

  // Reduce content using LLM if it's over the token max
  if (usingCachedContent) {
    output.comment("No changes detected, using already cached reduced content");
  } else if (contentTokenSize > config.webTokenMax) {
    content = await reduceContent(url, content, contentTokenSize);

    _contentCache.set(url, {
      originalContent,
      reducedContent: content,
    });
  } else {
    output.comment(`Content is already under ${config.webTokenMax} tokens.`);
  }

  // Prefix content with url if following as otherwise the url is never shown
  if (showUrl) {
    content = `URL: ${url}\n\n` + content;
  }

  if (showFollowHint) {
    content +=
      "\n\nLinks are in brackets. Use `llmynx follow <link number>` to follow a link.";
  }

  return storeMapSetLinks(content, links);
}

async function runLynx(url: string) {
  return new Promise<string>((resolve) => {
    // Option here to output the content and links separately, might be useful in future
    // mode == RunMode.Content ? "-nolist" : "-listonly";
    const modeParams = "";

    const ifWindows = os.platform() === "win32" ? "wsl " : "";

    exec(
      `${ifWindows}lynx -dump ${modeParams} "${url}"`,
      (error, stdout, stderr) => {
        let output = "";

        if (stdout) {
          output += stdout;
        }

        // I've only seen either/or, but just in case
        if (stdout && stderr) {
          output += "\nError:\n";
        }

        if (stderr) {
          output += stderr;
        }

        resolve(output);
      },
    );
  });
}

async function reduceContent(
  url: string,
  content: string,
  contentTokenSize: number,
  linkPageAsContent?: number,
) {
  const model = getLLModel(config.agent.webModel);

  // For example if context is 16k, and max tokens is 2k, 3k with 1.5x overrun
  // That would be 3k for the current compressed content, 10k for the chunk, and 3k for the output
  let tokenChunkSize = model.maxTokens - config.webTokenMax * 2 * 1.5;
  if (linkPageAsContent) {
    tokenChunkSize = config.webTokenMax;
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
        return globalizeLinkList(pieceStr);
      }
      continue;
    }

    output.comment(
      `Processing Piece ${i + 1} of ${pieceCount} with ${model.key}...`,
    );

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
    );
  }

  if (linkPageAsContent) {
    return "";
  }

  const finalTokenSize = utilities.getTokenCount(reducedOutput);

  output.comment(
    `Content reduced from ${contentTokenSize} to ${finalTokenSize} tokens`,
  );

  return reducedOutput;
}

async function llmReduce(
  url: string,
  reducedOutput: string,
  pieceNumber: number,
  pieceTotal: number,
  pieceStr: string,
) {
  const systemMessage = `You will be iteratively fed the web page "${url}" broken into ${pieceTotal} pieces.
Each 'Web Page Piece' should be merged with the  in order 'Current Reduced Content' to maintain the meaning of the page while reducing verbosity and duplication.
The final output should be around ${config.webTokenMax} tokens. 
Links are represented as numbers in brackets, for example [4]. Try not to remove them in the 'Final Merged Content'
Try to prioritize content of substance over advertising content.`;

  const content = `Web Page Piece ${pieceNumber} of ${pieceTotal}: 
${pieceStr}

Please merge the 'Web Page Piece' above into the 'Current Reduced Content' below while keeping the result to around ${config.webTokenMax} tokens.

Current Reduced Content: 
${reducedOutput}


Final Merged Content:
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

function globalizeLinkList(pieceStr: string) {
  const alreadySeen = new Set<string>();
  const linkLines = pieceStr.split("\n");
  let globalLinks = "";

  for (const linkLine of linkLines) {
    const url = linkLine.trim();

    if (!url || alreadySeen.has(url)) {
      continue;
    }
    alreadySeen.add(url);

    const globalLinkNum = registerUrl(url);

    globalLinks += `[${globalLinkNum}]${url}\n`;
  }

  return globalLinks;
}
