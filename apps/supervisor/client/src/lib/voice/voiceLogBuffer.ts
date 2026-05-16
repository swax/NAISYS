import type { LogPushEntry } from "@naisys/hub-protocol";

import type { VoiceMode } from "../api/apiClient";
import {
  MAX_IMAGES_PER_DIGEST,
  pickImage,
  type VoiceLogImage,
} from "./voiceLogImages";
import { buildLogDigest, shouldNarrateLogEntry } from "./voiceMessages";

/** Hard bound on buffered log entries before flush. Oldest entries are
 *  dropped first because voice narration is mostly about recent progress. */
const MAX_LOG_BUFFER_ENTRIES = 24;

/** Window for coalescing inbound run-log entries into a single digest.
 *  Without this, a busy agent's per-entry items pile up mid-turn and
 *  bloat the next request's context. */
const LOG_BUFFER_MS = 2_000;

/**
 * Coalesces inbound run-log entries into a single formatted digest. Entries
 * accumulate over LOG_BUFFER_MS and the buffer is capped at
 * MAX_LOG_BUFFER_ENTRIES (oldest dropped). On flush the digest is passed to
 * `onDigest` along with up to MAX_IMAGES_PER_DIGEST new image attachments
 * (deduped across the session so a recurring screenshot isn't re-priced).
 * Returning false from `onDigest` keeps the buffered entries intact so the
 * caller can retry when its delivery gate opens — image dedup state is also
 * rolled back on refusal so the images aren't lost.
 */
export interface VoiceLogBuffer {
  add(entries: LogPushEntry[]): void;
  drainNow(): void;
  clear(): void;
}

export interface VoiceLogDigest {
  text: string;
  /** New image attachments seen in this digest's entries, capped at
   *  MAX_IMAGES_PER_DIGEST and deduped against any sent earlier in the
   *  session. Empty when there are no new images. */
  images: VoiceLogImage[];
  /** Count of images that were detected in the entries but omitted due to
   *  the per-digest cap. Surfaced in the text digest so the model knows. */
  imagesOmitted: number;
}

export function createVoiceLogBuffer(
  onDigest: (digest: VoiceLogDigest) => boolean,
  mode: VoiceMode,
): VoiceLogBuffer {
  let pendingEntries: LogPushEntry[] = [];
  let omittedCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Attachment ids already sent to the realtime conversation. The realtime
  // API caches image content across turns, so re-sending the same id would
  // burn input tokens for no new information (and the model already has it).
  const sentImageIds = new Set<string>();

  const buffer: VoiceLogBuffer = {
    add,
    drainNow,
    clear,
  };

  /** Append entries (filtered for narration relevance per mode), cap the
   *  buffer, arm the flush timer if not already armed. */
  function add(entries: LogPushEntry[]): void {
    const meaningful = entries.filter((e) => shouldNarrateLogEntry(e, mode));
    if (meaningful.length === 0) return;

    pendingEntries.push(...meaningful);
    const overflow = pendingEntries.length - MAX_LOG_BUFFER_ENTRIES;
    if (overflow > 0) {
      pendingEntries = pendingEntries.slice(overflow);
      omittedCount += overflow;
    }

    // If a timer is already ticking, leave it (the window measures from
    // the first entry of the batch, not the latest).
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, LOG_BUFFER_MS);
  }

  /** Force a flush of any buffered entries (e.g. at response.done). No-op
   *  if the buffer is empty. */
  function drainNow(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flush();
  }

  /** Drop all pending state, e.g. at teardown. */
  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingEntries = [];
    omittedCount = 0;
    sentImageIds.clear();
  }

  function flush(): boolean {
    if (pendingEntries.length === 0) return false;
    const entries = pendingEntries;
    const omittedBefore = omittedCount;

    const { images, imagesOmitted, newlySentIds } = collectImages(entries);
    const text = buildLogDigest(entries, omittedBefore);

    const accepted = onDigest({ text, images, imagesOmitted });
    if (!accepted) {
      // Refusal means the entries stay buffered for the next flush; the same
      // images would be re-collected then. Don't pollute sentImageIds with
      // ids we haven't actually delivered.
      return false;
    }
    for (const id of newlySentIds) sentImageIds.add(id);
    pendingEntries = [];
    omittedCount = 0;
    return true;
  }

  /** Walk pendingEntries in order, pick image attachments we haven't sent
   *  before, and cap the result. Returns the chosen images, an omitted
   *  count, and the ids that should join sentImageIds on accepted delivery. */
  function collectImages(entries: LogPushEntry[]): {
    images: VoiceLogImage[];
    imagesOmitted: number;
    newlySentIds: string[];
  } {
    const images: VoiceLogImage[] = [];
    const newlySentIds: string[] = [];
    const seenInBatch = new Set<string>();
    let imagesOmitted = 0;

    for (const entry of entries) {
      const image = pickImage(entry);
      if (!image) continue;
      if (sentImageIds.has(image.attachmentId)) continue;
      if (seenInBatch.has(image.attachmentId)) continue;
      seenInBatch.add(image.attachmentId);

      if (images.length >= MAX_IMAGES_PER_DIGEST) {
        imagesOmitted += 1;
        continue;
      }
      images.push(image);
      newlySentIds.push(image.attachmentId);
    }
    return { images, imagesOmitted, newlySentIds };
  }

  return buffer;
}
