import { MultipartFile } from "@fastify/multipart";
import {
  AgentDetailResponse,
  AgentDetailResponseSchema,
  AgentIdParams,
  AgentIdParamsSchema,
  AgentListRequest,
  AgentListRequestSchema,
  AgentListResponse,
  AgentListResponseSchema,
  ContextLogParams,
  ContextLogParamsSchema,
  ContextLogRequest,
  ContextLogRequestSchema,
  ContextLogResponse,
  ContextLogResponseSchema,
  CreateAgentConfigRequest,
  CreateAgentConfigRequestSchema,
  CreateAgentConfigResponse,
  CreateAgentConfigResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
  GetAgentConfigResponse,
  GetAgentConfigResponseSchema,
  MailDataRequest,
  MailDataRequestSchema,
  MailDataResponse,
  MailDataResponseSchema,
  RunsDataRequest,
  RunsDataRequestSchema,
  RunsDataResponse,
  RunsDataResponseSchema,
  SendMailRequest,
  SendMailRequestSchema,
  SendMailResponse,
  SendMailResponseSchema,
  UpdateAgentConfigRequest,
  UpdateAgentConfigRequestSchema,
  UpdateAgentConfigResponse,
  UpdateAgentConfigResponseSchema,
  AgentActionResult,
  AgentActionResultSchema,
  AgentStartRequest,
  AgentStartRequestSchema,
  AgentStartResult,
  AgentStartResultSchema,
  AgentStopResult,
  AgentStopResultSchema,
  SetLeadAgentRequest,
  SetLeadAgentRequestSchema,
} from "@naisys-supervisor/shared";
import fs from "fs/promises";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { HateoasAction } from "@naisys/common";
import { requirePermission } from "../auth-middleware.js";
import { API_PREFIX, collectionLink, schemaLink, selfLink } from "../hateoas.js";
import {
  isAgentActive,
  isHubConnected,
  sendAgentStart,
  sendAgentStop,
  sendUserListChanged,
} from "../services/hubConnectionService.js";
import {
  createAgentConfig,
  getAgentConfigById,
  updateAgentConfigById,
} from "../services/agentConfigService.js";
import {
  archiveAgent,
  deleteAgent,
  getAgent,
  getAgents,
  unarchiveAgent,
  updateLeadAgent,
} from "../services/agentService.js";
import { getMailDataByUserId, sendMessage } from "../services/mailService.js";
import { getContextLog, getRunsData } from "../services/runsService.js";

function agentActions(
  agentId: number,
  hasManagePermission: boolean,
  archived: boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];
  const active = isAgentActive(agentId);

  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "start",
      href: `${API_PREFIX}/agents/${agentId}/start`,
      method: "POST",
      title: "Start Agent",
      schema: `${API_PREFIX}/schemas/StartAgent`,
    });
  }
  if (hasManagePermission && active) {
    actions.push({
      rel: "stop",
      href: `${API_PREFIX}/agents/${agentId}/stop`,
      method: "POST",
      title: "Stop Agent",
    });
  }
  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "archive",
      href: `${API_PREFIX}/agents/${agentId}/archive`,
      method: "POST",
      title: "Archive Agent",
    });
  }
  if (hasManagePermission && archived) {
    actions.push({
      rel: "unarchive",
      href: `${API_PREFIX}/agents/${agentId}/unarchive`,
      method: "POST",
      title: "Unarchive Agent",
    });
  }
  if (hasManagePermission && !active && archived) {
    actions.push({
      rel: "delete",
      href: `${API_PREFIX}/agents/${agentId}`,
      method: "DELETE",
      title: "Delete Agent",
    });
  }
  if (hasManagePermission && !archived) {
    actions.push({
      rel: "update-config",
      href: `${API_PREFIX}/agents/${agentId}/config`,
      method: "PUT",
      title: "Update Agent Config",
      schema: `${API_PREFIX}/schemas/UpdateAgentConfig`,
    });
    actions.push({
      rel: "set-lead",
      href: `${API_PREFIX}/agents/${agentId}/lead`,
      method: "PUT",
      title: "Set Lead Agent",
    });
  }
  return actions;
}

