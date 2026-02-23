import { createHash } from "crypto";
import fs from "fs";
import https from "https";
import path from "path";

import { UserService } from "../agent/userService.js";
import { ShellWrapper } from "../command/shellWrapper.js";
import { HubClient } from "../hub/hubClient.js";

/**
 * Shared attachment upload service used by both mail and chat.
 * Handles file path resolution, hashing, and HTTP upload to the hub.
 */
export function createMailAttachmentService(
  hubClient: HubClient | undefined,
  userService: UserService,
  localUserId: number,
  shellWrapper: ShellWrapper,
) {
  /** Upload a file to the hub and return the attachment ID */
  async function uploadAttachment(filepath: string): Promise<number> {
    if (!hubClient) throw "Attachments not available in local mode.";

    const apiKey = userService.getUserById(localUserId)?.apiKey;
    if (!apiKey) throw "No API key configured for this user.";

    const fileBuffer = fs.readFileSync(filepath);
    const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
    const filename = path.basename(filepath);
    const fileSize = fileBuffer.length;

    const hubUrl = hubClient.getHubUrl();
    const url = new URL(`${hubUrl}/attachments`);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("filename", filename);
    url.searchParams.set("filesize", String(fileSize));
    url.searchParams.set("filehash", fileHash);

    return new Promise<number>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: "POST",
          rejectUnauthorized: false,
          headers: { "Content-Length": fileSize },
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
   * Resolve relative file paths to absolute, verifying each exists.
   */
  async function resolvePaths(filePaths: string[]): Promise<string[]> {
    const cwd = await shellWrapper.getCurrentPath();
    const resolved: string[] = [];

    for (const fp of filePaths) {
      let r = fp;
      if (!path.isAbsolute(r) && cwd) {
        r = path.resolve(cwd, r);
      }
      if (!fs.existsSync(r)) {
        throw `File not found: ${r}`;
      }
      resolved.push(r);
    }

    return resolved;
  }

  /**
   * Resolve file paths and upload each one.
   * Returns the array of attachment IDs.
   */
  async function resolveAndUpload(filePaths: string[]): Promise<number[]> {
    if (!hubClient) throw "Attachments not available in local mode.";

    const resolvedPaths = await resolvePaths(filePaths);
    const attachmentIds: number[] = [];

    for (const resolved of resolvedPaths) {
      const attId = await uploadAttachment(resolved);
      attachmentIds.push(attId);
    }

    return attachmentIds;
  }

  return { resolvePaths, resolveAndUpload };
}

export type MailAttachmentService = ReturnType<
  typeof createMailAttachmentService
>;
