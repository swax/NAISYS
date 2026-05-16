import type { ThreadRunCommand } from "../hooks/thread-runs/useThreadRunCommands";

// Polyfill for Array.prototype.findLast (ES2023). The codebase targets ES2022,
// so the built-in isn't visible to TypeScript.
function findLast<T>(arr: T[], predicate: (value: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return undefined;
}

export interface BucketedRunCommands {
  /**
   * Header bucket — commands rendered at the top of the next same-user
   * message bubble. Keeps activity grouped with the reply it led up to;
   * preferred over the footer when both could fit.
   */
  beforeMessage: Map<number, ThreadRunCommand[]>;
  /**
   * Footer bucket — commands rendered at the bottom of the immediately
   * preceding same-user message bubble. Absorbs follow-up activity (polling,
   * idle waits) after a reply so it doesn't spawn its own bubble. Only used
   * when no header attachment is available.
   */
  afterMessage: Map<number, ThreadRunCommand[]>;
  /**
   * Phantom bubble inserted before a different-user message, for commands
   * whose user has no surrounding message of their own to host them.
   * Outer key = message id; inner key = command's username.
   */
  phantomsBeforeMessage: Map<number, Map<string, ThreadRunCommand[]>>;
  /**
   * Trailing phantom bubble after the entire thread, for commands with no
   * following message and no preceding same-user message — the user has
   * nothing in the visible thread to attach to.
   */
  trailing: Map<string, ThreadRunCommand[]>;
}

const EMPTY: BucketedRunCommands = {
  beforeMessage: new Map(),
  afterMessage: new Map(),
  phantomsBeforeMessage: new Map(),
  trailing: new Map(),
};

/**
 * Place each command into one of four buckets based on the surrounding
 * messages. Priority order, first match wins:
 *
 *   1. Header on the next same-user message (preferred).
 *   2. Footer on the immediately preceding same-user message.
 *   3. Phantom before the next message (different user).
 *   4. Trailing phantom (no following message at all).
 *
 * `hasOlderMessages` indicates that older messages exist outside the loaded
 * window. When true, commands timestamped before the oldest visible message
 * are dropped — they belong to messages that aren't yet rendered, and
 * attaching them to the oldest visible message would misplace them.
 */
export function bucketRunCommandsByMessage(
  messages: Array<{ id: number; fromUsername: string; createdAt: string }>,
  commands: ThreadRunCommand[],
  hasOlderMessages: boolean = false,
): BucketedRunCommands {
  if (commands.length === 0) return EMPTY;

  const sortedMsgs = [...messages].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const oldestVisibleMs =
    hasOlderMessages && sortedMsgs.length > 0
      ? new Date(sortedMsgs[0].createdAt).getTime()
      : null;

  const beforeMessage = new Map<number, ThreadRunCommand[]>();
  const afterMessage = new Map<number, ThreadRunCommand[]>();
  const phantomsBeforeMessage = new Map<
    number,
    Map<string, ThreadRunCommand[]>
  >();
  const trailing = new Map<string, ThreadRunCommand[]>();

  for (const cmd of commands) {
    const cmdTime = new Date(cmd.createdAt).getTime();
    if (oldestVisibleMs !== null && cmdTime < oldestVisibleMs) continue;

    const nextMsg = sortedMsgs.find(
      (m) => new Date(m.createdAt).getTime() >= cmdTime,
    );

    if (nextMsg && nextMsg.fromUsername === cmd.username) {
      const list = beforeMessage.get(nextMsg.id) ?? [];
      list.push(cmd);
      beforeMessage.set(nextMsg.id, list);
      continue;
    }

    // Footer requires the *immediately* preceding message to be from this
    // user. An other-user message in between disqualifies — by then the
    // conversation has moved on and these commands no longer belong to the
    // earlier reply.
    const prevMsg = findLast(
      sortedMsgs,
      (m) => new Date(m.createdAt).getTime() < cmdTime,
    );

    if (prevMsg && prevMsg.fromUsername === cmd.username) {
      const list = afterMessage.get(prevMsg.id) ?? [];
      list.push(cmd);
      afterMessage.set(prevMsg.id, list);
      continue;
    }

    if (!nextMsg) {
      const list = trailing.get(cmd.username) ?? [];
      list.push(cmd);
      trailing.set(cmd.username, list);
      continue;
    }

    let perUser = phantomsBeforeMessage.get(nextMsg.id);
    if (!perUser) {
      perUser = new Map();
      phantomsBeforeMessage.set(nextMsg.id, perUser);
    }
    const list = perUser.get(cmd.username) ?? [];
    list.push(cmd);
    perUser.set(cmd.username, list);
  }

  for (const list of beforeMessage.values()) {
    list.sort((a, b) => a.logId - b.logId);
  }
  for (const list of afterMessage.values()) {
    list.sort((a, b) => a.logId - b.logId);
  }
  for (const perUser of phantomsBeforeMessage.values()) {
    for (const list of perUser.values()) {
      list.sort((a, b) => a.logId - b.logId);
    }
  }
  for (const list of trailing.values()) {
    list.sort((a, b) => a.logId - b.logId);
  }

  return { beforeMessage, afterMessage, phantomsBeforeMessage, trailing };
}
