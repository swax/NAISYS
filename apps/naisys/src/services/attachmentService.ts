import { createHash } from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";

import type { HubClient } from "../hub/hubClient.js";

/**
 * Upload a file to the hub and return the attachment ID.
 */
function uploadFileToHub(
  hubUrl: string,
  apiKey: string,
  filepath: string,
  purpose: string,
): Promise<number> {
  const fileBuffer = fs.readFileSync(filepath);
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
  const filename = path.basename(filepath);
  const fileSize = fileBuffer.length;

  const url = new URL(`${hubUrl}/attachments`);
  url.searchParams.set("filename", filename);
  url.searchParams.set("filesize", String(fileSize));
  url.searchParams.set("filehash", fileHash);
  url.searchParams.set("purpose", purpose);

  const httpModule = url.protocol === "https:" ? https : http;

  return new Promise<number>((resolve, reject) => {
    const req = httpModule.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Length": fileSize,
          Authorization: `Bearer ${apiKey}`,
          "ngrok-skip-browser-warning": "true",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode === 200 && json.id) {
              resolve(json.id as number);
            } else {
              reject(
                json.error || `Upload failed with status ${res.statusCode}`,
              );
            }
          } catch {
            reject(`Invalid response from hub: ${body}`);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(fileBuffer);
  });
}

/**
 * Attachment upload service.
 * Handles file validation, hashing, and HTTP upload to the hub.
 */
export function createAttachmentService(
  hubClient: HubClient | undefined,
  runtimeApiKey?: string,
) {
  /**
   * Upload a file to the hub and return the attachment ID.
   * Filepath must be absolute and exist on disk.
   */
  async function upload(filepath: string, purpose: string): Promise<number> {
    if (!hubClient) throw "Attachments not available in local mode.";

    if (!fs.existsSync(filepath)) {
      throw `File not found: ${filepath}`;
    }

    if (!runtimeApiKey) throw "No API key configured for this user.";

    return uploadFileToHub(
      hubClient.getHubUrl(),
      runtimeApiKey,
      filepath,
      purpose,
    );
  }

  /**
   * Upload multiple files as mail attachments.
   * Filepaths must be absolute and exist on disk.
   */
  async function uploadAll(
    filePaths: string[],
    purpose: string,
  ): Promise<number[]> {
    const attachmentIds: number[] = [];
    for (const filepath of filePaths) {
      attachmentIds.push(await upload(filepath, purpose));
    }
    return attachmentIds;
  }

  return { upload, uploadAll };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
