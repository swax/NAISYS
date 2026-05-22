import type { StartupAttachment } from "@naisys/supervisor-shared";

import { hubDb } from "../../database/hubDb.js";
import { attachmentUrl } from "../../hateoas.js";
import { uploadToHub } from "../observability/attachmentProxyService.js";

const MAX_PATH_LENGTH = 500;

export function validateAndNormalizePath(rawPath: string): string {
  const path = rawPath.trim();
  if (!path) {
    throw new Error("Path is required");
  }
  if (path.length > MAX_PATH_LENGTH) {
    throw new Error(`Path is too long (max ${MAX_PATH_LENGTH} chars)`);
  }
  if (path.startsWith("/")) {
    throw new Error("Path must be relative (no leading '/')");
  }
  if (path.includes("\\")) {
    throw new Error("Path must use forward slashes");
  }
  if (path.includes("\0")) {
    throw new Error("Path cannot contain null bytes");
  }
  const segments = path.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error("Path cannot contain '..'");
  }
  if (segments.some((s) => s === ".")) {
    throw new Error("Path cannot contain '.' segments");
  }
  if (segments.some((s) => s === "")) {
    throw new Error("Path cannot contain empty segments");
  }
  return path;
}

export async function listStartupAttachments(
  userId: number,
): Promise<StartupAttachment[]> {
  const rows = await hubDb.user_startup_attachments.findMany({
    where: { user_id: userId },
    orderBy: { path: "asc" },
    include: {
      attachment: {
        select: {
          id: true,
          public_id: true,
          filename: true,
          file_size: true,
        },
      },
    },
  });

  return rows.map((r) => ({
    attachmentId: r.attachment.id,
    publicId: r.attachment.public_id,
    filename: r.attachment.filename,
    fileSize: r.attachment.file_size,
    path: r.path,
    createdAt: r.created_at.toISOString(),
    downloadUrl: attachmentUrl(r.attachment.public_id, r.attachment.filename),
  }));
}

export async function addStartupAttachment(
  userId: number,
  fileBuffer: Buffer,
  filename: string,
  rawPath: string,
): Promise<StartupAttachment> {
  const path = validateAndNormalizePath(rawPath);

  const existing = await hubDb.user_startup_attachments.findUnique({
    where: { user_id_path: { user_id: userId, path } },
  });
  if (existing) {
    throw new Error(`A startup attachment already exists at path: ${path}`);
  }

  const attachmentId = await uploadToHub(
    fileBuffer,
    filename,
    userId,
    "context",
  );

  await hubDb.user_startup_attachments.create({
    data: {
      user_id: userId,
      attachment_id: attachmentId,
      path,
    },
  });

  const row = await hubDb.user_startup_attachments.findUniqueOrThrow({
    where: { user_id_path: { user_id: userId, path } },
    include: {
      attachment: {
        select: {
          id: true,
          public_id: true,
          filename: true,
          file_size: true,
        },
      },
    },
  });

  return {
    attachmentId: row.attachment.id,
    publicId: row.attachment.public_id,
    filename: row.attachment.filename,
    fileSize: row.attachment.file_size,
    path: row.path,
    createdAt: row.created_at.toISOString(),
    downloadUrl: attachmentUrl(
      row.attachment.public_id,
      row.attachment.filename,
    ),
  };
}

export async function deleteStartupAttachment(
  userId: number,
  path: string,
): Promise<void> {
  // attachmentGcService reaps the underlying row + file once unreferenced.
  await hubDb.user_startup_attachments.delete({
    where: { user_id_path: { user_id: userId, path } },
  });
}

export async function updateStartupAttachmentPath(
  userId: number,
  oldPath: string,
  rawNewPath: string,
): Promise<StartupAttachment> {
  const newPath = validateAndNormalizePath(rawNewPath);

  if (newPath === oldPath) {
    const list = await listStartupAttachments(userId);
    const found = list.find((r) => r.path === oldPath);
    if (!found) throw new Error(`No startup attachment at path '${oldPath}'`);
    return found;
  }

  const conflict = await hubDb.user_startup_attachments.findUnique({
    where: { user_id_path: { user_id: userId, path: newPath } },
  });
  if (conflict) {
    throw new Error(`A startup attachment already exists at path: ${newPath}`);
  }

  await hubDb.user_startup_attachments.update({
    where: { user_id_path: { user_id: userId, path: oldPath } },
    data: { path: newPath },
  });

  const list = await listStartupAttachments(userId);
  const found = list.find((r) => r.path === newPath);
  if (!found) throw new Error("Failed to update startup attachment path");
  return found;
}

/**
 * Replace the file content of an existing startup attachment while keeping its
 * `path` and database row stable. Attachment blobs are immutable, so a fresh
 * attachment is uploaded and the row is repointed at it — `attachmentId` and
 * `downloadUrl` change, but there is no window where the path is unoccupied.
 * The previous blob becomes unreferenced and is reaped by attachmentGcService.
 */
export async function replaceStartupAttachmentContent(
  userId: number,
  path: string,
  fileBuffer: Buffer,
  filename: string,
): Promise<StartupAttachment> {
  const existing = await hubDb.user_startup_attachments.findUnique({
    where: { user_id_path: { user_id: userId, path } },
  });
  if (!existing) {
    throw new Error(`No startup attachment at path '${path}'`);
  }

  const attachmentId = await uploadToHub(
    fileBuffer,
    filename,
    userId,
    "context",
  );

  await hubDb.user_startup_attachments.update({
    where: { user_id_path: { user_id: userId, path } },
    data: { attachment_id: attachmentId },
  });

  const list = await listStartupAttachments(userId);
  const found = list.find((r) => r.path === path);
  if (!found) throw new Error("Failed to replace startup attachment content");
  return found;
}
