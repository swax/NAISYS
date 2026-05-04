import {
  OPENAI_CODEX_ACCESS_TOKEN_VAR,
  OPENAI_CODEX_EXPIRES_AT_VAR,
  OPENAI_CODEX_REFRESH_TOKEN_VAR,
} from "@naisys/common";
import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import {
  HubEvents,
  type VariablePatchRequest,
  VariablePatchRequestSchema,
} from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";
import type { HubConfigService } from "./hubConfigService.js";
import type { HubRedactionService } from "./hubRedactionService.js";

type PatchableVariablePolicy = {
  sensitive: boolean;
  exportToShell: boolean;
};

// Allowlist + per-key storage policy. Without this, a compromised host could
// rotate any API key and have the hub broadcast it to every other host.
const clientPatchableVariables = new Map<string, PatchableVariablePolicy>([
  [OPENAI_CODEX_ACCESS_TOKEN_VAR, { sensitive: true, exportToShell: false }],
  [OPENAI_CODEX_REFRESH_TOKEN_VAR, { sensitive: true, exportToShell: false }],
  [OPENAI_CODEX_EXPIRES_AT_VAR, { sensitive: false, exportToShell: false }],
]);

export function createHubVariablePatchService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  configService: HubConfigService,
  redactionService: HubRedactionService,
  logService: DualLogger,
) {
  async function patchVariables(
    hostId: number,
    request: VariablePatchRequest,
  ): Promise<void> {
    const denied = request.updates.find(
      ({ key }) => !clientPatchableVariables.has(key),
    );
    if (denied) {
      logService.error(
        `[Hub:Variables] Rejected patch from host ${hostId}: variable '${denied.key}' is not patchable by NAISYS clients.`,
      );
      return;
    }

    await hubDb.$transaction(async (tx) => {
      for (const update of request.updates) {
        const policy = clientPatchableVariables.get(update.key)!;
        await tx.variables.upsert({
          where: { key: update.key },
          update: {
            value: update.value,
            export_to_shell: policy.exportToShell,
            sensitive: policy.sensitive,
            updated_by: `host:${hostId}`,
          },
          create: {
            key: update.key,
            value: update.value,
            export_to_shell: policy.exportToShell,
            sensitive: policy.sensitive,
            created_by: `host:${hostId}`,
            updated_by: `host:${hostId}`,
          },
        });
      }
    });

    // Inline rather than firing VARIABLES_CHANGED so the redaction set is
    // rebuilt before any subsequent log lines ingest.
    await redactionService.rebuildDbSecrets();
    await configService.broadcastConfig();
  }

  naisysServer.registerEvent(
    HubEvents.VARIABLE_PATCH,
    async (hostId, request) => {
      try {
        await patchVariables(hostId, request);
      } catch (error) {
        logService.error(
          `[Hub:Variables] Failed to apply variable patch from host ${hostId}: ${error}`,
        );
      }
    },
    VariablePatchRequestSchema,
  );

  return { patchVariables };
}

export type HubVariablePatchService = ReturnType<
  typeof createHubVariablePatchService
>;
