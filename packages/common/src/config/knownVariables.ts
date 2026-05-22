/**
 * Default categories for variables that NAISYS itself knows about. Powers the
 * Variables-page panels: the add-variable form pre-fills a category when a
 * known key is typed, the hub stamps seeded and imported variables with their
 * category, and the schema migration backfills existing rows.
 *
 * Anything not listed here has no default — the user assigns one in the UI, or
 * leaves it blank (uncategorized).
 *
 * Keep in sync with the backfill in the migration
 * packages/hub-database/prisma/migrations/20260521000000_add_variable_category.
 */
export const KNOWN_VARIABLE_CATEGORIES: Readonly<Record<string, string>> = {
  // API Keys — credentials for LLM / image models and Google web search
  OPENAI_API_KEY: "API Keys",
  ANTHROPIC_API_KEY: "API Keys",
  GOOGLE_API_KEY: "API Keys",
  GOOGLE_SEARCH_ENGINE_ID: "API Keys",
  XAI_API_KEY: "API Keys",
  CODEX_REFRESH_TOKEN: "API Keys",
  OPENROUTER_API_KEY: "API Keys",
  // System — hub-wide settings
  TIMEZONE: "System",
  TARGET_VERSION: "System",
  MAIL_ENABLED: "System",
  VOICE_AGENT_MODEL: "System",
  // Spend Limits — cost caps and usage throttling
  SPEND_LIMIT_DOLLARS: "Spend Limits",
  SPEND_LIMIT_HOURS: "Spend Limits",
  CODEX_USAGE_LIMIT_PERCENT: "Spend Limits",
  CODEX_USAGE_CHECK_MINUTES: "Spend Limits",
};

/** Default category for a known variable key, or null when the key is unknown. */
export function defaultCategoryForVariable(key: string): string | null {
  return KNOWN_VARIABLE_CATEGORIES[key] ?? null;
}
