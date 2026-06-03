import * as utilities from "../utils/utilities.js";

/**
 * Bounded byte buffer for shell command output. Keeps the first `headMax`
 * bytes and a rolling window of the last `tailMax` bytes; bytes in the middle
 * are dropped with a count. Prevents OOM on runaway commands (e.g.
 * `cat /dev/urandom`) before downstream token-based truncation runs.
 */
export function createOutputBuffer(headMax: number, tailMax: number) {
  let head = "";
  let tail = "";
  let dropped = 0;

  return {
    append(data: string) {
      if (head.length < headMax) {
        const room = headMax - head.length;
        if (data.length <= room) {
          head += data;
          return;
        }
        // Keep a surrogate pair whole across the head/tail boundary — once a
        // drop marker is inserted between them in get(), a head ending on a
        // lone high surrogate becomes invalid JSON.
        const cut = utilities.surrogateSafeEnd(data, room);
        head += data.slice(0, cut);
        data = data.slice(cut);
      }
      tail += data;
      // Amortize: only slice when 2x over so total work stays O(n) on many
      // small chunks instead of O(n^2).
      if (tail.length > tailMax * 2) {
        // Drop the orphaned low surrogate too if the trim front lands mid-pair.
        const overflow = utilities.surrogateSafeStart(
          tail,
          tail.length - tailMax,
        );
        tail = tail.slice(overflow);
        dropped += overflow;
      }
    },
    get(): string {
      if (dropped === 0) return head + tail;
      return (
        head +
        `\n\n[... ${dropped.toLocaleString()} bytes dropped to prevent OOM ...]\n\n` +
        tail
      );
    },
    reset() {
      head = "";
      tail = "";
      dropped = 0;
    },
    get sizeBytes() {
      return head.length + tail.length;
    },
  };
}

export type OutputBuffer = ReturnType<typeof createOutputBuffer>;
