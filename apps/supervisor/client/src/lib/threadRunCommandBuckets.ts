import type { ThreadRunCommand } from "../hooks/useThreadRunCommands";

export interface BucketedRunCommands {
  /** Commands attached to the next chronological message from the same user. */
  beforeMessage: Map<number, ThreadRunCommand[]>;
  /**
   * Commands that have no following message from the same user — i.e. the
   * user is mid-turn (still working) or finished a run without replying.
   * Keyed by username.
   */
  trailing: Map<string, ThreadRunCommand[]>;
}

const EMPTY: BucketedRunCommands = {
  beforeMessage: new Map(),
  trailing: new Map(),
};

/**
 * Group commands under the next chat message from the same agent. Anything
 * after that agent's last message goes into the per-user trailing bucket so
 * the UI can render an in-progress / phantom bubble.
 */
export function bucketRunCommandsByMessage(
  messages: Array<{ id: number; fromUsername: string; createdAt: string }>,
  commands: ThreadRunCommand[],
): BucketedRunCommands {
  if (commands.length === 0) return EMPTY;

  const messagesByUser = new Map<
    string,
    Array<{ id: number; time: number }>
  >();
  for (const m of messages) {
    const list = messagesByUser.get(m.fromUsername) ?? [];
    list.push({ id: m.id, time: new Date(m.createdAt).getTime() });
    messagesByUser.set(m.fromUsername, list);
  }
  for (const list of messagesByUser.values()) {
    list.sort((a, b) => a.time - b.time);
  }

  const beforeMessage = new Map<number, ThreadRunCommand[]>();
  const trailing = new Map<string, ThreadRunCommand[]>();

  for (const cmd of commands) {
    const userMsgs = messagesByUser.get(cmd.username) ?? [];
    const cmdTime = new Date(cmd.createdAt).getTime();
    const nextMsg = userMsgs.find((m) => m.time >= cmdTime);

    if (nextMsg) {
      const list = beforeMessage.get(nextMsg.id) ?? [];
      list.push(cmd);
      beforeMessage.set(nextMsg.id, list);
    } else {
      const list = trailing.get(cmd.username) ?? [];
      list.push(cmd);
      trailing.set(cmd.username, list);
    }
  }

  // Defensive sort so the latest entry is always last.
  for (const list of beforeMessage.values()) {
    list.sort((a, b) => a.logId - b.logId);
  }
  for (const list of trailing.values()) {
    list.sort((a, b) => a.logId - b.logId);
  }

  return { beforeMessage, trailing };
}
