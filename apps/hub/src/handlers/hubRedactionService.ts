import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import { HubEvents } from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";

const MIN_SECRET_LENGTH = 6;

const PATTERN_REPLACEMENTS: { pattern: RegExp; replacement: string }[] = [
  {
    pattern: /Authorization:\s*(Bearer|Basic)\s+\S+/gi,
    replacement: "Authorization: $1 [REDACTED]",
  },
  {
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE_KEY]",
  },
  {
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: "[REDACTED:JWT]",
  },
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED:AWS_KEY]",
  },
];

/**
 * Strips sensitive values from strings before they hit the DB or are
 * rebroadcast. Two sources feed the redactor:
 *  - DB-sourced: variables flagged sensitive (API keys, etc.)
 *  - Runtime: per-user NAISYS_API_KEY plaintext, registered when issued by
 *    hubAgentService and forgotten on revoke. Plaintext is otherwise never
 *    persisted, so a hub restart drops these — the rotate-on-reconnect flow
 *    is responsible for repopulating.
 */
export async function createHubRedactionService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
) {
  // Sorted longest-first so a secret that is a prefix of another doesn't
  // get partially replaced before the longer match runs.
  let dbSecrets: { value: string; key: string }[] = [];
  const runtimeApiKeys = new Map<number, string>();

  async function rebuildDbSecrets() {
    const rows = await hubDb.variables.findMany({ where: { sensitive: true } });
    dbSecrets = rows
      .filter((r) => r.value && r.value.length >= MIN_SECRET_LENGTH)
      .map((r) => ({ value: r.value, key: r.key }))
      .sort((a, b) => b.value.length - a.value.length);
  }

  function redact(text: string | null | undefined): string {
    if (!text) return text ?? "";
    let out = text;
    for (const { value, key } of dbSecrets) {
      if (out.includes(value)) {
        out = out.split(value).join(`[REDACTED:${key}]`);
      }
    }
    for (const [userId, plaintext] of runtimeApiKeys) {
      if (out.includes(plaintext)) {
        out = out
          .split(plaintext)
          .join(`[REDACTED:NAISYS_API_KEY:${userId}]`);
      }
    }
    for (const { pattern, replacement } of PATTERN_REPLACEMENTS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }

  function registerRuntimeApiKey(userId: number, plaintext: string): void {
    if (!plaintext || plaintext.length < MIN_SECRET_LENGTH) return;
    runtimeApiKeys.set(userId, plaintext);
  }

  function revokeRuntimeApiKey(userId: number): void {
    runtimeApiKeys.delete(userId);
  }

  naisysServer.registerEvent(HubEvents.VARIABLES_CHANGED, async () => {
    try {
      await rebuildDbSecrets();
    } catch (error) {
      logService.error(
        `[Hub:Redaction] Failed to rebuild secrets after VARIABLES_CHANGED: ${error}`,
      );
    }
  });

  await rebuildDbSecrets();

  return { redact, registerRuntimeApiKey, revokeRuntimeApiKey };
}

export type HubRedactionService = Awaited<
  ReturnType<typeof createHubRedactionService>
>;
