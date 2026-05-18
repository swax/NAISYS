import { sumAgentMetricsByUuid } from "@naisys/hub-database";
import { OperationRunStatus } from "@naisys/erp-shared";

import erpDb from "../../database/erpDb.js";

/**
 * Populate `tokens` on labor tickets and operation runs finalized before the
 * column existed. Idempotent — only touches rows where `tokens IS NULL`, and
 * only for agent users (others can't have tokens, so their rows stay NULL
 * and the next startup ignores them too). Requires the hub DB client.
 */
export async function backfillOpRunTokens(): Promise<void> {
  const tickets = await erpDb.laborTicket.findMany({
    where: {
      tokens: null,
      clockOut: { not: null },
      operationRun: {
        status: {
          in: [
            OperationRunStatus.completed,
            OperationRunStatus.skipped,
            OperationRunStatus.failed,
          ],
        },
      },
      user: { isAgent: true },
    },
    select: {
      id: true,
      operationRunId: true,
      clockIn: true,
      clockOut: true,
      user: { select: { uuid: true } },
    },
  });

  if (tickets.length === 0) return;

  const dirtyOpRunIds = new Set<number>();

  for (const ticket of tickets) {
    const { tokens } = await sumAgentMetricsByUuid(
      ticket.user.uuid,
      ticket.clockIn,
      ticket.clockOut!,
    );
    await erpDb.laborTicket.update({
      where: { id: ticket.id },
      data: { tokens: Math.round(tokens) },
    });
    dirtyOpRunIds.add(ticket.operationRunId);
  }

  // Re-aggregate touched op_runs. Skip rows that already have a snapshot so
  // we never clobber a value set by the normal transition path.
  for (const opRunId of dirtyOpRunIds) {
    const opRun = await erpDb.operationRun.findUnique({
      where: { id: opRunId },
      select: { tokens: true },
    });
    if (!opRun || opRun.tokens !== null) continue;
    const agg = await erpDb.laborTicket.aggregate({
      where: { operationRunId: opRunId },
      _sum: { tokens: true },
    });
    const total = agg._sum.tokens ?? 0;
    if (total > 0) {
      await erpDb.operationRun.update({
        where: { id: opRunId },
        data: { tokens: total },
      });
    }
  }
}
