import type { StartupAttachmentDispatch } from "@naisys/hub-protocol";
import { createHash } from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";

import type { AgentConfig } from "../agent/agentConfig.js";
import type { HubClient } from "../hub/hubClient.js";
import type { NaisysApiService } from "./naisysApiService.js";
import { ensureFileDirExists } from "./pathService.js";

// Constructed unconditionally so commandLoop can always call getSummary()
// at startup, even when no files were configured.
export function createStartupAttachmentService(
  hubClient: HubClient | undefined,
  agentConfig: AgentConfig,
  naisysApiService: NaisysApiService,
) {
  let downloaded = 0;
  let alreadyPresent = 0;

  // Throws on first failure so the caller can refuse to start the agent
  // rather than launching it with missing files.
  async function stage(
    attachments: StartupAttachmentDispatch[],
  ): Promise<void> {
    if (attachments.length === 0) return;
    if (!hubClient) {
      throw "Startup attachments not available in local mode.";
    }
    const apiKey = naisysApiService.getKey();
    if (!apiKey) {
      throw "No API key configured for this user.";
    }
    const homeDir = agentConfig.getHomeDir();
    if (!homeDir) {
      throw "NAISYS_FOLDER must be set to stage startup attachments";
    }
    const hubUrl = hubClient.getHubUrl();
    const resolvedHome = path.resolve(homeDir);

    for (const a of attachments) {
      const targetPath = path.resolve(homeDir, a.path);
      // Defense in depth — server-side validation should already prevent escape.
      const rel = path.relative(resolvedHome, targetPath);
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw `Refusing to stage attachment at '${a.path}': resolves outside home dir`;
      }
      if (hashFileIfExists(targetPath) === a.fileHash) {
        alreadyPresent++;
        continue;
      }
      ensureFileDirExists(targetPath);
      await downloadFile(hubUrl, apiKey, a.publicId, targetPath);
      downloaded++;
    }
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

// Streams to a temp file and renames on success so a crashed download
// doesn't leave a partial file at targetPath that hashFileIfExists would
// later mistake for a valid copy.
function downloadFile(
  hubUrl: string,
  apiKey: string,
  publicId: string,
  targetPath: string,
): Promise<void> {
  const url = new URL(`${hubUrl}/attachments/${publicId}`);
  const httpModule = url.protocol === "https:" ? https : http;
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;

  return new Promise<void>((resolve, reject) => {
    const req = httpModule.request(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "ngrok-skip-browser-warning": "true",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let body = "";
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            reject(`Download failed (${res.statusCode}): ${body}`);
          });
          return;
        }

        const fileStream = fs.createWriteStream(tmpPath);
        res.pipe(fileStream);
        fileStream.on("error", (err) => {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
          reject(err);
        });
        fileStream.on("finish", () => {
          try {
            fs.renameSync(tmpPath, targetPath);
            resolve();
          } catch (err) {
            try {
              fs.unlinkSync(tmpPath);
            } catch {
              /* ignore */
            }
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function hashFileIfExists(filepath: string): string | null {
  if (!fs.existsSync(filepath)) return null;
  return createHash("sha256").update(fs.readFileSync(filepath)).digest("hex");
}
