export function createHubConfig() {
  const naisysFolder = process.env.NAISYS_FOLDER || "";

  /** API key for authenticating with other Hub servers */
  const hubAccessKey = process.env.HUB_ACCESS_KEY;

  /** Global spend limit across all agents (fallback when agent config has none) */
  const spendLimitDollars = sanitizeSpendLimit(process.env.SPEND_LIMIT_DOLLARS);

  /** Global spend limit period in hours. If not set, limit applies to all time */
  const spendLimitHours = sanitizeSpendLimit(process.env.SPEND_LIMIT_HOURS);

  const config = {
    naisysFolder,
    hubAccessKey,
    spendLimitDollars,
    spendLimitHours,
  };

  return {
    hubConfig: () => config,
  };
}

function sanitizeSpendLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (isNaN(n) || n <= 0) return undefined;
  return n;
}

export type HubConfig = ReturnType<typeof createHubConfig>;
