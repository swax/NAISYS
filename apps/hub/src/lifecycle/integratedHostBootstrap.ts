import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { toUrlSafeKey } from "@naisys/common";
import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";

function certDir(): string {
  return join(process.env.NAISYS_FOLDER || "", "cert");
}

function certPath(): string {
  return join(certDir(), "integrated-naisys-access-key");
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Ensure the integrated NAISYS host row + access key are reconciled.
 * Key precedence: HOST_ACCESS_KEY env > cached cert file > freshly generated.
 */
export async function bootstrapIntegratedNaisysHost(
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
): Promise<void> {
  // hosts.name lands in /hosts/:hostname routes, so match createHost's sanitization.
  const rawHostName = process.env.NAISYS_HOSTNAME || os.hostname();
  const hostName = toUrlSafeKey(rawHostName);
  if (!hostName) {
    throw new Error(
      `[Hub:HostBootstrap] Resolved hostname "${rawHostName}" sanitizes to an empty string — set NAISYS_HOSTNAME to a URL-safe value.`,
    );
  }
  if (hostName !== rawHostName) {
    logService.log(
      `[Hub:HostBootstrap] Sanitized integrated hostname "${rawHostName}" → "${hostName}"`,
    );
  }

  const envKey = process.env.HOST_ACCESS_KEY?.trim();
  const filePath = certPath();
  const fileKey = existsSync(filePath)
    ? readFileSync(filePath, "utf-8").trim() || undefined
    : undefined;

  let plaintext = envKey || fileKey;
  if (!plaintext) {
    plaintext = randomBytes(32).toString("hex");
    mkdirSync(certDir(), { recursive: true });
    writeFileSync(filePath, plaintext, { mode: 0o600 });
    logService.log(
      `[Hub:HostBootstrap] Generated access key for integrated host "${hostName}" (cached at ${filePath})`,
    );
  }

  // In-process hub-client resolves the key via env, not the cert file.
  process.env.HOST_ACCESS_KEY = plaintext;

  const expectedHash = hashKey(plaintext);

  const existing = await hubDb.hosts.findUnique({ where: { name: hostName } });
  if (existing) {
    if (existing.access_key_hash !== expectedHash) {
      await hubDb.hosts.update({
        where: { id: existing.id },
        data: { access_key_hash: expectedHash, host_type: "naisys" },
      });
      logService.log(
        `[Hub:HostBootstrap] Reconciled access key for integrated host "${hostName}"`,
      );
    }
  } else {
    await hubDb.hosts.create({
      data: {
        name: hostName,
        host_type: "naisys",
        access_key_hash: expectedHash,
      },
    });
    logService.log(
      `[Hub:HostBootstrap] Created integrated host "${hostName}"`,
    );
  }
}
