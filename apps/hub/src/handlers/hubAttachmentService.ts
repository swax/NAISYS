import type { HubDatabaseService } from "@naisys/hub-database";
import { createHash } from "crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
} from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import type { Server as HttpsServer } from "https";
import { join } from "path";
import { pipeline, Writable } from "stream";

import { HubServerLog } from "../services/hubServerLog.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * HTTP attachment upload/download service.
 * Registers a `request` handler on the raw HTTPS server for `/attachments` paths.
 * Non-matching paths are ignored so Socket.IO still works.
 */
export function createHubAttachmentService(
  httpsServer: HttpsServer,
  { usingHubDatabase }: HubDatabaseService,
  logService: HubServerLog,
) {
  const naisysFolder = process.env.NAISYS_FOLDER || "";

  httpsServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(
      req.url || "",
      `https://${req.headers.host || "localhost"}`,
    );
    const pathname = url.pathname;

    if (pathname === "/attachments" && req.method === "POST") {
      handleUpload(url, req, res).catch((err) => {
        logService.error(`[Hub:Attachment] Upload error: ${err}`);
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    } else if (pathname.startsWith("/attachments/") && req.method === "GET") {
      handleDownload(url, pathname, req, res).catch((err) => {
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
    return usingHubDatabase(async (hubDb) => {
      const user = await hubDb.users.findUnique({ where: { api_key: apiKey } });
      return user?.id ?? null;
    });
  }

  async function handleUpload(
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const apiKey = url.searchParams.get("apiKey");
    const filename = url.searchParams.get("filename");
    const fileSizeStr = url.searchParams.get("filesize");
    const fileHash = url.searchParams.get("filehash");

    if (!apiKey || !filename || !fileSizeStr || !fileHash) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Missing required query params: apiKey, filename, filesize, filehash",
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

    // Build storage path: NAISYS_FOLDER/attachments/YYYY-MM-DD/<timestamp>_<userId>_<safeFilename>
    const now = new Date();
    const dateDir = now.toISOString().slice(0, 10);
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageDir = join(naisysFolder, "attachments", dateDir);
    mkdirSync(storageDir, { recursive: true });

    const storageName = `${now.getTime()}_${userId}_${safeFilename}`;
    const storagePath = join(storageDir, storageName);

    // Stream request body to disk and compute SHA-256
    const hash = createHash("sha256");
    let bytesWritten = 0;
    const fileStream = createWriteStream(storagePath);

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
            unlinkSync(storagePath);
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
        unlinkSync(storagePath);
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

    // Create DB record
    const attachmentId = await usingHubDatabase(async (hubDb) => {
      const record = await hubDb.mail_attachments.create({
        data: {
          filepath: storagePath,
          filename,
          file_size: bytesWritten,
          file_hash: computedHash,
          uploaded_by: userId,
          message_id: null,
        },
      });
      return record.id;
    });

    logService.log(
      `[Hub:Attachment] Uploaded attachment ${attachmentId}: ${filename} (${bytesWritten} bytes) by user ${userId}`,
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: attachmentId }));
  }

  async function handleDownload(
    url: URL,
    pathname: string,
    _req: IncomingMessage,
    res: ServerResponse,
  ) {
    const apiKey = url.searchParams.get("apiKey");
    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing apiKey" }));
      return;
    }

    const userId = await resolveUserByApiKey(apiKey);
    if (userId == null) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API key" }));
      return;
    }

    // Parse attachment ID from /attachments/<id>
    const idStr = pathname.slice("/attachments/".length);
    const attachmentId = parseInt(idStr, 10);
    if (isNaN(attachmentId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid attachment ID" }));
      return;
    }

    const attachment = await usingHubDatabase(async (hubDb) => {
      return hubDb.mail_attachments.findUnique({ where: { id: attachmentId } });
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
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${attachment.filename.replace(/"/g, '\\"')}"`,
      "Content-Length": stat.size,
    });

    const readStream = createReadStream(attachment.filepath);
    readStream.pipe(res);
  }
}
