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
import type { FastifyInstance } from "fastify";
import { join } from "path";
import { pipeline, Writable } from "stream";

import type { HubServerLog } from "../services/hubServerLog.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * HTTP attachment upload/download service.
 * Registers Fastify routes for `/hub/attachments` paths.
 */
export function createHubAttachmentService(
  fastify: FastifyInstance,
  { hubDb }: HubDatabaseService,
  logService: HubServerLog,
) {
  const naisysFolder = process.env.NAISYS_FOLDER || "";

  async function resolveUserByApiKey(apiKey: string): Promise<number | null> {
    const user = await hubDb.users.findUnique({ where: { api_key: apiKey } });
    return user?.id ?? null;
  }

  // Upload route — encapsulated so the raw content-type parser doesn't leak
  fastify.register(async (scope) => {
    // Prevent Fastify from consuming the request body — we stream it to disk
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      (_request: unknown, _payload: unknown, done: (err: null) => void) => {
        done(null);
      },
    );

    scope.post("/hub/attachments", async (request, reply) => {
        try {
          const apiKey = extractBearerToken(request.headers.authorization);

          if (!apiKey) {
            return reply
              .code(401)
              .send({ error: "Missing Authorization header" });
          }

          const url = new URL(
            request.url,
            `https://${request.headers.host || "localhost"}`,
          );
          const filename = url.searchParams.get("filename");
          const fileSizeStr = url.searchParams.get("filesize");
          const fileHash = url.searchParams.get("filehash");
          const purpose = url.searchParams.get("purpose");

          if (!filename || !fileSizeStr || !fileHash || !purpose) {
            return reply.code(400).send({
              error:
                "Missing required query params: filename, filesize, filehash, purpose",
            });
          }

          if (purpose !== "mail" && purpose !== "context") {
            return reply.code(400).send({
              error: 'Invalid purpose. Must be "mail" or "context"',
            });
          }

          const fileSize = parseInt(fileSizeStr, 10);
          if (isNaN(fileSize) || fileSize <= 0) {
            return reply.code(400).send({ error: "Invalid filesize" });
          }

          if (fileSize > MAX_FILE_SIZE) {
            return reply.code(413).send({
              error: `File too large. Max size: ${MAX_FILE_SIZE} bytes`,
            });
          }

          const userId = await resolveUserByApiKey(apiKey);
          if (userId == null) {
            return reply.code(401).send({ error: "Invalid API key" });
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

          // Stream the raw request body (not consumed by Fastify thanks to our parser)
          const req = request.raw;

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
            return reply
              .code(413)
              .send({ error: "File exceeds size limit during upload" });
          }

          // Verify hash
          const computedHash = hash.digest("hex");
          if (computedHash !== fileHash) {
            try {
              unlinkSync(tmpPath);
            } catch {
              /* ignore */
            }
            return reply.code(400).send({
              error: `Hash mismatch. Expected: ${fileHash}, got: ${computedHash}`,
            });
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

          return reply.send({ id: attachmentId });
        } catch (err) {
          logService.error(`[Hub:Attachment] Upload error: ${err}`);
          return reply.code(500).send({ error: "Internal server error" });
        }
      },
    );
  });

  // Download routes
  async function handleDownload(
    publicId: string,
    request: { headers: { authorization?: string } },
    reply: {
      code: (c: number) => { send: (body: unknown) => unknown };
      header: (name: string, value: string | number) => typeof reply;
      send: (body: unknown) => unknown;
    },
  ) {
    const apiKey = extractBearerToken(request.headers.authorization);
    if (!apiKey) {
      return reply.code(401).send({ error: "Missing Authorization header" });
    }

    const userId = await resolveUserByApiKey(apiKey);
    if (userId == null) {
      return reply.code(401).send({ error: "Invalid API key" });
    }

    if (!publicId) {
      return reply.code(400).send({ error: "Missing attachment ID" });
    }

    const attachment = await hubDb.attachments.findUnique({
      where: { public_id: publicId },
    });

    if (!attachment) {
      return reply.code(404).send({ error: "Attachment not found" });
    }

    if (!existsSync(attachment.filepath)) {
      return reply
        .code(404)
        .send({ error: "Attachment file missing from disk" });
    }

    const stat = statSync(attachment.filepath);
    const contentType = mimeFromFilename(attachment.filename);
    const disposition = contentType.startsWith("image/")
      ? "inline"
      : "attachment";

    reply
      .header("Content-Type", contentType)
      .header(
        "Content-Disposition",
        `${disposition}; filename="${attachment.filename.replace(/"/g, '\\"')}"`,
      )
      .header("Content-Length", stat.size);

    const readStream = createReadStream(attachment.filepath);
    return reply.send(readStream);
  }

  fastify.get<{ Params: { publicId: string; filename: string } }>(
    "/hub/attachments/:publicId/:filename",
    async (request, reply) => {
      try {
        return await handleDownload(request.params.publicId, request, reply);
      } catch (err) {
        logService.error(`[Hub:Attachment] Download error: ${err}`);
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  fastify.get<{ Params: { publicId: string } }>(
    "/hub/attachments/:publicId",
    async (request, reply) => {
      try {
        return await handleDownload(request.params.publicId, request, reply);
      } catch (err) {
        logService.error(`[Hub:Attachment] Download error: ${err}`);
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );
}
