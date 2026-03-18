import { createHash } from "crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "fs";
import { join } from "path";

import erpDb from "../erpDb.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function attachmentsDir(): string {
  return join(process.env.NAISYS_FOLDER || "", "attachments");
}

export interface UploadResult {
  attachmentId: number;
  filename: string;
  fileSize: number;
  fileHash: string;
}

/**
 * Store a file buffer as a content-addressable attachment under
 * attachments/erp/<first2>/<next2>/<fullhash>
 * and create the DB records (Attachment + StepFieldAttachment).
 */
export async function uploadAttachment(
  fileBuffer: Buffer,
  filename: string,
  uploadedById: number,
  stepFieldValueId: number,
): Promise<UploadResult> {
  if (fileBuffer.length === 0) {
    throw new Error("Empty file");
  }
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large. Max size: ${MAX_FILE_SIZE} bytes`);
  }

  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");

  // Write to temp, then move to content-addressable path
  const tmpDir = join(attachmentsDir(), "tmp");
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

  // Create Attachment + StepFieldAttachment in a transaction
  const attachment = await erpDb.$transaction(async (tx) => {
    const att = await tx.attachment.create({
      data: {
        filepath: storagePath,
        filename,
        fileSize: fileBuffer.length,
        fileHash,
        uploadedById,
      },
    });

    await tx.stepFieldAttachment.create({
      data: {
        stepFieldValueId,
        attachmentId: att.id,
      },
    });

    return att;
  });

  return {
    attachmentId: attachment.id,
    filename: attachment.filename,
    fileSize: attachment.fileSize,
    fileHash: attachment.fileHash,
  };
}

/**
 * List attachments for a step field value.
 */
export async function listAttachmentsForFieldValue(
  stepFieldValueId: number,
): Promise<{ id: number; filename: string; fileSize: number }[]> {
  const links = await erpDb.stepFieldAttachment.findMany({
    where: { stepFieldValueId },
    include: {
      attachment: {
        select: { id: true, filename: true, fileSize: true },
      },
    },
  });
  return links.map((l) => l.attachment);
}

/**
 * Get an attachment's file path for download.
 */
export async function getAttachmentFilePath(
  attachmentId: number,
): Promise<{ filepath: string; filename: string } | null> {
  const att = await erpDb.attachment.findUnique({
    where: { id: attachmentId },
    select: { filepath: true, filename: true },
  });
  return att;
}

/**
 * Delete a step field attachment link. Does NOT delete the file on disk
 * (other records may reference the same content-addressable file).
 */
export async function deleteStepFieldAttachment(
  stepFieldValueId: number,
  attachmentId: number,
): Promise<void> {
  await erpDb.stepFieldAttachment.delete({
    where: {
      stepFieldValueId_attachmentId: { stepFieldValueId, attachmentId },
    },
  });
}
