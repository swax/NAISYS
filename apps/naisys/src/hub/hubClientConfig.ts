import os from "os";

export function createHubClientConfig(hubUrl: string) {
  const hubAccessKey = process.env.HUB_ACCESS_KEY;

  const hostname = process.env.NAISYS_HOSTNAME || os.hostname();

  return {
    hubUrl,
    hubAccessKey,
    hostname,
  };
}

export type HubClientConfig = ReturnType<typeof createHubClientConfig>;
