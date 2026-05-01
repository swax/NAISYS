/**
 * A bad play on words, but this is like lynx but for LLMs..
 */

import { execFile } from "child_process";
import * as os from "os";
import stringArgv from "string-argv";

import { lynxCmd } from "../command/commandDefs.js";
import type { RegistrableCommand } from "../command/commandRegistry.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import {
  breakContentIntoPages,
  createPaginationState,
} from "./webPagination.js";

export function createLynxService(
  { globalConfig }: GlobalConfig,
  output: OutputService,
) {
  let debugMode = false;

  // Single pagination state since we only navigate one page at a time
  const pagination = createPaginationState();

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
  ${subs.open.usage}: ${subs.open.description}
  ${subs.follow.usage}: ${subs.follow.description}
  ${subs.links.usage}: ${subs.links.description}
  ${subs.more.usage}: ${subs.more.description}

*${lynxCmd.name} does not support input. Use ${lynxCmd.name} or curl to call APIs directly*`;
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

    outputInDebugMode(
      `Content Token size: ${contentTokenSize}\n` +
        `Links Token size: ${linksTokenSize}`,
    );

    if (contentTokenSize > globalConfig().webTokenMax) {
      const view = pagination.setContent(
        url,
        content,
        globalConfig().webTokenMax,
      );
      content = view.content;
      if (view.totalPages > 1) {
        content += `\n\n--- More content available. Use 'ns-lynx more' to view page 2 of ${view.totalPages} ---`;
      }

      output.comment(
        `Content is ${contentTokenSize} tokens. Showing page 1 of ${view.totalPages}. Use 'ns-lynx more' for next page.`,
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
      const modeParams: string[] = [];

      const isWindows = os.platform() === "win32";
      const timeoutSecs = globalConfig().shellCommand.timeoutSeconds;

      const timeoutArgs = [
        `${timeoutSecs}s`,
        "lynx",
        "-dump",
        ...modeParams,
        url,
      ];
      const cmd = isWindows ? "wsl" : "timeout";
      const cmdArgs = isWindows ? ["timeout", ...timeoutArgs] : timeoutArgs;

      execFile(cmd, cmdArgs, (error, stdout, stderr) => {
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

        // The cmd is `timeout`/`wsl`, not lynx itself, so a missing lynx
        // binary surfaces in stderr from timeout rather than as ENOENT here.
        if (/lynx.*(?:not found|No such file or directory)/i.test(output)) {
          reject(
            "Lynx is not installed. Install with `apt install lynx` (or equivalent for your distro)",
          );
          return;
        }

        if (output.includes("Exiting via interrupt")) {
          reject("Timed out loading URL: May be inaccessible");
        } else if (error && !output) {
          reject(`Failed to load URL: ${error.message}`);
        } else {
          resolve(output);
        }
      });
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
    return content.replace(/\[(\d+)\]/g, (_match, linkStr: string) => {
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
    pagination.clear();
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

  function showMoreContent(): string {
    if (!pagination.hasContent()) {
      return "No paginated content available. Open a URL first with 'ns-lynx open <url>'.";
    }

    if (pagination.isAtLastPage()) {
      return `Already at the last page (${pagination.getTotalPages()}) of content for ${pagination.getLastUrl()}.`;
    }

    const view = pagination.next()!;
    let pageContent = view.content;
    if (view.pageNum < view.totalPages) {
      pageContent += `\n\n--- More content available. Use 'ns-lynx more' to view page ${view.pageNum + 1} of ${view.totalPages} ---`;
    }

    const result = `URL: ${view.url} (Page ${view.pageNum} of ${view.totalPages})\n\n${pageContent}`;
    return storeMapSetLinks(result, "");
  }

  const registrableCommand: RegistrableCommand = {
    command: lynxCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    clear,
    registerUrl,
  };
}

export type LynxService = ReturnType<typeof createLynxService>;
