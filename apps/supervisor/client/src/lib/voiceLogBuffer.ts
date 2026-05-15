import type { LogPushEntry } from "@naisys/hub-protocol";

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
 * `onDigest`; returning false keeps the buffered entries intact so the
 * caller can retry when its delivery gate opens.
 */
export interface VoiceLogBuffer {
  add(entries: LogPushEntry[]): void;
  drainNow(): void;
  clear(): void;
}

export function createVoiceLogBuffer(
  onDigest: (digest: string) => boolean,
): VoiceLogBuffer {
  let pendingEntries: LogPushEntry[] = [];
  let omittedCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const buffer: VoiceLogBuffer = {
    add,
    drainNow,
    clear,
  };

  /** Append entries (filtered for narration relevance), cap the buffer,
   *  arm the flush timer if not already armed. */
  function add(entries: LogPushEntry[]): void {
    const meaningful = entries.filter(shouldNarrateLogEntry);
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
  }

  function flush(): boolean {
    if (pendingEntries.length === 0) return false;
    const entries = pendingEntries;
    const omittedBefore = omittedCount;
    const accepted = onDigest(buildLogDigest(entries, omittedBefore));
    if (!accepted) return false;
    pendingEntries = [];
    omittedCount = 0;
    return true;
  }

  return buffer;
}
