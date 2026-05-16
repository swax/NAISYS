/** "no" = don't wake, "yes" = wake if agent has wakeOnMessage enabled, "always" = always wake */
export type WakeLevel = "no" | "yes" | "always";

/**
 * - `nonCommand`: outputs/wake — draining one bounces the loop to debug.
 * - `debugCommand`: commands run as debug-mode input.
 * - `contextCommand`: commands that replace an LLM query (e.g. preemptive compact).
 */
export type NotificationKind = "nonCommand" | "debugCommand" | "contextCommand";

/** Outputs are always allowed; only the two command kinds are mutually
 *  exclusive. Kind is derived from the populated command field. */
export type PromptNotification = {
  wake: WakeLevel;
  userId?: number;
  processed?: () => void | Promise<void>;
  contextOutput?: string[];
  commentOutput?: string[];
  errorOutput?: string[];
} & (
  | { contextCommands?: never; debugCommands?: never }
  | { contextCommands: string[]; debugCommands?: never }
  | { debugCommands: string[]; contextCommands?: never }
);

export interface ProcessedResult {
  output: ProcessedOutput[];
  contextCommands: string[];
  debugCommands: string[];
  /** True if any notification was actually drained (vs filtered out by kind). */
  drained: boolean;
}

export interface ProcessedOutput {
  type: "context" | "comment" | "error";
  text: string;
}

/** Derive a notification's kind from which payload field is populated. */
export function getNotificationKind(n: PromptNotification): NotificationKind {
  if (n.contextCommands !== undefined) return "contextCommand";
  if (n.debugCommands !== undefined) return "debugCommand";
  return "nonCommand";
}

export function createPromptNotificationService() {
  /** Per-user notification queues keyed by userId */
  const pending = new Map<number, PromptNotification[]>();

  /** Single global notification — new one overwrites old */
  let globalNotification: PromptNotification | null = null;

  /** Tracks which userIds have seen the current global notification */
  const globalNotifiedUserIds = new Set<number>();

  function notify(notification: PromptNotification) {
    if (!notification.userId) {
      // Global notification: overwrite previous, reset seen set
      globalNotification = notification;
      globalNotifiedUserIds.clear();
      return;
    }

    const userId = notification.userId;

    if (!pending.has(userId)) {
      pending.set(userId, []);
    }
    pending.get(userId)!.push(notification);
  }

  function shouldWake(wake: WakeLevel, wakeOnMessage: boolean): boolean {
    return wake === "always" || (wake === "yes" && wakeOnMessage);
  }

  function matchesKind(
    notification: PromptNotification,
    kind: NotificationKind | undefined,
  ): boolean {
    return kind === undefined || getNotificationKind(notification) === kind;
  }

  function hasPending(
    userId: number,
    wakeOnMessage: boolean,
    kind?: NotificationKind,
  ): boolean {
    const userQueue = pending.get(userId) || [];

    // Check user's own queue
    if (
      userQueue.some(
        (n) => matchesKind(n, kind) && shouldWake(n.wake, wakeOnMessage),
      )
    ) {
      return true;
    }

    // Check unseen global notification
    if (
      globalNotification &&
      !globalNotifiedUserIds.has(userId) &&
      matchesKind(globalNotification, kind) &&
      shouldWake(globalNotification.wake, wakeOnMessage)
    ) {
      return true;
    }

    return false;
  }

  function collectNotification(
    notification: PromptNotification,
    result: ProcessedResult,
  ) {
    if (notification.contextOutput) {
      for (const text of notification.contextOutput) {
        result.output.push({ type: "context", text });
      }
    }
    if (notification.commentOutput) {
      for (const text of notification.commentOutput) {
        result.output.push({ type: "comment", text });
      }
    }
    if (notification.errorOutput) {
      for (const text of notification.errorOutput) {
        result.output.push({ type: "error", text });
      }
    }
    if (notification.contextCommands) {
      result.contextCommands.push(...notification.contextCommands);
    }
    if (notification.debugCommands) {
      result.debugCommands.push(...notification.debugCommands);
    }
  }

  /** Drains notifications matching `kind` (or all if omitted); others stay
   *  queued for the path that owns that kind. */
  async function processPending(
    userId: number,
    kind?: NotificationKind,
  ): Promise<ProcessedResult> {
    const result: ProcessedResult = {
      output: [],
      contextCommands: [],
      debugCommands: [],
      drained: false,
    };

    // Process user-specific notifications
    const userQueue = pending.get(userId);
    if (userQueue) {
      const keep: PromptNotification[] = [];
      while (userQueue.length > 0) {
        const notification = userQueue.shift()!;
        if (!matchesKind(notification, kind)) {
          keep.push(notification);
          continue;
        }
        collectNotification(notification, result);
        result.drained = true;
        await notification.processed?.();
      }
      userQueue.push(...keep);
    }

    // Process global notification if unseen and matches kind filter
    if (
      globalNotification &&
      !globalNotifiedUserIds.has(userId) &&
      matchesKind(globalNotification, kind)
    ) {
      globalNotifiedUserIds.add(userId);
      collectNotification(globalNotification, result);
      result.drained = true;
      await globalNotification.processed?.();
    }

    return result;
  }

  return { notify, hasPending, processPending };
}

export type PromptNotificationService = ReturnType<
  typeof createPromptNotificationService
>;
