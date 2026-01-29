import os from "os";

export function createHubConfig() {
  /** Identifies this hub - used for host identification in hub-to-hub sync */
  const hostname = (process.env.NAISYS_HOSTNAME ?? os.hostname()).replace(
    "${machine_name}",
    os.hostname(),
  );

  const naisysFolder = process.env.NAISYS_FOLDER || "";

  /** Comma-separated list of other Hub URLs for hub-to-hub federation */
  const interhubUrls =
    process.env.INTERHUB_URLS
      ?.split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0) ?? [];

  /** API key for authenticating with other Hub servers */
  const interhubAccessKey = process.env.INTERHUB_ACCESS_KEY;

  const config = {
    hostname,
    naisysFolder,
    interhubUrls,
    interhubAccessKey,
  };

  return {
    hubConfig: () => config,
  };
}

export type HubConfig = ReturnType<typeof createHubConfig>;
