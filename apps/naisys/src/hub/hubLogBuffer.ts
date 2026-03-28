import {
  HubEvents,
  LOG_FLUSH_INTERVAL_MS,
  type LogWriteEntry,
} from "@naisys/hub-protocol";

import type { HubClient } from "./hubClient.js";

/** Buffered log entry that may need an attachment uploaded before sending */
interface BufferedLogEntry {
  entry: LogWriteEntry;
  resolveAttachment?: () => Promise<number | undefined>;
}

/**
 * Shared log write buffer for all agent runtimes on this NAISYS host.
 * Flushes buffered entries to the hub on a single timer, capping the
 * update rate regardless of how many agents are running.
 */
export function createHubLogBuffer(hubClient: HubClient) {
  const buffer: BufferedLogEntry[] = [];
  let isFlushing = false;

  const flushInterval = setInterval(() => void flush(), LOG_FLUSH_INTERVAL_MS);

  function pushEntry(
    entry: LogWriteEntry,
    resolveAttachment?: () => Promise<number | undefined>,
  ) {
    buffer.push({ entry, resolveAttachment });
  }

  async function flush() {
    if (buffer.length === 0) return;
    if (isFlushing) return;

    isFlushing = true;
    try {
      const items = buffer.splice(0, buffer.length);

      // Resolve any pending attachment uploads
      for (const item of items) {
        if (item.resolveAttachment) {
          try {
            item.entry.attachmentId = await item.resolveAttachment();
          } catch {
            // Upload failed — log entry will be sent without attachment
          }
        }
      }

      const entries = items.map((item) => item.entry);
      hubClient.sendMessage(HubEvents.LOG_WRITE, { entries });
    } finally {
      isFlushing = false;
    }
  }

  function cleanup() {
    clearInterval(flushInterval);
    void flush();
  }

  return {
    pushEntry,
    cleanup,
  };
}

export type HubLogBuffer = ReturnType<typeof createHubLogBuffer>;
