import { resolveHubAccessKey } from "@naisys/common-node";
import os from "os";

export function createHubClientConfig(hubUrl: string) {
  if (!resolveHubAccessKey()) {
    throw new Error(
      "HUB_ACCESS_KEY is required to connect to a hub. Set it in .env or place it in NAISYS_FOLDER/cert/hub-access-key.",
    );
  }

  const hostname = process.env.NAISYS_HOSTNAME || os.hostname();

  return {
    hubUrl,
    hostname,
  };
}

export type HubClientConfig = ReturnType<typeof createHubClientConfig>;
