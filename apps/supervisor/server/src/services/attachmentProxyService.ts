import { createHash } from "crypto";
import https from "https";
import type { FastifyReply } from "fastify";
import { hubDb } from "../database/hubDb.js";
import { getHubUrl } from "./hubConnectionService.js";
import { getLogger } from "../logger.js";

/**
 * Upload a file buffer to the hub's attachment endpoint.
 * Returns the attachment ID from the hub.
 */
export async function uploadToHub(
  fileBuffer: Buffer,
  filename: string,
  uploadAsUserId: number,
): Promise<number> {
  const hubUrl = getHubUrl();
  if (!hubUrl) {
    throw new Error("Hub URL not configured");
  }

  // Look up user's API key from the hub DB
  const user = await hubDb.users.findUnique({
    where: { id: uploadAsUserId },
    select: { api_key: true },
  });

  if (!user?.api_key) {
    throw new Error(`User ${uploadAsUserId} has no API key`);
  }

  // Compute SHA-256 of file buffer
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");

  const url = new URL("/attachments", hubUrl);
  url.searchParams.set("apiKey", user.api_key);
  url.searchParams.set("filename", filename);
  url.searchParams.set("filesize", String(fileBuffer.length));
  url.searchParams.set("filehash", fileHash);

  const response = await new Promise<{ id: number }>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "Content-Length": fileBuffer.length,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode !== 200) {
              reject(
                new Error(
                  parsed.error || `Hub upload failed with status ${res.statusCode}`,
                ),
              );
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid response from hub: ${body}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.end(fileBuffer);
  });

  getLogger().info(
    `Uploaded attachment ${response.id} (${filename}) for user ${uploadAsUserId}`,
  );

  return response.id;
}

/**
 * Proxy a download request from the client through to the hub's attachment endpoint.
 * Streams the file directly from hub to client.
 */
export async function proxyDownloadFromHub(
  attachmentId: number,
  reply: FastifyReply,
): Promise<void> {
  const hubUrl = getHubUrl();
  if (!hubUrl) {
    throw new Error("Hub URL not configured");
  }

  // Look up the attachment to get the uploader's user ID
  const attachment = await hubDb.mail_attachments.findUnique({
    where: { id: attachmentId },
    select: { uploaded_by: true },
  });

  if (!attachment) {
    reply.code(404).send({ error: "Attachment not found" });
    return;
  }

  // Look up the uploader's API key
  const user = await hubDb.users.findUnique({
    where: { id: attachment.uploaded_by },
    select: { api_key: true },
  });

  if (!user?.api_key) {
    reply.code(500).send({ error: "Cannot authenticate download to hub" });
    return;
  }

  const url = new URL(`/attachments/${attachmentId}`, hubUrl);
  url.searchParams.set("apiKey", user.api_key);

  return new Promise<void>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        if (res.statusCode !== 200) {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            reply.code(res.statusCode || 500).send({
              error: `Hub download failed: ${body}`,
            });
            resolve();
          });
          return;
        }

        // Forward headers from hub
        if (res.headers["content-disposition"]) {
          reply.header("content-disposition", res.headers["content-disposition"]);
        }
        if (res.headers["content-type"]) {
          reply.header("content-type", res.headers["content-type"]);
        }
        if (res.headers["content-length"]) {
          reply.header("content-length", res.headers["content-length"]);
        }

        reply.send(res);
        resolve();
      },
    );

    req.on("error", (err) => {
      getLogger().error(err, "Error proxying attachment download");
      reject(err);
    });
    req.end();
  });
}
