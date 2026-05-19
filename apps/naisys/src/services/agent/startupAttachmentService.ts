import { mapWithConcurrency } from "@naisys/common";
import type { StartupAttachmentDispatch } from "@naisys/hub-protocol";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import type { AgentConfig } from "../../agent/agentConfig.js";
import type { HubClient } from "../../hub/hubClient.js";
import type { HubAttachmentClient } from "../hub/hubAttachmentClient.js";
import { ensureFileDirExists } from "../runtime/pathService.js";

/** Cap on concurrent startup-file downloads. Small because typical agent
 *  configs ship only a handful of files; the cap mostly guards against
 *  pathological configs. */
const STARTUP_DOWNLOAD_CONCURRENCY = 4;

interface FailedAttachment {
  path: string;
  publicId: string;
  filename: string;
  error: string;
}

// Constructed unconditionally so commandLoop can always call getSummary()
// at startup, even when no files were configured.
export function createStartupAttachmentService(
  hubAttachmentClient: HubAttachmentClient,
  hubClient: HubClient | undefined,
  agentConfig: AgentConfig,
) {
  let downloaded = 0;
  let alreadyPresent = 0;
  const failures: FailedAttachment[] = [];

  // Per-file failures are captured and reported via getSummary rather than
  // rejecting the whole stage — startup-attachment download is a corner
  // case where the agent can curl the file itself once it's up, and we'd
  // rather start the agent and let it triage than block it on flaky I/O.
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
          failures.push({
            path: a.path,
            publicId: a.publicId,
            filename: a.filename,
            error: "resolves outside home dir",
          });
          return;
        }
        if (hashFileIfExists(targetPath) === a.fileHash) {
          alreadyPresent++;
          return;
        }
        try {
          ensureFileDirExists(targetPath);
          await hubAttachmentClient.downloadToFile(a.publicId, targetPath);
          downloaded++;
        } catch (err) {
          failures.push({
            path: a.path,
            publicId: a.publicId,
            filename: a.filename,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
  }

  function getSummary(): string | undefined {
    const total = downloaded + alreadyPresent + failures.length;
    if (total === 0) return undefined;
    const lines = [
      `Startup files: ${downloaded + alreadyPresent} of ${total} staged ` +
        `(${downloaded} downloaded, ${alreadyPresent} already present` +
        (failures.length > 0 ? `, ${failures.length} failed)` : `)`),
    ];
    if (failures.length > 0) {
      const hubUrl = hubClient?.getHubUrl() ?? "<HUB_URL>";
      lines.push("Failed downloads — retry with:");
      for (const f of failures) {
        lines.push(
          `  curl -H "Authorization: Bearer $NAISYS_API_KEY" ` +
            `"${hubUrl}/attachments/${f.publicId}" -o "${f.path}"  # ${f.error}`,
        );
      }
    }
    return lines.join("\n");
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
