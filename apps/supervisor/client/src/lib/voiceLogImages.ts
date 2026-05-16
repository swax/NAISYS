import { isImageFilename } from "@naisys/common";
import type { LogPushEntry } from "@naisys/hub-protocol";

import { API_BASE, apiEndpoints } from "./apiClient";

/**
 * Image-attachment helpers for the voice agent's run-log narration. Picks the
 * image-bearing entries out of a buffered batch, fetches them auth-aware from
 * the supervisor's /attachments endpoint, and converts to base64 data URLs for
 * injection as `input_image` items on the realtime conversation.
 *
 * Caps keep a screenshot-heavy command from blowing out a single digest's
 * cost (gpt-realtime images run ~1-2k tokens each at $5/M). Larger files are
 * skipped entirely rather than down-sampled — phase 1 keeps the data path
 * simple and trusts upstream attachments are sized reasonably.
 */

/** Max images attached to a single digest's conversation.item.create. A busy
 *  desktop session can drop several screenshots in one buffer window; the cap
 *  bounds the per-turn image cost while still giving the model visual context. */
export const MAX_IMAGES_PER_DIGEST = 4;

/** Skip images larger than this — base64 inflates them ~33% and very large
 *  files dominate one digest's payload. The runs page renders them fine; the
 *  voice agent just doesn't see them. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Supervisor enriches LogPushEntry with `attachmentDownloadUrl` before
 *  emitting on the logs:* room. The hub-protocol schema doesn't declare it,
 *  so widen locally — same pattern useContextLog.ts uses. */
export type LogPushEntryWithUrl = LogPushEntry & {
  attachmentDownloadUrl?: string;
};

export interface VoiceLogImage {
  /** Stable id; used for dedup across digests in the same session. */
  attachmentId: string;
  filename: string;
  fileSize: number;
}

/** True when the entry carries a renderable image attachment with usable
 *  metadata. Obfuscated attachments (no `view_run_logs` permission) are
 *  filtered by the supervisor before they reach this client, so a missing or
 *  empty id here means the entry is text-only. */
export function pickImage(entry: LogPushEntry): VoiceLogImage | null {
  const id = entry.attachmentId;
  const filename = entry.attachmentFilename;
  if (!id || !filename) return null;
  if (!isImageFilename(filename)) return null;
  return {
    attachmentId: id,
    filename,
    fileSize: entry.attachmentFileSize ?? 0,
  };
}

/** Fetch one attachment and return it as a base64 data URL suitable for the
 *  realtime API's `input_image.image_url` field. Returns null on any failure
 *  (network, oversize, auth) — narration falls back to text-only. */
export async function fetchImageAsDataUrl(
  image: VoiceLogImage,
  signal?: AbortSignal,
): Promise<string | null> {
  if (image.fileSize > MAX_IMAGE_BYTES) {
    console.debug("[Voice] skipping oversized image", {
      attachmentId: image.attachmentId,
      fileSize: image.fileSize,
    });
    return null;
  }

  try {
    const url =
      API_BASE +
      apiEndpoints.attachmentDownload(image.attachmentId, image.filename);
    const response = await fetch(url, { credentials: "include", signal });
    if (!response.ok) {
      console.warn("[Voice] image fetch failed", {
        attachmentId: image.attachmentId,
        status: response.status,
      });
      return null;
    }
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) {
      console.debug("[Voice] skipping oversized image (post-fetch)", {
        attachmentId: image.attachmentId,
        size: blob.size,
      });
      return null;
    }
    return await blobToDataUrl(blob);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return null;
    console.warn("[Voice] image fetch threw", {
      attachmentId: image.attachmentId,
      error,
    });
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}
