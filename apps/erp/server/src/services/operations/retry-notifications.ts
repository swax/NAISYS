import type { PrismaClient } from "../../generated/prisma/client.js";

export interface RetryNotification {
  managerUuid: string;
  deliveryKey: string;
  body: string;
}

/** A durable outbox backed by the failed operation. Only the notification is
 * automatic; the manager must re-check the blocker and explicitly reopen. */
export function createRetryNotifier(
  db: PrismaClient,
  deliver: (notification: RetryNotification) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tick(now = new Date()) {
    if (running || stopped) return;
    running = true;
    try {
      const due = await db.operationRun.findMany({
        where: {
          status: "failed",
          retryNotBefore: { lte: now },
          retryWakeSentAt: null,
          retryManager: { deletedAt: null },
          orderRun: { status: "started" },
        },
        include: {
          retryManager: true,
          operation: true,
          orderRun: { include: { order: true } },
        },
      });
      for (const op of due) {
        if (stopped) break;
        const deadline = op.retryNotBefore!;
        const manager = op.retryManager!;
        const occurrence = {
          id: op.id,
          status: "failed" as const,
          retryNotBefore: deadline,
          retryManagerId: manager.id,
          retryWakeSentAt: null,
          orderRun: { status: "started" as const },
        };
        // A cancelled/reopened order must not be woken from an old poll result.
        if (
          !(await db.operationRun.findFirst({
            where: occurrence,
            select: { id: true },
          }))
        )
          continue;
        const { runNo, order } = op.orderRun;
        try {
          await deliver({
            managerUuid: manager.uuid,
            deliveryKey: `erp-retry:${manager.uuid}:${op.id}:${deadline.toISOString()}`,
            body:
              `Deferred retry is now eligible: ${order.key} run ${runNo}, Op ${op.operation.seqNo} (${op.operation.title}).\n` +
              `Retry time: ${deadline.toISOString()}. Blocker: ${op.statusNote ?? "unspecified"}\n` +
              `Inspect /erp/orders/${encodeURIComponent(order.key)}/runs/${runNo} and current agent availability. Re-check the blocker, then explicitly reopen and dispatch this existing operation if appropriate. If still blocked, record a new conservative retry time. Do not create a new order or enable recurring scheduling. Re-read current ERP state; this notification may have waited in a queue.`,
          });
          // The hub deduplicates the delivery key, including a lost ack/restart.
          // Keep the user's edit timestamp intact: this is delivery metadata.
          await db.operationRun.updateMany({
            where: { ...occurrence, updatedAt: op.updatedAt },
            data: { retryWakeSentAt: now, updatedAt: op.updatedAt },
          });
        } catch (error) {
          onError(error);
        }
      }
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || stopped) return;
    timer = setInterval(() => void tick(), 30_000);
    timer.unref();
    void tick(); // includes deadlines missed while offline
  }
  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return { tick, start, stop };
}
