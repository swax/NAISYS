import fs from "fs";
import http from "http";
import https from "https";
import path from "path";

import type { HubClient } from "../../hub/hubClient.js";
import type { NaisysApiService } from "./naisysApiService.js";

/** Match the `<targetPath>.tmp.<pid>.<ts>` convention used by downloadToFile. */
const TMP_SUFFIX_RE = /\.tmp\.\d+\.\d+$/;

/** Files younger than this might belong to a concurrent in-flight download
 *  from another process; the age cap avoids deleting under their feet. */
const STALE_TMP_AGE_MS = 60 * 60 * 1000;

/** Shared client for `GET /attachments/:publicId` against the hub. Used by
 *  the startup-attachment stager (downloads to disk) and the resume-replay
 *  image/audio fetcher (downloads to memory). */
export function createHubAttachmentClient(
  hubClient: HubClient | undefined,
  naisysApiService: NaisysApiService,
) {
  function getCredentials(): { hubUrl: string; apiKey: string } {
    if (!hubClient) {
      throw "Hub attachments not available in local mode.";
    }
    const apiKey = naisysApiService.getKey();
    if (!apiKey) {
      throw "No API key configured for this user.";
    }
    return { hubUrl: hubClient.getHubUrl(), apiKey };
  }

  /** Stream to a temp file and rename on success so a crashed download
   *  doesn't leave a partial file at targetPath. */
  async function downloadToFile(
    publicId: string,
    targetPath: string,
  ): Promise<void> {
    const { hubUrl, apiKey } = getCredentials();
    const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;

    await new Promise<void>((resolve, reject) => {
      const req = openRequest(hubUrl, apiKey, publicId, (res) => {
        if (res.statusCode !== 200) {
          drainError(res, reject);
          return;
        }
        const fileStream = fs.createWriteStream(tmpPath);
        res.pipe(fileStream);
        fileStream.on("error", (err) => {
          tryUnlink(tmpPath);
          reject(err);
        });
        fileStream.on("finish", () => {
          try {
            fs.renameSync(tmpPath, targetPath);
            resolve();
          } catch (err) {
            tryUnlink(tmpPath);
            reject(err);
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }

  /** Remove leftover `*.tmp.<pid>.<ts>` files under rootDir from prior runs
   *  that crashed mid-download. Walks recursively; errors are swallowed so
   *  one unreadable entry doesn't block staging. */
  async function sweepStaleTmpFiles(rootDir: string): Promise<void> {
    const cutoff = Date.now() - STALE_TMP_AGE_MS;
    await walkAndUnlinkStaleTmp(rootDir, cutoff);
  }

  async function downloadToBuffer(publicId: string): Promise<Buffer> {
    const { hubUrl, apiKey } = getCredentials();
    return new Promise<Buffer>((resolve, reject) => {
      const req = openRequest(hubUrl, apiKey, publicId, (res) => {
        if (res.statusCode !== 200) {
          drainError(res, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  }

  return { downloadToFile, downloadToBuffer, sweepStaleTmpFiles };
}

export type HubAttachmentClient = ReturnType<typeof createHubAttachmentClient>;

function openRequest(
  hubUrl: string,
  apiKey: string,
  publicId: string,
  onResponse: (res: http.IncomingMessage) => void,
) {
  const url = new URL(`${hubUrl}/attachments/${publicId}`);
  const httpModule = url.protocol === "https:" ? https : http;
  return httpModule.request(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "ngrok-skip-browser-warning": "true",
      },
    },
    onResponse,
  );
}

function drainError(
  res: http.IncomingMessage,
  reject: (reason: unknown) => void,
) {
  let body = "";
  res.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  res.on("end", () => {
    reject(`Download failed (${res.statusCode}): ${body}`);
  });
}

function tryUnlink(filepath: string) {
  try {
    fs.unlinkSync(filepath);
  } catch {
    /* ignore */
  }
}

async function walkAndUnlinkStaleTmp(
  dir: string,
  cutoffMs: number,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir may not exist yet on first start
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkAndUnlinkStaleTmp(full, cutoffMs);
      continue;
    }
    if (!TMP_SUFFIX_RE.test(e.name)) continue;
    try {
      const stat = await fs.promises.stat(full);
      if (stat.mtimeMs < cutoffMs) {
        await fs.promises.unlink(full);
      }
    } catch {
      /* ignore — file might have been removed concurrently */
    }
  }
}
