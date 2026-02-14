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
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { collectionLink, selfLink } from "../hateoas.js";
import {
  createAgentConfig,
  updateAgentConfigById,
} from "../services/agentConfigService.js";
import { getAgent, getAgents } from "../services/agentService.js";
import { getMailDataByUserId, sendMessage } from "../services/mailService.js";
import { getContextLog, getRunsData } from "../services/runsService.js";

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
          _links: agentLinks(agent.id),
        }));

        return {
          items,
          timestamp: new Date().toISOString(),
          _links: [selfLink("/agents")],
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

        return {
          ...agent,
          _links: agentLinks(id),
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

  // PUT /:id/config — Update agent config
  fastify.put<{
    Params: AgentIdParams;
    Body: UpdateAgentConfigRequest;
    Reply: UpdateAgentConfigResponse;
  }>(
    "/:id/config",
    {
      schema: {
        description: "Update agent configuration YAML",
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
