/**
 * A bad play on words, but this is like lynx but for LLMs..
 */

import { exec } from "child_process";
import * as crypto from "crypto";
import * as https from "https";
import * as os from "os";
import * as config from "../config.js";
import { createCostTracker } from "../llm/costTracker.js";
import { createLLModels } from "../llm/llModels.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { createLLMService } from "../llm/llmService.js";
import { createOutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";

export function createLLMynx(
  llmService: ReturnType<typeof createLLMService>,
  costTracker: ReturnType<typeof createCostTracker>,
  llModels: ReturnType<typeof createLLModels>,
  output: ReturnType<typeof createOutputService>,
) {
  // Flag to control LLM-based content reduction - set to false for pagination instead
  const USE_LLM_REDUCTION = false;

  let debugMode = false;

  // Single pagination state since we only navigate one page at a time
  let _currentPagination: {
    url: string;
    pages: string[];
    currentPage: number;
    contentHash: string;
  } | null = null;

  const _reducedContentCache = new Map<
    string,
    {
      contentHash: string;
      reducedContent: string;
    }
  >();

  /** Links numbers are unique in the context so that `llmynx follow <linknum>` can be called on all previous output */
  const _globalLinkMap = new Map<number, string>();
  const _globalUrlMap = new Map<string, number>();
  let _nextGlobalLinkNum = 1;

  async function handleCommand(cmdArgs: string): Promise<string> {
    outputInDebugMode("LLMYNX DEBUG MODE IS ON");

    const argParams = cmdArgs.split(" ");

    if (!argParams[0]) {
      argParams[0] = "help";
    }

    switch (argParams[0]) {
      case "help":
        return `llmynx <command> (results will be paginated to ${config.webTokenMax} tokens per page)
  search <query>: Search google for the given query
  open <url>: Opens the given url. Links are represented as numbers in brackets which prefix the word they are linking like [123]
  follow <link number>: Opens the given link number. Link numbers work across all previous outputs
  links <url> <page>: Lists only the links for the given url. Use the page number to get more links
  more: Show the next page of content from the last URL opened
  
*llmynx does not support input. Use llmynx or curl to call APIs directly*`;
      case "search": {
        // trim quotes
        const query = argParams.slice(1).join(" ").replace(/^"|"$/g, "");

        return await callGoogleSearchApi(query);
        /*return await loadUrlContent(
        "https://www.google.com/search?q=" + encodeURIComponent(query),
        true,
        true,
      );*/
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
      case "more": {
        return showMoreContent();
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
        `No need to reduce, link Content is already under ${config.webTokenMax} tokens.`,
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

    // Get the token size of the output
    const contentTokenSize = utilities.getTokenCount(content);
    const linksTokenSize = utilities.getTokenCount(links);
    const contentHash = createContentHash(originalContent);

    outputInDebugMode(
      `Content Token size: ${contentTokenSize}\n` +
        `Links Token size: ${linksTokenSize}`,
    );

    if (USE_LLM_REDUCTION) {
      // Original LLM reduction logic
      let usingCachedContent = false;

      if (_reducedContentCache.has(url)) {
        const cachedContent = _reducedContentCache.get(url)!;
        if (cachedContent.contentHash === contentHash) {
          content = cachedContent.reducedContent;
          usingCachedContent = true;
        }
      }

      if (usingCachedContent) {
        output.comment(
          "No changes detected, using already cached reduced content",
        );
      } else if (contentTokenSize > config.webTokenMax) {
        content = await reduceContent(url, content, contentTokenSize);

        _reducedContentCache.set(url, {
          contentHash,
          reducedContent: content,
        });
      } else {
        output.comment(
          `No need to reduce, content is already under ${config.webTokenMax} tokens.`,
        );
      }
    } else {
      // New pagination logic
      if (contentTokenSize > config.webTokenMax) {
        const pages = breakContentIntoPages(content, config.webTokenMax);

        // Set up pagination state
        _currentPagination = {
          url: url,
          pages: pages,
          currentPage: 1,
          contentHash: contentHash,
        };

        // Get first page content
        content = pages[0];

        // Add pagination info if there are more pages
        if (pages.length > 1) {
          content += `\n\n--- More content available. Use 'llmynx more' to view page 2 of ${pages.length} ---`;
        }

        output.comment(
          `Content is ${contentTokenSize} tokens. Showing page 1 of ${pages.length}. Use 'llmynx more' for next page.`,
        );
      } else {
        output.comment(
          `Content is already under ${config.webTokenMax} tokens.`,
        );
      }
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
    return new Promise<string>((resolve, reject) => {
      // Option here to output the content and links separately, might be useful in future
      // mode == RunMode.Content ? "-nolist" : "-listonly";
      const modeParams = "";

      const ifWindows = os.platform() === "win32" ? "wsl " : "";
      const timeoutSecs = config.shellCommand.timeoutSeconds;

      exec(
        `${ifWindows}timeout ${timeoutSecs}s lynx -dump ${modeParams} "${url}"`,
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

          if (output.includes("Exiting via interrupt")) {
            reject("Timed out loading URL: May be inaccessible");
          } else {
            resolve(output);
          }
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
    const model = llModels.get(config.agent.webModel);

    // For example if context is 16k, and max tokens is 2k, 3k with 1.5x overrun
    // That would be 3k for the current compressed content, 10k for the chunk, and 3k for the output
    let tokenChunkSize = model.maxTokens - config.webTokenMax * 2 * 1.5;
    if (linkPageAsContent) {
      tokenChunkSize = config.webTokenMax;
    }

    outputInDebugMode(
      `Token max chunk size: ${tokenChunkSize}. Total content size: ${contentTokenSize}`,
    );

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

      if (pieceCount == 1) {
        output.comment(
          `Reducing content from ${contentTokenSize} tokens to under ${config.webTokenMax} tokens with ${model.key}...`,
        );
      } else {
        output.comment(
          `Processing Piece ${i + 1} of ${pieceCount} with ${model.key}...`,
        );

        outputInDebugMode(
          `  Reduced output tokens: ${utilities.getTokenCount(reducedOutput)}\n` +
            `  Current Piece tokens: ${utilities.getTokenCount(pieceStr)}`,
        );
      }

      reducedOutput = await llmReduce(
        url,
        reducedOutput,
        i + 1,
        pieceCount,
        pieceStr,
        contentTokenSize,
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
    contentTokenSize: number,
  ) {
    let systemMessage = "";
    let content = "";

    if (pieceTotal === 1) {
      systemMessage = `The web page "${url}" content that is currently ${contentTokenSize} tokens needs to be reduced down to around ${config.webTokenMax} tokens.
Links are represented as numbers in brackets, for example [4]. Keep links in the reduced output'
Try to prioritize content of substance and primary navigation links over advertising content.`;

      content = `Web Page Content:
${pieceStr}

Please reduce the content above to around ${config.webTokenMax} tokens while maintaining relevant links in brackets like [4].`;
    } else {
      systemMessage = `You will be iteratively fed the web page "${url}" broken into ${pieceTotal} pieces.
Each 'Web Page Piece' should be merged with the  in order 'Current Reduced Content' to maintain the meaning of the page while reducing verbosity and duplication.
The final output should be around ${config.webTokenMax} tokens. 
Links are represented as numbers in brackets, for example [4]. Try not to remove them in the 'Final Merged Content'
Try to prioritize content of substance over advertising content.`;

      content = `Web Page Piece ${pieceNumber} of ${pieceTotal}: 
${pieceStr}

Please merge the 'Web Page Piece' above into the 'Current Reduced Content' below while keeping the result to around ${config.webTokenMax} tokens.

Current Reduced Content: 
${reducedOutput}


Final Merged Content:
`;
    }

    const context: LlmMessage = {
      role: LlmRole.User,
      content,
    };

    return (
      await llmService.query(
        config.agent.webModel,
        systemMessage,
        [context],
        "llmynx",
      )
    )[0];
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

  function clear() {
    _globalLinkMap.clear();
    _globalUrlMap.clear();
    _nextGlobalLinkNum = 1;
    _currentPagination = null;
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

  // Helper functions for pagination
  function createContentHash(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  function breakContentIntoPages(
    content: string,
    tokensPerPage: number,
  ): string[] {
    const totalTokens = utilities.getTokenCount(content);
    const pages: string[] = [];

    if (totalTokens <= tokensPerPage) {
      pages.push(content);
      return pages;
    }

    const charactersPerToken = content.length / totalTokens;
    const charactersPerPage = Math.ceil(tokensPerPage * charactersPerToken);

    let startIndex = 0;
    while (startIndex < content.length) {
      const endIndex = Math.min(startIndex + charactersPerPage, content.length);
      pages.push(content.substring(startIndex, endIndex));
      startIndex = endIndex;
    }

    return pages;
  }

  function showMoreContent(): string {
    if (!_currentPagination) {
      return "No paginated content available. Open a URL first with 'llmynx open <url>'.";
    }

    if (_currentPagination.currentPage >= _currentPagination.pages.length) {
      return `Already at the last page (${_currentPagination.pages.length}) of content for ${_currentPagination.url}.`;
    }

    // Move to next page
    _currentPagination.currentPage++;

    let pageContent =
      _currentPagination.pages[_currentPagination.currentPage - 1];

    // Add pagination info
    if (_currentPagination.currentPage < _currentPagination.pages.length) {
      pageContent += `\n\n--- More content available. Use 'llmynx more' to view page ${_currentPagination.currentPage + 1} of ${_currentPagination.pages.length} ---`;
    }

    let result = `URL: ${_currentPagination.url} (Page ${_currentPagination.currentPage} of ${_currentPagination.pages.length})\n\n${pageContent}`;

    return storeMapSetLinks(result, "");
  }

  async function callGoogleSearchApi(query: string): Promise<string> {
    if (!config.googleApiKey) {
      throw "Error, googleApiKey is not defined";
    }

    if (!config.googleSearchEngineId) {
      throw "Error, googleSearchEngineId is not defined";
    }

    const runSearchPromise = new Promise<string>((resolve, reject) => {
      const queryParams = new URLSearchParams({
        key: config.googleApiKey!,
        cx: config.googleSearchEngineId!,
        q: query,
      }).toString();

      const options = {
        hostname: "www.googleapis.com",
        port: 443,
        path: `/customsearch/v1?${queryParams}`,
        method: "GET",
      };

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const response = JSON.parse(data);

            if (res.statusCode === 200) {
              // Format search results
              let output = `Search results for: ${query}\n\n`;

              if (response.items && response.items.length > 0) {
                for (const item of response.items) {
                  const url = item.link;
                  const globalLinkNum = registerUrl(url);

                  output += `[${globalLinkNum}] ${item.title}\n`;
                  output += `${item.snippet}\n`;
                  output += `${url}\n\n`;
                }

                output += `\nUse 'llmynx follow <link number>' to open a result.`;
              } else {
                output += "No results found.";
              }

              resolve(output);
            } else {
              reject(`Search failed with status ${res.statusCode}: ${data}`);
            }
          } catch (error) {
            reject(`Error parsing response: ${error}`);
          }
        });
      });

      req.on("error", (error) => {
        reject(`Request error: ${error.message}`);
      });

      req.end();
    });

    const result = await runSearchPromise;

    // https://developers.google.com/custom-search/v1/overview
    await costTracker.recordCost(0.005, "llmynx", "search");

    return result;
  }

  return {
    handleCommand,
    clear,
  };
}
