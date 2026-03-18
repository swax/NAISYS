import { getLatestRunIdByUuid, sumCostsByUuid } from "@naisys/hub-database";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import type { LaborTicketModel } from "../generated/prisma/models/LaborTicket.js";

// --- Prisma include & result type ---

export const includeLaborTicket = {
  user: { select: { username: true } },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type LaborTicketWithUser = LaborTicketModel & {
  user: { username: string };
  createdBy: { username: string };
  updatedBy: { username: string };
};

// --- Helpers ---

/**
 * Compute the cost for a labor ticket at clock-out time.
 * Agents: sum of hub cost entries for the user within the clock-in/out window.
 * Non-agents: 0.
 */
async function computeCost(
  userId: number,
  clockIn: Date,
  clockOut: Date,
): Promise<number> {
  const user = await erpDb.user.findUnique({
    where: { id: userId },
    select: { isAgent: true, uuid: true },
  });

  if (!user?.isAgent) return 0;

  const cost = await sumCostsByUuid(user.uuid, clockIn, clockOut);
  return Math.round(cost * 100) / 100;
}

/**
 * Get the current hub run_id for an agent user, or null for non-agents.
 */
async function getAgentRunId(userId: number): Promise<number | null> {
  const user = await erpDb.user.findUnique({
    where: { id: userId },
    select: { isAgent: true, uuid: true },
  });

  if (!user?.isAgent) return null;

  return getLatestRunIdByUuid(user.uuid);
}

// --- Lookups ---

export async function isUserClockedIn(
  operationRunId: number,
  userId: number,
): Promise<boolean> {
  const ticket = await erpDb.laborTicket.findFirst({
    where: { operationRunId, userId, clockOut: null },
  });
  return !!ticket;
}

export async function listLaborTickets(
  operationRunId: number,
): Promise<LaborTicketWithUser[]> {
  return erpDb.laborTicket.findMany({
    where: { operationRunId },
    include: includeLaborTicket,
    orderBy: { clockIn: "desc" },
  });
}

// --- Mutations ---

export async function clockIn(
  operationRunId: number,
  userId: number,
  actorId: number,
): Promise<LaborTicketWithUser> {
  const now = new Date();
  const runId = await getAgentRunId(userId);

  // If already clocked into this op run, just return the existing ticket
  const existing = await erpDb.laborTicket.findFirst({
    where: { operationRunId, userId, clockOut: null },
    include: includeLaborTicket,
  });
  if (existing) return existing;

  return erpDb.$transaction(async (tx) => {
    // Auto clock-out all open tickets for this user (globally)
    const openTickets = await tx.laborTicket.findMany({
      where: { userId, clockOut: null },
    });

    for (const ticket of openTickets) {
      const cost = await computeCost(userId, ticket.clockIn, now);
      await tx.laborTicket.update({
        where: { id: ticket.id },
        data: { clockOut: now, cost, updatedById: actorId },
      });
    }

    // Create new ticket
    return tx.laborTicket.create({
      data: {
        operationRunId,
        userId,
        runId,
        clockIn: now,
        createdById: actorId,
        updatedById: actorId,
        updatedAt: now,
      },
      include: includeLaborTicket,
    });
  });
}

export async function clockOut(
  operationRunId: number,
  opts: { userId?: number; ticketId?: number },
  actorId: number,
): Promise<LaborTicketWithUser[]> {
  const now = new Date();

  return erpDb.$transaction(async (tx) => {
    // Build where clause based on opts
    const where: Record<string, unknown> = {
      operationRunId,
      clockOut: null,
    };
    if (opts.ticketId) {
      where.id = opts.ticketId;
    } else if (opts.userId) {
      where.userId = opts.userId;
    }
    // If neither specified, clocks out ALL open tickets for the op run

    const openTickets = await tx.laborTicket.findMany({ where });

    const updated: LaborTicketWithUser[] = [];
    for (const ticket of openTickets) {
      const cost = await computeCost(ticket.userId, ticket.clockIn, now);
      const result = await tx.laborTicket.update({
        where: { id: ticket.id },
        data: { clockOut: now, cost, updatedById: actorId },
        include: includeLaborTicket,
      });
      updated.push(result);
    }

    return updated;
  });
}

export async function clockOutAllForOpRun(
  operationRunId: number,
  actorId: number,
): Promise<void> {
  await clockOut(operationRunId, {}, actorId);
}

export async function sumLaborTicketCosts(
  operationRunId: number,
): Promise<number> {
  const result = await erpDb.laborTicket.aggregate({
    where: { operationRunId },
    _sum: { cost: true },
  });
  return Math.round((result._sum.cost ?? 0) * 100) / 100;
}

export async function deleteLaborTicket(
  ticketId: number,
  actorId: number,
): Promise<void> {
  await erpDb.$transaction(async (tx) => {
    await tx.laborTicket.delete({ where: { id: ticketId } });
    await writeAuditEntry(
      tx,
      "LaborTicket",
      ticketId,
      "delete",
      "id",
      String(ticketId),
      null,
      actorId,
    );
  });
}
