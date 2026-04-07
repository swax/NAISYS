import { mimeFromFilename } from "@naisys/common";
import { extractBearerToken } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import type { AttachmentPurpose } from "@naisys/hub-database";
import { createHash, randomBytes } from "crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "fs";
import type { IncomingMessage, Server, ServerResponse } from "http";
import { join } from "path";
import { pipeline, Writable } from "stream";

import type { HubServerLog } from "../services/hubServerLog.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * HTTP attachment upload/download service.
 * Registers a `request` handler on the raw HTTPS server for `/attachments` paths.
 * Non-matching paths are ignored so Socket.IO still works.
 */
export function createHubAttachmentService(
  httpServer: Server,
  { hubDb }: HubDatabaseService,
  logService: HubServerLog,
) {
  const naisysFolder = process.env.NAISYS_FOLDER || "";

  httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(
      req.url || "",
      `https://${req.headers.host || "localhost"}`,
    );
    const pathname = url.pathname;

    if (pathname === "/hub/attachments" && req.method === "POST") {
      handleUpload(url, req, res).catch((err) => {
        logService.error(`[Hub:Attachment] Upload error: ${err}`);
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    } else if (
      pathname.startsWith("/hub/attachments/") &&
      pathname !== "/hub/attachments/" &&
      req.method === "GET"
    ) {
      handleDownload(pathname, req, res).catch((err) => {
        logService.error(`[Hub:Attachment] Download error: ${err}`);
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    }
    // Non-matching paths: do nothing — let Socket.IO handle them
  });

  async function resolveUserByApiKey(apiKey: string): Promise<number | null> {
    const user = await hubDb.users.findUnique({ where: { api_key: apiKey } });
    return user?.id ?? null;
  }

  async function handleUpload(
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const apiKey = extractBearerToken(req.headers.authorization);
    const filename = url.searchParams.get("filename");
    const fileSizeStr = url.searchParams.get("filesize");
    const fileHash = url.searchParams.get("filehash");
    const purpose = url.searchParams.get("purpose");

    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing Authorization header" }));
      return;
    }

    if (!filename || !fileSizeStr || !fileHash || !purpose) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Missing required query params: filename, filesize, filehash, purpose",
        }),
      );
      return;
    }

    if (purpose !== "mail" && purpose !== "context") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: 'Invalid purpose. Must be "mail" or "context"',
        }),
      );
      return;
    }

    const fileSize = parseInt(fileSizeStr, 10);
    if (isNaN(fileSize) || fileSize <= 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid filesize" }));
      return;
    }

    if (fileSize > MAX_FILE_SIZE) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `File too large. Max size: ${MAX_FILE_SIZE} bytes`,
        }),
      );
      return;
    }

    const userId = await resolveUserByApiKey(apiKey);
    if (userId == null) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API key" }));
      return;
    }

    // Stream to temp file, then move to content-addressable path
    const tmpDir = join(naisysFolder, "tmp", "hub", "attachments");
    mkdirSync(tmpDir, { recursive: true });

    const tmpPath = join(
      tmpDir,
      `${Date.now()}_${userId}_${Math.random().toString(36).slice(2)}`,
    );

    const hash = createHash("sha256");
    let bytesWritten = 0;
    const fileStream = createWriteStream(tmpPath);

    const success = await new Promise<boolean>((resolve) => {
      const sizeChecker = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          bytesWritten += chunk.length;
          if (bytesWritten > MAX_FILE_SIZE) {
            callback(new Error("File exceeds size limit"));
            return;
          }
          hash.update(chunk);
          fileStream.write(chunk, callback);
        },
        final(callback) {
          fileStream.end(callback);
        },
      });

      pipeline(req, sizeChecker, (err) => {
        if (err) {
          fileStream.destroy();
          try {
            unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (!success) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "File exceeds size limit during upload" }),
      );
      return;
    }

    // Verify hash
    const computedHash = hash.digest("hex");
    if (computedHash !== fileHash) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Hash mismatch. Expected: ${fileHash}, got: ${computedHash}`,
        }),
      );
      return;
    }

    // Move to content-addressable path: attachments/hub/<first2>/<next2>/<fullhash>
    const storageDir = join(
      naisysFolder,
      "attachments",
      "hub",
      computedHash.slice(0, 2),
      computedHash.slice(2, 4),
    );
    mkdirSync(storageDir, { recursive: true });
    const storagePath = join(storageDir, computedHash);

    if (existsSync(storagePath)) {
      // Dedup: identical file already on disk, discard temp
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    } else {
      renameSync(tmpPath, storagePath);
    }

    // Create DB record
    const record = await hubDb.attachments.create({
      data: {
        public_id: randomBytes(8).toString("base64url").slice(0, 10),
        filepath: storagePath,
        filename,
        file_size: bytesWritten,
        file_hash: computedHash,
        purpose: purpose as AttachmentPurpose,
        uploaded_by: userId,
      },
    });
    const attachmentId = record.id;

    logService.log(
      `[Hub:Attachment] Uploaded attachment ${attachmentId}: ${filename} (${bytesWritten} bytes) by user ${userId}`,
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: attachmentId }));
  }

  async function handleDownload(
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const apiKey = extractBearerToken(req.headers.authorization);
    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing Authorization header" }));
      return;
    }

    const userId = await resolveUserByApiKey(apiKey);
    if (userId == null) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API key" }));
      return;
    }

    // Parse public ID from /hub/attachments/<publicId> or /hub/attachments/<publicId>/<filename>
    const segments = pathname.slice("/hub/attachments/".length).split("/");
    const publicId = segments[0];
    if (!publicId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing attachment ID" }));
      return;
    }

    const attachment = await hubDb.attachments.findUnique({
      where: { public_id: publicId },
    });

    if (!attachment) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Attachment not found" }));
      return;
    }

    if (!existsSync(attachment.filepath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Attachment file missing from disk" }));
      return;
    }

    const stat = statSync(attachment.filepath);
    const contentType = mimeFromFilename(attachment.filename);
    const disposition = contentType.startsWith("image/")
      ? "inline"
      : "attachment";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${attachment.filename.replace(/"/g, '\\"')}"`,
      "Content-Length": stat.size,
    });

    const readStream = createReadStream(attachment.filepath);
    readStream.pipe(res);
  }
}
