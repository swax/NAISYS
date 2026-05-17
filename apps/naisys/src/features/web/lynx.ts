/**
 * A bad play on words, but this is like lynx but for LLMs..
 */

import { execFile } from "child_process";
import * as os from "os";
import stringArgv from "string-argv";

import { lynxCmd } from "../../command/commandDefs.js";
import type { RegistrableCommand } from "../../command/commandRegistry.js";
import type { PagedOutputBuffer } from "../../command/pagedOutputBuffer.js";
import type { GlobalConfig } from "../../globalConfig.js";
import type { OutputService } from "../../utils/output/output.js";
import * as utilities from "../../utils/utilities.js";

export function createLynxService(
  { globalConfig }: GlobalConfig,
  output: OutputService,
  pagedOutputBuffer: PagedOutputBuffer,
) {
  let debugMode = false;

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
        return `${lynxCmd.name} <command> (long output is paginated to ${globalConfig().shellCommand.outputTokenMax} tokens; use \`ns-more\` for subsequent pages)
  ${subs.open.usage}: ${subs.open.description}
  ${subs.follow.usage}: ${subs.follow.description}
  ${subs.links.usage}: ${subs.links.description}

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
        return await loadUrlLinks(url);
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

  /** Returns the globalized link list for the given URL. Pushes overflow into the shared buffer for `ns-more`. */
  async function loadUrlLinks(url: string) {
    let rawDump = await runLynx(url);
    const refPos = rawDump.lastIndexOf("References\n");
    if (refPos < 0) {
      return "No Links Found";
    }
    const links = rawDump.slice(refPos);
    rawDump = "";

    // Dedup URLs in original order
    let dedupedUrls = "";
    const linkSet = new Set<string>();
    for (const linkLine of links.split("\n")) {
      const dotPos = linkLine.indexOf(".");
      if (dotPos < 0) continue;
      const u = linkLine.substring(dotPos + 1).trim();
      if (linkSet.has(u)) continue;
      linkSet.add(u);
      dedupedUrls += u + "\n";
    }

    // Globalize once over the full list so link numbers stay stable across pages.
    const globalized = globalizeLinkList(dedupedUrls);

    outputInDebugMode(`Links Token size: ${utilities.getTokenCount(globalized)}`);

    return pagedOutputBuffer.setContent(`ns-lynx links ${url}`, globalized);
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

    // Globalize before splitting so `[N]` references stay stable across pages.
    let globalized = storeMapSetLinks(content, links);

    if (showUrl) {
      globalized = `URL: ${url}\n\n` + globalized;
    }
    if (showFollowHint) {
      globalized +=
        "\n\nLinks are in brackets. Use `ns-lynx follow <link number>` to follow a link.";
    }

    return pagedOutputBuffer.setContent(`ns-lynx ${url}`, globalized);
  }

  async function runLynx(url: string) {
    return new Promise<string>((resolve, reject) => {
      // Option here to output the content and links separately, might be useful in future
      // mode == RunMode.Content ? "-nolist" : "-listonly";
      const modeParams: string[] = [];

      const isWindows = os.platform() === "win32";
      const timeoutMs = globalConfig().shellCommand.timeoutSeconds * 1000;

      const cmd = isWindows ? "wsl" : "lynx";
      const cmdArgs = isWindows
        ? ["lynx", "-dump", ...modeParams, url]
        : ["-dump", ...modeParams, url];

      execFile(
        cmd,
        cmdArgs,
        { timeout: timeoutMs },
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

          // On Linux/macOS, ENOENT here means `lynx` itself isn't on PATH.
          // On Windows, ENOENT means `wsl` isn't available; lynx-inside-WSL
          // missing instead surfaces from wsl's stderr (handled below).
          if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
            reject(
              isWindows
                ? "WSL is not available. ns-lynx on Windows requires WSL with lynx installed inside it (`wsl apt install lynx`)."
                : "Lynx is not installed. Install with `apt install lynx` (or equivalent for your distro).",
            );
            return;
          }

          // Windows path: wsl ran but couldn't find lynx inside the distro.
          if (
            /lynx.*(?:not found|No such file or directory|command not found)/i.test(
              output,
            )
          ) {
            reject(
              "Lynx is not installed. Install with `apt install lynx` (or equivalent for your distro).",
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
