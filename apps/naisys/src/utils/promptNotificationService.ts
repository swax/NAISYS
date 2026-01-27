export interface PromptNotification {
  type: string;
  wake: boolean;
  process?: () => Promise<void>;
}

export function createPromptNotificationService() {
  const pending: PromptNotification[] = [];

  function notify(notification: PromptNotification) {
    pending.push(notification);
  }

  function hasPending(filter?: "wake"): boolean {
    if (filter === "wake") {
      return pending.some((n) => n.wake);
    }
    return pending.length > 0;
  }

  async function processPending(): Promise<void> {
    while (pending.length > 0) {
      const notification = pending.shift()!;
      await notification.process?.();
    }
  }

  return { notify, hasPending, processPending };
}

export type PromptNotificationService = ReturnType<
  typeof createPromptNotificationService
>;
