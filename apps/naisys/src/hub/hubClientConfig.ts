import os from "os";

export function createHubClientConfig(hubUrl: string, hubAccessKey?: string) {
  hubAccessKey = hubAccessKey || process.env.HUB_ACCESS_KEY;

  if (!hubAccessKey) {
    throw new Error(
      "HUB_ACCESS_KEY is required to connect to a hub. Set it in .env or pass it via --integrated-hub.",
    );
  }

  const hostname = process.env.NAISYS_HOSTNAME || os.hostname();

  return {
    hubUrl,
    hubAccessKey,
    hostname,
  };
}

export type HubClientConfig = ReturnType<typeof createHubClientConfig>;
