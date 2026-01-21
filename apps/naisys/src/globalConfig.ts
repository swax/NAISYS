import { readFile } from "fs/promises";
import os from "os";
import path from "path";
import * as pathService from "./services/pathService.js";
import { useNativeWindows } from "./services/shellPlatform.js";
import { sanitizeSpendLimit } from "./utils/utilities.js";

export async function createGlobalConfig() {
  let cachedConfig = await loadConfig();

  async function loadConfig() {
    /** Identifies this runner - shows after @ in prompt, used for multi-machine host identification */
    const hostname = getEnv("NAISYS_HOSTNAME", true)!.replace(
      "${machine_name}",
      os.hostname(),
    );

    const shellCommand = {
      /** Limits the size of files that can be read/wrote */
      outputTokenMax: 7500,
      /** The time NAISYS will wait for new shell output before giving up */
      timeoutSeconds: 10,
      maxTimeoutSeconds: 60 * 5, // 5 minutes
    };

    /** Number of lines to buffer for hidden in/out of process agents */
    const bufferAgentLines = 5000;

    const retrySecondsMax = 30 * 60; // 30 minutes

    /** Web pages loaded with ns-lynx will be reduced down to around this number of tokens */
    const webTokenMax = 5000;

    /** Allows the LLM to compact and restart its session */
    const compactSessionEnabled = true;

    /** Experimental, live updating spot in the context for the LLM to put files, to avoid having to continually cat */
    const workspacesEnabled = false;

    /** Experimental, allow LLM to trim it's own session context to avoid having to restart the session */
    const trimSessionEnabled = false;

    /* .env is used for global configs across naisys, while agent configs are for the specific agent */
    const naisysFolder = getEnv("NAISYS_FOLDER", true)!;

    const localLlmUrl = getEnv("LOCAL_LLM_URL");
    const localLlmName = getEnv("LOCAL_LLM_NAME");

    const openaiApiKey = getEnv("OPENAI_API_KEY");
    const googleApiKey = getEnv("GOOGLE_API_KEY");
    const anthropicApiKey = getEnv("ANTHROPIC_API_KEY");

    const googleSearchEngineId = getEnv("GOOGLE_SEARCH_ENGINE_ID");

    /** Comma-separated list of Hub URLs for multi-machine sync */
    const hubUrls =
      getEnv("HUB_URLS")
        ?.split(",")
        .map((url) => url.trim())
        .filter((url) => url.length > 0) ?? [];

    /** API key for authenticating with Hub servers */
    const hubAccessKey = getEnv("HUB_ACCESS_KEY");

    /** Global spend limit across all agents using this .env file */
    const spendLimitDollars = sanitizeSpendLimit(getEnv("SPEND_LIMIT_DOLLARS"));

    /** Global spend limit period in hours. If not set, limit applies to all time */
    const spendLimitHours = sanitizeSpendLimit(getEnv("SPEND_LIMIT_HOURS"));

    /**
     * Provide a clear way for the LLM to specify what command(s) to run as well as the reasoning for those commands
     * Decrease the chance of the LLM hallucinating output as there is no place to for that in the response
     * The disableMultipleCommands config affects the schema by only allowing a single command to be issued
     * Many commands often backfires as the LLM may issue commands before evaluating previous command output
     */
    const useToolsForLlmConsoleResponses = true;

    const packageVersion = await getVersion();

    const binPath = getBinPath();

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

    function getEnv(key: string, required?: boolean) {
      const value = process.env[key];
      if (!value && required) {
        throw `Config: Error, .env ${key} is not defined`;
      }
      return value;
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
      hostname,
      shellCommand,
      webTokenMax,
      retrySecondsMax,
      compactSessionEnabled,
      workspacesEnabled,
      trimSessionEnabled,
      naisysFolder,
      localLlmUrl,
      localLlmName,
      openaiApiKey,
      googleApiKey,
      anthropicApiKey,
      googleSearchEngineId,
      spendLimitDollars,
      spendLimitHours,
      hubUrls,
      hubAccessKey,
      useToolsForLlmConsoleResponses,
      packageVersion,
      binPath,
      getEnv,
    };
  }

  return {
    globalConfig: () => cachedConfig,
    reloadGlobalConfig: async () => {
      cachedConfig = await loadConfig();
    },
  };
}

export type GlobalConfig = Awaited<ReturnType<typeof createGlobalConfig>>;
