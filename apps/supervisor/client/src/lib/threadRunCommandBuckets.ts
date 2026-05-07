import type { ThreadRunCommand } from "../hooks/useThreadRunCommands";

export interface BucketedRunCommands {
  /**
   * Commands attached to the next chronological message (by any sender) when
   * that message is from the command's own user. Render inline inside the
   * message bubble.
   */
  beforeMessage: Map<number, ThreadRunCommand[]>;
  /**
   * Commands attached to the next chronological message when that message is
   * from a *different* user. Render as a per-user phantom bubble immediately
   * before the message — captures activity the user did between two of the
   * other user's messages, before they replied.
   * Outer key = message id; inner key = command's username.
   */
  phantomsBeforeMessage: Map<number, Map<string, ThreadRunCommand[]>>;
  /**
   * Commands with no chronological next message at all. Render as trailing
   * phantom bubbles after the entire thread.
   */
  trailing: Map<string, ThreadRunCommand[]>;
}

const EMPTY: BucketedRunCommands = {
  beforeMessage: new Map(),
  phantomsBeforeMessage: new Map(),
  trailing: new Map(),
};

/**
 * Bucket each command by the next message (any sender) at or after its time.
 * Same-user next msg → inline with that bubble. Different-user next msg →
 * phantom-before-msg, surfacing activity the user did before the conversation
 * moved on without them replying. No next msg → trailing phantom.
 */
export function bucketRunCommandsByMessage(
  messages: Array<{ id: number; fromUsername: string; createdAt: string }>,
  commands: ThreadRunCommand[],
): BucketedRunCommands {
  if (commands.length === 0) return EMPTY;

  const sortedMsgs = [...messages].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const beforeMessage = new Map<number, ThreadRunCommand[]>();
  const phantomsBeforeMessage = new Map<
    number,
    Map<string, ThreadRunCommand[]>
  >();
  const trailing = new Map<string, ThreadRunCommand[]>();

  for (const cmd of commands) {
    const cmdTime = new Date(cmd.createdAt).getTime();
    const nextMsg = sortedMsgs.find(
      (m) => new Date(m.createdAt).getTime() >= cmdTime,
    );

    if (!nextMsg) {
      const list = trailing.get(cmd.username) ?? [];
      list.push(cmd);
      trailing.set(cmd.username, list);
      continue;
    }

    if (nextMsg.fromUsername === cmd.username) {
      const list = beforeMessage.get(nextMsg.id) ?? [];
      list.push(cmd);
      beforeMessage.set(nextMsg.id, list);
    } else {
      let perUser = phantomsBeforeMessage.get(nextMsg.id);
      if (!perUser) {
        perUser = new Map();
        phantomsBeforeMessage.set(nextMsg.id, perUser);
      }
      const list = perUser.get(cmd.username) ?? [];
      list.push(cmd);
      perUser.set(cmd.username, list);
    }
  }

  for (const list of beforeMessage.values()) {
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

  return { beforeMessage, phantomsBeforeMessage, trailing };
}
