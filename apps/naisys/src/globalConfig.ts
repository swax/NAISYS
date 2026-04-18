import type { ClientConfig } from "@naisys/common";
import { buildClientConfig } from "@naisys/common";
import { ConfigResponseSchema, HubEvents } from "@naisys/hub-protocol";
import dotenv from "dotenv";
import fs from "fs";
import { readFile } from "fs/promises";
import os from "os";
import path from "path";

import type { HubClient } from "./hub/hubClient.js";
import * as pathService from "./services/pathService.js";

export function createGlobalConfig(
  hubClient?: HubClient,
  supervisorUrl?: string,
) {
  type FullClientConfig = Awaited<ReturnType<typeof appendClientConfig>>;

  let cachedConfig: FullClientConfig;
  let configReadyPromise: Promise<void>;
  let configChangedHandler: (() => void) | undefined;

  init();

  function init() {
    if (hubClient) {
      let resolveConfig: () => void;
      let rejectConfig: (error: Error) => void;

      configReadyPromise = new Promise<void>((resolve, reject) => {
        resolveConfig = resolve;
        rejectConfig = reject;
      });

      hubClient.registerEvent(HubEvents.VARIABLES_UPDATED, async (data) => {
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

          configChangedHandler?.();
        } catch (error) {
          rejectConfig(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
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

    return {
      ...clientConfig,
      hostname,
      packageVersion,
      supervisorUrl,
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
    } catch (_e) {
      return "Error getting NAISYS verison";
    }
  }

  /**
   * Update a single key in the .env file, preserving comments and ordering.
   * If the key exists, its value is replaced in-place.
   * If the key does not exist, it is appended to the end of the file.
   * Also updates process.env so the change is visible immediately.
   */
  function updateEnvValue(key: string, value: string): void {
    const dotenvPath = path.resolve(".env");
    const content = fs.existsSync(dotenvPath)
      ? fs.readFileSync(dotenvPath, "utf-8")
      : "";
    const lines = content.split("\n");
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const lineKey = trimmed.substring(0, eqIdx).trim();
      if (lineKey === key) {
        lines[i] = `${key}=${value}`;
        found = true;
        break;
      }
    }

    if (!found) {
      lines.push(`${key}=${value}`);
    }

    fs.writeFileSync(dotenvPath, lines.join("\n"));
    process.env[key] = value;

    // Patch cachedConfig for keys that map to config fields
    if (cachedConfig && key === "NAISYS_HOSTNAME") {
      cachedConfig.hostname = value;
    }
  }

  return {
    globalConfig: () => cachedConfig,
    waitForConfig: () => configReadyPromise,
    onConfigChanged: (handler: () => void) => {
      configChangedHandler = handler;
    },
    updateEnvValue,
  };
}

export type GlobalConfig = ReturnType<typeof createGlobalConfig>;
