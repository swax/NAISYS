import type { HateoasAction } from "@naisys/common";
import {
  ClockOutLaborTicketSchema,
  ErrorResponseSchema,
  LaborTicketListResponseSchema,
  LaborTicketSchema,
  OperationRunStatus,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  checkOpRunInProgress,
  formatAuditFields,
  formatDate,
  resolveOpRun,
} from "../route-helpers.js";
import {
  clockIn,
  clockOut,
  deleteLaborTicket,
  listLaborTickets,
  type LaborTicketWithUser,
} from "../services/labor-ticket-service.js";

function laborResource(
  orderKey: string,
  runNo: number,
  seqNo: number,
) {
  return `orders/${orderKey}/runs/${runNo}/ops/${seqNo}/labor`;
}

function laborTicketListActions(
  orderKey: string,
  runNo: number,
  seqNo: number,
  opRunStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  const actions: HateoasAction[] = [];
  if (opRunStatus !== OperationRunStatus.in_progress) return actions;

  const base = `${API_PREFIX}/${laborResource(orderKey, runNo, seqNo)}`;

  if (hasPermission(user, "order_executor")) {
    actions.push({
      rel: "clock-in",
      href: `${base}/clock-in`,
      method: "POST",
      title: "Clock In",
    });
    actions.push({
      rel: "clock-out",
      href: `${base}/clock-out`,
      method: "POST",
      title: "Clock Out",
      schema: `${API_PREFIX}/schemas/ClockOutLaborTicket`,
    });
  } else if (hasPermission(user, "order_manager")) {
    actions.push({
      rel: "clock-out",
      href: `${base}/clock-out`,
      method: "POST",
      title: "Clock Out",
      schema: `${API_PREFIX}/schemas/ClockOutLaborTicket`,
    });
  }

  return actions;
}

function laborTicketItemActions(
  orderKey: string,
  runNo: number,
  seqNo: number,
  ticketId: number,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "order_manager")) return [];
  return [
    {
      rel: "delete",
      href: `${API_PREFIX}/${laborResource(orderKey, runNo, seqNo)}/${ticketId}`,
      method: "DELETE",
      title: "Delete",
    },
  ];
}

function formatLaborTicket(
  orderKey: string,
  runNo: number,
  seqNo: number,
  user: ErpUser | undefined,
  ticket: LaborTicketWithUser,
) {
  return {
    id: ticket.id,
    operationRunId: ticket.operationRunId,
    userId: ticket.userId,
    username: ticket.user.username,
    runId: ticket.runId,
    clockIn: ticket.clockIn.toISOString(),
    clockOut: formatDate(ticket.clockOut),
    cost: ticket.cost,
    ...formatAuditFields(ticket),
    _links: [
      selfLink(
        `/${laborResource(orderKey, runNo, seqNo)}/${ticket.id}`,
      ),
    ],
    _actions: laborTicketItemActions(
      orderKey,
      runNo,
      seqNo,
      ticket.id,
      user,
    ),
  };
}

const LaborParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

const LaborTicketParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  ticketId: z.coerce.number().int(),
});

export default function laborTicketRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List labor tickets for an operation run",
      tags: ["Labor Tickets"],
      params: LaborParamsSchema,
      response: {
        200: LaborTicketListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation run not found");
      }

      const items = await listLaborTickets(resolved.opRun.id);

      return {
        items: items.map((ticket) =>
          formatLaborTicket(orderKey, runNo, seqNo, request.erpUser, ticket),
        ),
        total: items.length,
        _links: [selfLink(`/${laborResource(orderKey, runNo, seqNo)}`)],
        _actions: laborTicketListActions(
          orderKey,
          runNo,
          seqNo,
          resolved.opRun.status,
          request.erpUser,
        ),
      };
    },
  });

  // CLOCK IN
  app.post("/clock-in", {
    schema: {
      description: "Clock in to an operation run (auto clocks out any open tickets for this user)",
      tags: ["Labor Tickets"],
      params: LaborParamsSchema,
      response: {
        200: LaborTicketSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) return notFound(reply, "Operation run not found");

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) {
        reply.status(409);
        return { statusCode: 409, error: "Conflict", message: opErr };
      }

      const ticket = await clockIn(resolved.opRun.id, userId, userId);
      return formatLaborTicket(
        orderKey,
        runNo,
        seqNo,
        request.erpUser,
        ticket,
      );
    },
  });

  // CLOCK OUT
  app.post("/clock-out", {
    schema: {
      description: "Clock out of an operation run",
      tags: ["Labor Tickets"],
      params: LaborParamsSchema,
      body: ClockOutLaborTicketSchema,
      response: {
        200: LaborTicketListResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const userId = request.erpUser!.id;
      const body = request.body;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) return notFound(reply, "Operation run not found");

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) {
        reply.status(409);
        return { statusCode: 409, error: "Conflict", message: opErr };
      }

      // Non-managers can only clock out their own tickets
      const isManager = hasPermission(request.erpUser, "order_manager");
      const opts = {
        userId: body.userId ?? (isManager ? undefined : userId),
        ticketId: body.ticketId,
      };

      // Non-managers cannot specify another user's ID
      if (!isManager && body.userId && body.userId !== userId) {
        reply.status(409);
        return {
          statusCode: 409,
          error: "Conflict",
          message: "Non-managers can only clock out their own tickets",
        };
      }

      const updated = await clockOut(resolved.opRun.id, opts, userId);

      // Return full list after clock-out
      const items = await listLaborTickets(resolved.opRun.id);
      return {
        items: items.map((ticket) =>
          formatLaborTicket(orderKey, runNo, seqNo, request.erpUser, ticket),
        ),
        total: items.length,
        _links: [selfLink(`/${laborResource(orderKey, runNo, seqNo)}`)],
        _actions: laborTicketListActions(
          orderKey,
          runNo,
          seqNo,
          resolved.opRun.status,
          request.erpUser,
        ),
      };
    },
  });

  // DELETE
  app.delete("/:ticketId", {
    schema: {
      description: "Delete a labor ticket",
      tags: ["Labor Tickets"],
      params: LaborTicketParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { ticketId } = request.params;
      const userId = request.erpUser!.id;

      await deleteLaborTicket(ticketId, userId);
      reply.status(204);
    },
  });
}
