/**
 * A bad play on words, but this is like lynx but for LLMs..
 */

import { exec } from "child_process";
import * as crypto from "crypto";
import * as https from "https";
import * as os from "os";
import stringArgv from "string-argv";
import { lynxCmd } from "../command/commandDefs.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { CostTracker } from "../llm/costTracker.js";
import { OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";

export function createLynxService(
  { globalConfig }: GlobalConfig,
  costTracker: CostTracker,
  output: OutputService,
) {
  let debugMode = false;

  // Single pagination state since we only navigate one page at a time
  let _currentPagination: {
    url: string;
    pages: string[];
    currentPage: number;
    contentHash: string;
  } | null = null;

  /** Links numbers are unique in the context so that `ns-lynx follow <linknum>` can be called on all previous output */
  const _globalLinkMap = new Map<number, string>();
  const _globalUrlMap = new Map<string, number>();
  let _nextGlobalLinkNum = 1;

  async function handleCommand(cmdArgs: string): Promise<string> {
    outputInDebugMode("LYNX DEBUG MODE IS ON");

    const argv = stringArgv(cmdArgs);

    if (!argv[0]) {
      argv[0] = "help";
    }

    switch (argv[0]) {
      case "help": {
        const subs = lynxCmd.subcommands!;
        return `${lynxCmd.name} <command> (results will be paginated to ${globalConfig().webTokenMax} tokens per page)
  ${subs.search.usage}: ${subs.search.description}
  ${subs.open.usage}: ${subs.open.description}
  ${subs.follow.usage}: ${subs.follow.description}
  ${subs.links.usage}: ${subs.links.description}
  ${subs.more.usage}: ${subs.more.description}

*${lynxCmd.name} does not support input. Use ${lynxCmd.name} or curl to call APIs directly*`;
      }
      case "search": {
        const query = argv.slice(1).join(" ");

        return await callGoogleSearchApi(query);
        /*return await loadUrlContent(
        "https://www.google.com/search?q=" + encodeURIComponent(query),
        true,
        true,
      );*/
      }
      case "open": {
        const url = argv[1];
        return await loadUrlContent(url, false, true);
      }
      case "follow": {
        const linkNum = parseInt(argv[1]);

        const linkUrl = _globalLinkMap.get(linkNum);
        if (!linkUrl) {
          return "Link number not found";
        }

        return await loadUrlContent(linkUrl, true, false);
      }
      case "links": {
        const url = argv[1];
        const isNumber = !isNaN(parseInt(argv[2]));
        const pageNumber = isNumber ? parseInt(argv[2]) : 1;
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

  /** Returns a paginated list of global links for the given URL */
  async function loadUrlLinks(url: string, linkPageNumber: number) {
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

    // Paginate if over the token max
    if (linksTokenSize > globalConfig().webTokenMax) {
      const pages = breakContentIntoPages(content, globalConfig().webTokenMax);

      // Clamp page number
      const pageIndex = Math.max(
        0,
        Math.min(linkPageNumber - 1, pages.length - 1),
      );
      content = globalizeLinkList(pages[pageIndex]);

      if (pages.length > 1) {
        content += `\n--- Page ${pageIndex + 1} of ${pages.length}. Use 'ns-lynx links <url> <page>' for other pages ---`;
      }
    } else {
      output.comment(
        `No need to reduce, link Content is already under ${globalConfig().webTokenMax} tokens.`,
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

    if (contentTokenSize > globalConfig().webTokenMax) {
      const pages = breakContentIntoPages(
        content,
        globalConfig().webTokenMax,
      );

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
        content += `\n\n--- More content available. Use 'ns-lynx more' to view page 2 of ${pages.length} ---`;
      }

      output.comment(
        `Content is ${contentTokenSize} tokens. Showing page 1 of ${pages.length}. Use 'ns-lynx more' for next page.`,
      );
    } else {
      output.comment(
        `Content is already under ${globalConfig().webTokenMax} tokens.`,
      );
    }

    // Prefix content with url if following as otherwise the url is never shown
    if (showUrl) {
      content = `URL: ${url}\n\n` + content;
    }

    if (showFollowHint) {
      content +=
        "\n\nLinks are in brackets. Use `ns-lynx follow <link number>` to follow a link.";
    }

    return storeMapSetLinks(content, links);
  }

  async function runLynx(url: string) {
    return new Promise<string>((resolve, reject) => {
      // Option here to output the content and links separately, might be useful in future
      // mode == RunMode.Content ? "-nolist" : "-listonly";
      const modeParams = "";

      const ifWindows = os.platform() === "win32" ? "wsl " : "";
      const timeoutSecs = globalConfig().shellCommand.timeoutSeconds;

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
      return "No paginated content available. Open a URL first with 'ns-lynx open <url>'.";
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
      pageContent += `\n\n--- More content available. Use 'ns-lynx more' to view page ${_currentPagination.currentPage + 1} of ${_currentPagination.pages.length} ---`;
    }

    let result = `URL: ${_currentPagination.url} (Page ${_currentPagination.currentPage} of ${_currentPagination.pages.length})\n\n${pageContent}`;

    return storeMapSetLinks(result, "");
  }

  async function callGoogleSearchApi(query: string): Promise<string> {
    const googleApiKey = globalConfig().variableMap["GOOGLE_API_KEY"];

    if (!googleApiKey) {
      throw "Error, set GOOGLE_API_KEY env var";
    }

    if (!globalConfig().googleSearchEngineId) {
      throw "Error, googleSearchEngineId is not defined";
    }

    const runSearchPromise = new Promise<string>((resolve, reject) => {
      const queryParams = new URLSearchParams({
        key: googleApiKey,
        cx: globalConfig().googleSearchEngineId!,
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

                output += `\nUse 'ns-lynx follow <link number>' to open a result.`;
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
    await costTracker.recordCost(0.005, "lynx", "search");

    return result;
  }

  const registrableCommand: RegistrableCommand = {
    command: lynxCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    clear,
  };
}

export type LynxService = ReturnType<typeof createLynxService>;
