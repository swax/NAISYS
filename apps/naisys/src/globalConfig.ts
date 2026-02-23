import { buildClientConfig,ClientConfig } from "@naisys/common";
import { ConfigResponseSchema, HubEvents } from "@naisys/hub-protocol";
import dotenv from "dotenv";
import { readFile } from "fs/promises";
import os from "os";
import path from "path";

import { HubClient } from "./hub/hubClient.js";
import * as pathService from "./services/pathService.js";
import { useNativeWindows } from "./services/shellPlatform.js";

export function createGlobalConfig(
  hubClient?: HubClient,
  supervisorPort?: number,
) {
  type FullClientConfig = Awaited<ReturnType<typeof appendClientConfig>>;

  let cachedConfig: FullClientConfig;
  let configReadyPromise: Promise<void>;

  init();

  function init() {
    if (hubClient) {
      let resolveConfig: () => void;
      let rejectConfig: (error: Error) => void;

      configReadyPromise = new Promise<void>((resolve, reject) => {
        resolveConfig = resolve;
        rejectConfig = reject;
      });

      hubClient.registerEvent(
        HubEvents.VARIABLES_UPDATED,
        async (data: unknown) => {
          try {
            const response = ConfigResponseSchema.parse(data);
            if (!response.success || !response.config) {
              rejectConfig(
                new Error(response.error || "Failed to get config from hub"),
              );
              return;
            }

            cachedConfig = await appendClientConfig(response.config);
            resolveConfig();
          } catch (error) {
            rejectConfig(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        },
      );
    } else {
      const { parsed: dotenvVars } = dotenv.config({ quiet: true });
      const clientConfig = buildClientConfig(dotenvVars ?? {});
      configReadyPromise = appendClientConfig(clientConfig).then((config) => {
        cachedConfig = config;
      });
    }
  }

  async function appendClientConfig(clientConfig: ClientConfig) {
    /** Identifies this runner - shows after @ in prompt, used for multi-machine host identification */
    const hostname = process.env.NAISYS_HOSTNAME || os.hostname();

    const packageVersion = await getVersion();
    const binPath = getBinPath();

    return {
      ...clientConfig,
      hostname,
      packageVersion,
      binPath,
      supervisorPort,
    };
  }

  /** Can only get version from env variable when naisys is started with npm,
   * otherwise need to rip it from the package ourselves relative to where this file is located */
  async function getVersion() {
    try {
      /* Removed for compatibility with https://bundlephobia.com/package/naisys
      const packageJson = await import(packageJsonUrl.href, {
        assert: { type: "json" },
      });*/

      const installPath = pathService.getInstallPath();
      const packageJsonPath = path.join(installPath, "package.json");
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      return packageJson.version;
    } catch (e) {
      return "Error getting NAISYS verison";
    }
  }

  function getBinPath() {
    // Get the bin path relative to this file
    const binUrl = new URL("../bin", import.meta.url);
    let binPath = binUrl.pathname;

    // On Windows, pathname starts with /C: which needs fixing
    if (useNativeWindows() && binPath.startsWith("/")) {
      // Remove leading slash: /C:/git/naisys/bin -> C:/git/naisys/bin
      binPath = binPath.substring(1);

      // For native Windows (PowerShell), use Windows-style path
      binPath = binPath.replace(/\//g, "\\");
    }

    return binPath;
  }

  return {
    globalConfig: () => cachedConfig,
    waitForConfig: () => configReadyPromise,
  };
}

export type GlobalConfig = ReturnType<typeof createGlobalConfig>;
