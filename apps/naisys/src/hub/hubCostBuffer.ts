import {
  COST_FLUSH_INTERVAL_MS,
  type CostWriteEntry,
  CostWriteResponseSchema,
  HubEvents,
} from "@naisys/hub-protocol";

import type { HubClient } from "./hubClient.js";

type BudgetCallback = (budgetLeft: number) => void;

/**
 * Shared cost write buffer for all agent runtimes on this NAISYS host.
 * Flushes buffered entries to the hub on a single timer, capping the
 * update rate regardless of how many agents are running.
 *
 * After each flush, per-user budgetLeft values from the hub response
 * are dispatched to registered callbacks.
 */
export function createHubCostBuffer(hubClient: HubClient) {
  const buffer: CostWriteEntry[] = [];
  let isFlushing = false;

  // Per-user callbacks for budget updates
  const budgetCallbacks = new Map<number, BudgetCallback>();

  const flushInterval = setInterval(() => void flush(), COST_FLUSH_INTERVAL_MS);

  function pushEntry(entry: CostWriteEntry) {
    buffer.push(entry);
  }

  function registerBudgetCallback(userId: number, callback: BudgetCallback) {
    budgetCallbacks.set(userId, callback);
  }

  function unregisterBudgetCallback(userId: number) {
    budgetCallbacks.delete(userId);
  }

  async function flush() {
    if (buffer.length === 0) return;
    if (isFlushing) return;

    isFlushing = true;
    const entries = buffer.splice(0, buffer.length);
    try {
      const response = await hubClient.sendRequest(HubEvents.COST_WRITE, {
        entries,
      });
      const parsed = CostWriteResponseSchema.safeParse(response);
      if (parsed.success) {
        for (const entry of parsed.data.budgets) {
          const cb = budgetCallbacks.get(entry.userId);
          if (cb && entry.budgetLeft !== null) {
            cb(entry.budgetLeft);
          }
        }
      }
    } catch {
      // Silently ignore flush errors — costs are best-effort
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
    registerBudgetCallback,
    unregisterBudgetCallback,
    cleanup,
  };
}

export type HubCostBuffer = ReturnType<typeof createHubCostBuffer>;
