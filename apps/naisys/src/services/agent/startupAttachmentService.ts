import { mapWithConcurrency } from "@naisys/common";
import type { StartupAttachmentDispatch } from "@naisys/hub-protocol";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import type { AgentConfig } from "../../agent/agentConfig.js";
import type { HubAttachmentClient } from "../hub/hubAttachmentClient.js";
import { ensureFileDirExists } from "../runtime/pathService.js";

/** Cap on concurrent startup-file downloads. Small because typical agent
 *  configs ship only a handful of files; the cap mostly guards against
 *  pathological configs. */
const STARTUP_DOWNLOAD_CONCURRENCY = 4;

// Constructed unconditionally so commandLoop can always call getSummary()
// at startup, even when no files were configured.
export function createStartupAttachmentService(
  hubAttachmentClient: HubAttachmentClient,
  agentConfig: AgentConfig,
) {
  let downloaded = 0;
  let alreadyPresent = 0;

  // First rejection propagates so the caller can refuse to start the agent
  // rather than launching it with missing files. Other in-flight downloads
  // may still settle in the background — file writes are idempotent.
  async function stage(
    attachments: StartupAttachmentDispatch[],
  ): Promise<void> {
    if (attachments.length === 0) return;
    const homeDir = agentConfig.getHomeDir();
    if (!homeDir) {
      throw "NAISYS_FOLDER must be set to stage startup attachments";
    }
    const resolvedHome = path.resolve(homeDir);

    // Clear leftover .tmp.<pid>.<ts> files from prior crashes before
    // staging — same convention is used to write into this tree below.
    await hubAttachmentClient.sweepStaleTmpFiles(resolvedHome);

    await mapWithConcurrency(
      attachments,
      STARTUP_DOWNLOAD_CONCURRENCY,
      async (a) => {
        const targetPath = path.resolve(homeDir, a.path);
        // Defense in depth — server-side validation should already prevent escape.
        const rel = path.relative(resolvedHome, targetPath);
        if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
          throw `Refusing to stage attachment at '${a.path}': resolves outside home dir`;
        }
        if (hashFileIfExists(targetPath) === a.fileHash) {
          alreadyPresent++;
          return;
        }
        ensureFileDirExists(targetPath);
        await hubAttachmentClient.downloadToFile(a.publicId, targetPath);
        downloaded++;
      },
    );
  }

  function getSummary(): string | undefined {
    const total = downloaded + alreadyPresent;
    if (total === 0) return undefined;
    return `Startup files: ${total} staged (${downloaded} downloaded, ${alreadyPresent} already present)`;
  }

  return { stage, getSummary };
}

export type StartupAttachmentService = ReturnType<
  typeof createStartupAttachmentService
>;

function hashFileIfExists(filepath: string): string | null {
  if (!fs.existsSync(filepath)) return null;
  return createHash("sha256").update(fs.readFileSync(filepath)).digest("hex");
}
