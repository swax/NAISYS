/** "no" = don't wake, "yes" = wake if agent has wakeOnMessage enabled, "always" = always wake */
export type WakeLevel = "no" | "yes" | "always";

export interface PromptNotification {
  wake: WakeLevel;
  userId?: number;
  contextOutput?: string[];
  commentOutput?: string[];
  processed?: () => void | Promise<void>;
}

export interface ProcessedOutput {
  type: "context" | "comment";
  text: string;
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

  function hasPending(userId: number, wakeOnMessage: boolean): boolean {
    const userQueue = pending.get(userId) || [];

    // Check user's own queue
    if (userQueue.some((n) => shouldWake(n.wake, wakeOnMessage))) {
      return true;
    }

    // Check unseen global notification
    if (
      globalNotification &&
      !globalNotifiedUserIds.has(userId) &&
      shouldWake(globalNotification.wake, wakeOnMessage)
    ) {
      return true;
    }

    return false;
  }

  function collectOutput(
    notification: PromptNotification,
    output: ProcessedOutput[],
  ) {
    if (notification.contextOutput) {
      for (const text of notification.contextOutput) {
        output.push({ type: "context", text });
      }
    }
    if (notification.commentOutput) {
      for (const text of notification.commentOutput) {
        output.push({ type: "comment", text });
      }
    }
  }

  async function processPending(userId: number): Promise<ProcessedOutput[]> {
    const output: ProcessedOutput[] = [];

    // Process user-specific notifications
    const userQueue = pending.get(userId);
    if (userQueue) {
      while (userQueue.length > 0) {
        const notification = userQueue.shift()!;
        collectOutput(notification, output);
        await notification.processed?.();
      }
    }

    // Process global notification if unseen
    if (globalNotification && !globalNotifiedUserIds.has(userId)) {
      globalNotifiedUserIds.add(userId);
      collectOutput(globalNotification, output);
      await globalNotification.processed?.();
    }

    return output;
  }

  return { notify, hasPending, processPending };
}

export type PromptNotificationService = ReturnType<
  typeof createPromptNotificationService
>;
