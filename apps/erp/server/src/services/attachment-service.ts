import { MAX_ATTACHMENT_SIZE } from "@naisys/common";
import { createHash, randomBytes } from "crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "fs";
import { join } from "path";

import erpDb from "../erpDb.js";

function attachmentsDir(): string {
  return join(process.env.NAISYS_FOLDER || "", "attachments");
}

export interface UploadResult {
  attachmentId: string;
  filename: string;
  fileSize: number;
  fileHash: string;
}

/**
 * Store a file buffer as a content-addressable attachment under
 * attachments/erp/<first2>/<next2>/<fullhash>
 * and create the DB records (Attachment + FieldAttachment).
 */
export async function uploadAttachment(
  fileBuffer: Buffer,
  filename: string,
  uploadedById: number,
  fieldValueId: number,
): Promise<UploadResult> {
  if (fileBuffer.length === 0) {
    throw new Error("Empty file");
  }
  if (fileBuffer.length > MAX_ATTACHMENT_SIZE) {
    throw new Error(`File too large. Max size: ${MAX_ATTACHMENT_SIZE} bytes`);
  }

  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");

  // Write to temp, then move to content-addressable path
  const tmpDir = join(process.env.NAISYS_FOLDER || "", "tmp", "erp", "attachments");
  mkdirSync(tmpDir, { recursive: true });

  const tmpPath = join(
    tmpDir,
    `${Date.now()}_${uploadedById}_${Math.random().toString(36).slice(2)}`,
  );

  const ws = createWriteStream(tmpPath);
  await new Promise<void>((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error", reject);
    ws.end(fileBuffer);
  });

  const storageDir = join(
    attachmentsDir(),
    "erp",
    fileHash.slice(0, 2),
    fileHash.slice(2, 4),
  );
  mkdirSync(storageDir, { recursive: true });
  const storagePath = join(storageDir, fileHash);

  if (existsSync(storagePath)) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  } else {
    renameSync(tmpPath, storagePath);
  }

  // Create Attachment + FieldAttachment in a transaction
  const attachment = await erpDb.$transaction(async (tx) => {
    const att = await tx.attachment.create({
      data: {
        publicId: randomBytes(8).toString("base64url").slice(0, 10),
        filepath: storagePath,
        filename,
        fileSize: fileBuffer.length,
        fileHash,
        uploadedById,
      },
    });

    await tx.fieldAttachment.create({
      data: {
        fieldValueId,
        attachmentId: att.id,
      },
    });

    return att;
  });

  return {
    attachmentId: attachment.publicId,
    filename: attachment.filename,
    fileSize: attachment.fileSize,
    fileHash: attachment.fileHash,
  };
}

/**
 * List attachments for a field value.
 */
export async function listAttachmentsForFieldValue(
  fieldValueId: number,
): Promise<{ id: string; filename: string; fileSize: number }[]> {
  const links = await erpDb.fieldAttachment.findMany({
    where: { fieldValueId },
    include: {
      attachment: {
        select: { publicId: true, filename: true, fileSize: true },
      },
    },
  });
  return links.map((l) => ({
    id: l.attachment.publicId,
    filename: l.attachment.filename,
    fileSize: l.attachment.fileSize,
  }));
}

/**
 * Get an attachment's file path for download.
 */
export async function getAttachmentFilePath(
  publicId: string,
): Promise<{ filepath: string; filename: string } | null> {
  const att = await erpDb.attachment.findUnique({
    where: { publicId },
    select: { filepath: true, filename: true },
  });
  return att;
}

/**
 * Delete a field attachment link. Does NOT delete the file on disk
 * (other records may reference the same content-addressable file).
 */
export async function deleteFieldAttachment(
  fieldValueId: number,
  publicId: string,
): Promise<void> {
  const att = await erpDb.attachment.findUnique({
    where: { publicId },
    select: { id: true },
  });
  if (!att) throw new Error("Attachment not found");

  await erpDb.fieldAttachment.delete({
    where: {
      fieldValueId_attachmentId: { fieldValueId, attachmentId: att.id },
    },
  });
}
