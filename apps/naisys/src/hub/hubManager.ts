import { GlobalConfig } from "../globalConfig.js";
import { HostService } from "../services/hostService.js";
import { createHubClientLog } from "./hubClientLog.js";
import { createHubService, HubService } from "./hubService.js";

export function createHubManager(
  globalConfig: GlobalConfig,
  hostService: HostService
) {
  const config = globalConfig.globalConfig();
  const logService = createHubClientLog();
  const hubServices: HubService[] = [];

  async function start() {
    if (config.hubUrls.length === 0) {
      logService.log(
        "[HubManager] No HUB_URLS configured, running in standalone mode"
      );
      return;
    }

    logService.log(
      `[HubManager] Starting connections to ${config.hubUrls.length} hub(s)...`
    );
    for (const hubUrl of config.hubUrls) {
      const hubService = createHubService({
        hubUrl,
        hubAccessKey: config.hubAccessKey,
        hostId: hostService.localHostId,
        hostname: hostService.localHostname,
        logService,
      });

      hubServices.push(hubService);
      hubService.connect();
    }
  }

  function stop() {
    logService.log("[HubManager] Stopping all hub connections...");
    for (const hubService of hubServices) {
      hubService.disconnect();
    }
    hubServices.length = 0;
  }

  function getConnectedHubs() {
    return hubServices.filter((s) => s.isConnected());
  }

  function isMultiMachineMode() {
    return config.hubUrls.length > 0;
  }

  return {
    start,
    stop,
    getConnectedHubs,
    isMultiMachineMode,
  };
}

export type HubManager = ReturnType<typeof createHubManager>;
