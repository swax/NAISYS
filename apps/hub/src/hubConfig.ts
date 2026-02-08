import { loadHubConfig, sanitizeSpendLimit } from "@naisys/common";

export function createHubConfig() {
  const hubLoadable = loadHubConfig();

  /** API key for authenticating with other Hub servers */
  const hubAccessKey = process.env.HUB_ACCESS_KEY;

  const config = {
    naisysFolder: process.env.NAISYS_FOLDER || "",
    hubAccessKey,
    spendLimitDollars: hubLoadable.spendLimitDollars,
    spendLimitHours: hubLoadable.spendLimitHours,
  };

  return {
    hubConfig: () => config,
  };
}

export type HubConfig = ReturnType<typeof createHubConfig>;
