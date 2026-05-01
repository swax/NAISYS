/**
 * Google Custom Search backed by GOOGLE_API_KEY + GOOGLE_SEARCH_ENGINE_ID.
 * Routes hit URLs into the lynx link map when ns-lynx is enabled so they
 * can be followed via `ns-lynx follow <N>`; otherwise emits raw URLs for
 * pasting into `ns-browser open`.
 */

import * as https from "https";

import type { AgentConfig } from "../agent/agentConfig.js";
import { browserCmd, lynxCmd, webSearchCmd } from "../command/commandDefs.js";
import type { RegistrableCommand } from "../command/commandRegistry.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { CostTracker } from "../llm/costTracker.js";
import type { LynxService } from "./lynx.js";

export function createWebSearchService(
  { globalConfig }: GlobalConfig,
  agentConfig: AgentConfig,
  costTracker: CostTracker,
  lynxService: LynxService,
) {
  async function handleCommand(cmdArgs: string): Promise<string> {
    const query = cmdArgs.trim();

    if (!query) {
      return `Usage: ${webSearchCmd.name} ${webSearchCmd.usage}`;
    }

    const googleApiKey = globalConfig().variableMap["GOOGLE_API_KEY"];

    if (!googleApiKey) {
      throw "Error, set GOOGLE_API_KEY env var";
    }

    if (!globalConfig().googleSearchEngineId) {
      throw "Error, set GOOGLE_SEARCH_ENGINE_ID env var";
    }

    const useLynxLinks = !!agentConfig.agentConfig().webEnabled;
    const browserEnabled = !!agentConfig.agentConfig().browserEnabled;

    const result = await new Promise<string>((resolve, reject) => {
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
              let output = `Search results for: ${query}\n\n`;

              if (response.items && response.items.length > 0) {
                for (const item of response.items) {
                  const url = item.link;

                  if (useLynxLinks) {
                    const globalLinkNum = lynxService.registerUrl(url);
                    output += `[${globalLinkNum}] ${item.title}\n`;
                  } else {
                    output += `${item.title}\n`;
                  }
                  output += `${item.snippet}\n`;
                  output += `${url}\n\n`;
                }

                if (useLynxLinks) {
                  output += `\nUse '${lynxCmd.name} follow <link number>' to open a result in a text browser`;
                }
                if (browserEnabled) {
                  output += `\nUse '${browserCmd.name} open <url>' to open a result in a headless browser`;
                }
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

    // https://developers.google.com/custom-search/v1/overview
    costTracker.recordCost(0.005, "websearch", "search");

    return result;
  }

  const registrableCommand: RegistrableCommand = {
    command: webSearchCmd,
    handleCommand,
  };

  return registrableCommand;
}

export type WebSearchService = ReturnType<typeof createWebSearchService>;
