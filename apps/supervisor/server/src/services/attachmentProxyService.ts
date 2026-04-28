import {
  generateAttachmentPublicId,
  getHubAttachmentPath,
  MAX_HUB_ATTACHMENT_SIZE,
  sendAttachmentResponse,
} from "@naisys/common-node";
import { createHash, randomBytes } from "crypto";
import type { FastifyReply } from "fastify";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "fs";

import { hubDb } from "../database/hubDb.js";
import { getLogger } from "../logger.js";

/**
 * Store a file buffer in the hub attachment store.
 * Returns the attachment ID from the hub DB.
 */
export async function uploadToHub(
  fileBuffer: Buffer,
  filename: string,
  uploadAsUserId: number,
  purpose: string = "mail",
): Promise<number> {
  if (purpose !== "mail" && purpose !== "context") {
    throw new Error('Invalid purpose. Must be "mail" or "context"');
  }

  if (fileBuffer.length > MAX_HUB_ATTACHMENT_SIZE) {
    throw new Error(
      `File too large. Max size: ${MAX_HUB_ATTACHMENT_SIZE} bytes`,
    );
  }

  const naisysFolder = process.env.NAISYS_FOLDER || "";
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
  const { storageDir, storagePath } = getHubAttachmentPath(
    naisysFolder,
    fileHash,
  );
  mkdirSync(storageDir, { recursive: true });

  if (!existsSync(storagePath)) {
    const tmpPath = `${storagePath}.tmp.${randomBytes(4).toString("hex")}`;
    writeFileSync(tmpPath, fileBuffer);
    renameSync(tmpPath, storagePath);
  }

  const record = await hubDb.attachments.create({
    data: {
      public_id: generateAttachmentPublicId(),
      filepath: storagePath,
      filename,
      file_size: fileBuffer.length,
      file_hash: fileHash,
      purpose,
      uploaded_by: uploadAsUserId,
    },
  });

  getLogger().info(
    `Uploaded attachment ${record.id} (${filename}) for user ${uploadAsUserId}`,
  );

  return record.id;
}

/**
 * Proxy a download request from the client from the hub attachment store.
 * Streams the file directly from disk to the client.
 */
export async function proxyDownloadFromHub(
  publicId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const attachment = await hubDb.attachments.findUnique({
    where: { public_id: publicId },
  });

  if (!attachment) {
    return reply.code(404).send({ error: "Attachment not found" });
  }

  return sendAttachmentResponse(
    reply,
    attachment.filepath,
    attachment.filename,
  ) as FastifyReply;
}
