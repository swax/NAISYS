import os from "os";

export function createHubConfig() {
  const naisysFolder = process.env.NAISYS_FOLDER || "";

  /** API key for authenticating with other Hub servers */
  const hubAccessKey = process.env.HUB_ACCESS_KEY;

  const config = {
    naisysFolder,
    hubAccessKey,
  };

  return {
    hubConfig: () => config,
  };
}

export type HubConfig = ReturnType<typeof createHubConfig>;