function agentLinks(agentId: number) {
  return [
    selfLink(`/agents/${agentId}`),
    { rel: "runs", href: `/api/supervisor/agents/${agentId}/runs` },
    { rel: "mail", href: `/api/supervisor/agents/${agentId}/mail` },
    collectionLink("agents"),
  ];
}

export default async function agentsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET / — List agents
  fastify.get<{
    Querystring: AgentListRequest;
    Reply: AgentListResponse | ErrorResponse;
  }>(
    "/",
    {
      schema: {
        description: "List agents with status and metadata",
        tags: ["Agents"],
        querystring: AgentListRequestSchema,
        response: {
          200: AgentListResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { updatedSince } = request.query;
        const agents = await getAgents(updatedSince);

        const items = agents.map((agent) => ({
          ...agent,
          online: isAgentActive(agent.id),
          _links: agentLinks(agent.id),
        }));

        const hasManagePermission =
          request.supervisorUser?.permissions.includes("manage_agents") ??
          false;

        const actions: HateoasAction[] = [];
        if (hasManagePermission) {
          actions.push({
            rel: "create",
            href: `${API_PREFIX}/agents`,
            method: "POST",
            title: "Create Agent",
            schema: `${API_PREFIX}/schemas/CreateAgent`,
          });
        }

        return {
          items,
          timestamp: new Date().toISOString(),
          _links: [selfLink("/agents"), schemaLink("CreateAgent")],
          _actions: actions.length > 0 ? actions : undefined,
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agents",
        });
      }
    },
  );

  // POST / — Create agent
  fastify.post<{
    Body: CreateAgentConfigRequest;
    Reply: CreateAgentConfigResponse;
  }>(
    "/",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Create a new agent with YAML configuration file",
        tags: ["Agents"],
        body: CreateAgentConfigRequestSchema,
        response: {
          200: CreateAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { name } = request.body;

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return reply.status(400).send({
            success: false,
            message:
              "Agent name must contain only alphanumeric characters, hyphens, and underscores",
          });
        }

        await createAgentConfig(name);

        return {
          success: true,
          message: `Agent '${name}' created successfully`,
        };
      } catch (error) {
        request.log.error(error, "Error in POST /agents route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("already exists")) {
          return reply.status(400).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while creating agent",
        });
      }
    },
  );

  // GET /:id — Agent detail with config
  fastify.get<{
    Params: AgentIdParams;
    Reply: AgentDetailResponse | ErrorResponse;
  }>(
    "/:id",
    {
      schema: {
        description: "Get agent detail with configuration",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentDetailResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const agent = await getAgent(id);

        if (!agent) {
          return reply.status(404).send({
            success: false,
            message: `Agent with ID ${id} not found`,
          });
        }

        const hasManagePermission =
          request.supervisorUser?.permissions.includes("manage_agents") ??
          false;

        return {
          ...agent,
          online: isAgentActive(id),
          _links: agentLinks(id),
          _actions: agentActions(
            id,
            hasManagePermission,
            agent.archived ?? false,
          ),
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agent detail",
        });
      }
    },
  );

  // POST /:id/start — Start agent via hub
  fastify.post<{
    Params: AgentIdParams;
    Body: AgentStartRequest;
    Reply: AgentStartResult | ErrorResponse;
  }>(
    "/:id/start",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Start an agent via the hub",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        body: AgentStartRequestSchema,
        response: {
          200: AgentStartResultSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { task } = request.body;

        if (!isHubConnected()) {
          return reply.status(503).send({
            success: false,
            message: "Hub is not connected",
          });
        }

        const response = await sendAgentStart(
          id,
          task || "Started from supervisor",
        );

        if (response.success) {
          return {
            success: true,
            message: "Agent started",
            hostname: response.hostname,
          };
        } else {
          return reply.status(500).send({
            success: false,
            message: response.error || "Failed to start agent",
          });
        }
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/start route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while starting agent",
        });
      }
    },
  );

  // POST /:id/stop — Stop agent via hub
  fastify.post<{
    Params: AgentIdParams;
    Reply: AgentStopResult | ErrorResponse;
  }>(
    "/:id/stop",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Stop an agent via the hub",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentStopResultSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (!isHubConnected()) {
          return reply.status(503).send({
            success: false,
            message: "Hub is not connected",
          });
        }

        const response = await sendAgentStop(id, "Stopped from supervisor");

        if (response.success) {
          return {
            success: true,
            message: "Agent stopped",
          };
        } else {
          return reply.status(500).send({
            success: false,
            message: response.error || "Failed to stop agent",
          });
        }
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/stop route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while stopping agent",
        });
      }
    },
  );

  // POST /:id/archive — Archive agent
  fastify.post<{
    Params: AgentIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/archive",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Archive an agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (isAgentActive(id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot archive an active agent. Stop it first.",
          });
        }

        await archiveAgent(id);
        sendUserListChanged();

        return { success: true, message: "Agent archived" };
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/archive route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while archiving agent",
        });
      }
    },
  );

  // POST /:id/unarchive — Unarchive agent
  fastify.post<{
    Params: AgentIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/unarchive",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Unarchive an agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        await unarchiveAgent(id);
        sendUserListChanged();

        return { success: true, message: "Agent unarchived" };
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/unarchive route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while unarchiving agent",
        });
      }
    },
  );

  // PUT /:id/lead — Set or clear lead agent
  fastify.put<{
    Params: AgentIdParams;
    Body: SetLeadAgentRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/lead",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Set or clear the lead agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        body: SetLeadAgentRequestSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { leadAgentId } = request.body;

        await updateLeadAgent(id, leadAgentId);
        sendUserListChanged();

        return {
          success: true,
          message: leadAgentId ? "Lead agent updated" : "Lead agent cleared",
        };
      } catch (error) {
        request.log.error(error, "Error in PUT /agents/:id/lead route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while updating lead agent",
        });
      }
    },
  );

  // DELETE /:id — Permanently delete agent
  fastify.delete<{
    Params: AgentIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Permanently delete an archived agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (isAgentActive(id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot delete an active agent. Stop it first.",
          });
        }

        const agent = await getAgent(id);
        if (!agent) {
          return reply.status(404).send({
            success: false,
            message: `Agent with ID ${id} not found`,
          });
        }

        if (!agent.archived) {
          return reply.status(400).send({
            success: false,
            message: "Agent must be archived before it can be deleted.",
          });
        }

        const { agentPath } = await deleteAgent(id);

        if (agentPath) {
          try {
            await fs.unlink(agentPath);
          } catch {
            // YAML file may already be missing
          }
        }

        sendUserListChanged();

        return { success: true, message: "Agent permanently deleted" };
      } catch (error) {
        request.log.error(error, "Error in DELETE /agents/:id route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while deleting agent",
        });
      }
    },
  );

  // GET /:id/config — Get parsed agent config
  fastify.get<{
    Params: AgentIdParams;
    Reply: GetAgentConfigResponse | ErrorResponse;
  }>(
    "/:id/config",
    {
      schema: {
        description: "Get parsed agent configuration",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: GetAgentConfigResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const config = await getAgentConfigById(id);

        return { config };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id/config route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(404).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agent configuration",
        });
      }
    },
  );

  // PUT /:id/config — Update agent config
  fastify.put<{
    Params: AgentIdParams;
    Body: UpdateAgentConfigRequest;
    Reply: UpdateAgentConfigResponse;
  }>(
    "/:id/config",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Update agent configuration",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        body: UpdateAgentConfigRequestSchema,
        response: {
          200: UpdateAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { config } = request.body;
        await updateAgentConfigById(id, config);

        return {
          success: true,
          message: "Agent configuration updated successfully",
        };
      } catch (error) {
        request.log.error(error, "Error in PUT /agents/:id/config route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(404).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while updating agent configuration",
        });
      }
    },
  );

  // GET /:id/runs — Runs for agent
  fastify.get<{
    Params: AgentIdParams;
    Querystring: RunsDataRequest;
    Reply: RunsDataResponse;
  }>(
    "/:id/runs",
    {
      schema: {
        description: "Get run sessions for a specific agent",
        tags: ["Runs"],
        params: AgentIdParamsSchema,
        querystring: RunsDataRequestSchema,
        response: {
          200: RunsDataResponseSchema,
          500: RunsDataResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { updatedSince, page, count } = request.query;

        const data = await getRunsData(id, updatedSince, page, count);

        return {
          success: true,
          message: "Runs data retrieved successfully",
          data,
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id/runs route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching runs data",
        });
      }
    },
  );

  // GET /:id/runs/:runId/sessions/:sessionId/logs — Context log
  fastify.get<{
    Params: ContextLogParams;
    Querystring: ContextLogRequest;
    Reply: ContextLogResponse;
  }>(
    "/:id/runs/:runId/sessions/:sessionId/logs",
    {
      schema: {
        description: "Get context log for a specific run session",
        tags: ["Runs"],
        params: ContextLogParamsSchema,
        querystring: ContextLogRequestSchema,
        response: {
          200: ContextLogResponseSchema,
          500: ContextLogResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id, runId, sessionId } = request.params;
        const { logsAfter } = request.query;

        const data = await getContextLog(id, runId, sessionId, logsAfter);

        return {
          success: true,
          message: "Context log retrieved successfully",
          data,
        };
      } catch (error) {
        request.log.error(
          error,
          "Error in GET /agents/:id/runs/:runId/sessions/:sessionId/logs route",
        );
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching context log",
        });
      }
    },
  );

  // GET /:id/mail — Mail for agent
  fastify.get<{
    Params: AgentIdParams;
    Querystring: MailDataRequest;
    Reply: MailDataResponse;
  }>(
    "/:id/mail",
    {
      schema: {
        description: "Get mail data for a specific agent",
        tags: ["Mail"],
        params: AgentIdParamsSchema,
        querystring: MailDataRequestSchema,
        response: {
          200: MailDataResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { updatedSince, page, count } = request.query;

        const data = await getMailDataByUserId(id, updatedSince, page, count);

        return {
          success: true,
          message: "Mail data retrieved successfully",
          data,
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id/mail route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching mail data",
        });
      }
    },
  );

  // POST /:id/mail — Send mail as agent
  fastify.post<{
    Params: AgentIdParams;
    Reply: SendMailResponse;
  }>(
    "/:id/mail",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description:
          "Send email as agent with optional attachments. Supports JSON and multipart/form-data",
        tags: ["Mail"],
        params: AgentIdParamsSchema,
        body: SendMailRequestSchema,
        response: {
          200: SendMailResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const contentType = request.headers["content-type"];
        let from: string = "",
          to: string = "",
          subject: string = "",
          message: string = "";
        let attachments: Array<{ filename: string; data: Buffer }> = [];

        if (contentType?.includes("multipart/form-data")) {
          const parts = request.parts();

          for await (const part of parts) {
            if (part.type === "field") {
              const field = part as any;
              switch (field.fieldname) {
                case "from":
                  from = field.value;
                  break;
                case "to":
                  to = field.value;
                  break;
                case "subject":
                  subject = field.value;
                  break;
                case "message":
                  message = field.value;
                  break;
              }
            } else if (part.type === "file") {
              const file = part as MultipartFile;
              if (file.fieldname === "attachments") {
                const buffer = await file.toBuffer();
                attachments.push({
                  filename: file.filename || "unnamed_file",
                  data: buffer,
                });
              }
            }
          }
        } else {
          const body = request.body as SendMailRequest;
          from = body.from;
          to = body.to;
          subject = body.subject;
          message = body.message;
        }

        if (!from || !to || !subject || !message) {
          return reply.code(400).send({
            success: false,
            message: "Missing required fields: from, to, subject, message",
          });
        }

        const result = await sendMessage({
          from,
          to,
          subject,
          message,
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        if (result.success) {
          return reply.code(200).send(result);
        } else {
          return reply.code(500).send(result);
        }
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/mail route");
        return reply.code(500).send({
          success: false,
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    },
  );
}
