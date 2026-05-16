import { mimeFromFilename } from "@naisys/common";
import { randomBytes } from "crypto";
import { createReadStream, existsSync, statSync } from "fs";
import { join } from "path";

export const MAX_HUB_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/** Content-addressable layout shared between supervisor uploads and hub uploads/downloads — keep readers and writers in sync. */
export function getHubAttachmentPath(
  naisysFolder: string,
  fileHash: string,
): { storageDir: string; storagePath: string } {
  const storageDir = join(
    naisysFolder,
    "attachments",
    "hub",
    fileHash.slice(0, 2),
    fileHash.slice(2, 4),
  );
  return { storageDir, storagePath: join(storageDir, fileHash) };
}

export function generateAttachmentPublicId(): string {
  return randomBytes(16).toString("base64url");
}

interface AttachmentReply {
  code(code: number): { send(body: unknown): unknown };
  header(name: string, value: string | number): AttachmentReply;
  send(body: unknown): unknown;
}

export function sendAttachmentResponse(
  reply: AttachmentReply,
  filepath: string,
  filename: string,
): unknown {
  if (!existsSync(filepath)) {
    return reply.code(404).send({ error: "Attachment file missing from disk" });
  }
  const stat = statSync(filepath);
  const contentType = mimeFromFilename(filename);
  const disposition = contentType.startsWith("image/")
    ? "inline"
    : "attachment";

  reply
    .header("Content-Type", contentType)
    .header(
      "Content-Disposition",
      `${disposition}; filename="${filename.replace(/"/g, '\\"')}"`,
    )
    .header("Content-Length", stat.size);

  return reply.send(createReadStream(filepath));
}
