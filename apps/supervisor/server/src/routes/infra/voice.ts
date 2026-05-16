import {
  AgentUsernameParamsSchema,
  ErrorResponseSchema,
  VoiceCostRequestSchema,
  VoiceCostResponseSchema,
  VoiceTokenRequestSchema,
  VoiceTokenResponseSchema,
  VoiceToolCallRequestSchema,
  VoiceToolCallResponseSchema,
  voiceToolsForMode,
} from "@naisys/supervisor-shared";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// Local re-declaration of @fastify/rate-limit's FastifyContextConfig
// augmentation — same shape as the package's, but it's not merging in this
// file for unknown reasons. Additive, so it doesn't break other files.
declare module "fastify" {
  interface FastifyContextConfig {
    rateLimit?: {
      max?: number;
      timeWindow?: number | string;
      keyGenerator?: (req: FastifyRequest) => string | Promise<string>;
    };
  }
}

import { hasPermission, requirePermission } from "../../auth-middleware.js";
import { hubDb } from "../../database/hubDb.js";
import { notFound } from "../../error-helpers.js";
import { getLogger } from "../../logger.js";
import {
  checkVoiceBudget,
  computeVoiceCost,
  mintVoiceToken,
} from "../../services/voice/voiceService.js";
import {
  registerVoiceSession,
  validateVoiceSession,
} from "../../services/voice/voiceSessionRegistry.js";
import {
  executeVoiceTool,
  requiredPermissionForVoiceTool,
} from "../../services/voice/voiceToolBridge.js";

/**
 * Voice agent routes — the supervisor's thin "action backend" for the
 * browser-held gpt-realtime session. Mints ephemeral tokens, executes the
 * voice agent's tool calls (re-authorized here, per call), and records cost.
 * No audio passes through. See docs/019-voice-agent.md.
 */

const ADMIN_USERNAME = "admin";

interface VoiceParticipantRecord {
  id: number;
  username: string;
  title: string;
}

async function lookupParticipant(
  username: string,
): Promise<VoiceParticipantRecord | undefined> {
  const user = await hubDb.users.findUnique({
    where: { username },
    select: { id: true, username: true, title: true },
  });
  return user ?? undefined;
}

/** Resolve X — the agent perspective the session speaks as. Phase 1: the
 *  page's `{agent}`, falling back to the admin agent if it can't be resolved. */
async function resolveVoiceFrom(
  username: string,
): Promise<VoiceParticipantRecord | undefined> {
  return (
    (await lookupParticipant(username)) ??
    (await lookupParticipant(ADMIN_USERNAME))
  );
}

export default function voiceRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // Use the Zod type provider so request/reply types are inferred from the
  // schemas, and so module augmentations on `config` (e.g. @fastify/rate-limit)
  // are picked up — the explicit-generics form drops them silently.
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /:username/voice/token — mint an ephemeral gpt-realtime session token.
  // `:username` is X; the body carries Y (the target agent being operated).
  app.post(
    "/:username/voice/token",
    {
      preHandler: [requirePermission("agent_communication")],
      config: {
        // Mint hits OpenAI's client_secrets endpoint, so cap looped POSTs
        // before they drain OpenAI quota (mints don't trip the spend cap
        // until usage flows). Token-mint only — tool/cost fire many times
        // per session. Keyed by IP because rate-limit runs before auth.
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description:
          "Mint an ephemeral gpt-realtime token for a voice session operating the target agent",
        tags: ["Voice"],
        params: AgentUsernameParamsSchema,
        body: VoiceTokenRequestSchema,
        response: {
          200: VoiceTokenResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          429: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const { targetUsername, mode } = request.body;

      // The realtime model is billed outside the NAISYS COST_CONTROL path
      // (the admin agent has shellModel "none", so the hub's suspension has
      // nothing to suspend). Enforce the admin spend cap here for new sessions.
      const budget = await checkVoiceBudget();
      if (budget?.overBudget) {
        return reply.code(403).send({
          success: false,
          message: budget.reason ?? "Voice budget exhausted.",
        });
      }

      const from = await resolveVoiceFrom(username);
      if (!from) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      const target = await lookupParticipant(targetUsername);
      if (!target) {
        return notFound(reply, `Agent '${targetUsername}' not found`);
      }

      try {
        const minted = await mintVoiceToken({
          from: { username: from.username, title: from.title },
          target: { username: target.username, title: target.title },
          userUuid: request.supervisorUser!.uuid,
          mode,
        });
        // Bind the session id to the *resolved* `from.username` (not the URL
        // param) so the admin-fallback case still validates: the client
        // echoes the resolved username back in subsequent /voice/tool and
        // /voice/cost URLs, which would differ from the mint URL.
        const voiceSessionId = registerVoiceSession({
          userUuid: request.supervisorUser!.uuid,
          fromUsername: from.username,
          targetUsername: target.username,
          mode,
          model: minted.model,
        });
        return {
          success: true,
          clientSecret: minted.clientSecret,
          expiresAt: minted.expiresAt,
          model: minted.model,
          voiceSessionId,
          fromUsername: from.username,
          fromTitle: from.title,
          targetUsername: target.username,
          targetTitle: target.title,
          mode,
        };
      } catch (error) {
        getLogger().error(error, "[Voice] token mint failed");
        return reply.code(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to start voice session",
        });
      }
    },
  );

  // POST /:username/voice/tool — execute a tool call the voice agent made.
  // Permission is re-checked per tool: the action plane stays locked even
  // though the browser holds the realtime session.
  app.post(
    "/:username/voice/tool",
    {
      config: {
        // Loose ceiling, not a tight throttle — gpt-realtime turns come at
        // conversation pace (a handful per second at most). 120/min catches a
        // bug-loop hammering the endpoint while leaving real bursts alone.
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description:
          "Execute a tool call made by the voice agent against the target agent",
        tags: ["Voice"],
        params: AgentUsernameParamsSchema,
        body: VoiceToolCallRequestSchema,
        response: {
          200: VoiceToolCallResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const call = request.body;

      const permission = requiredPermissionForVoiceTool(call.tool);
      if (!hasPermission(request.supervisorUser, permission)) {
        return reply.code(403).send({
          success: false,
          message: `Permission '${permission}' required`,
        });
      }

      // The session id binds (user, X, Y, mode) at mint time; a stolen id
      // can't be retargeted at a different Y or POSTed against a different X.
      const voiceSession = validateVoiceSession(
        call.voiceSessionId,
        request.supervisorUser!.uuid,
      );
      if (
        !voiceSession ||
        voiceSession.fromUsername !== username ||
        voiceSession.targetUsername !== call.targetUsername
      ) {
        return reply.code(403).send({
          success: false,
          message: "Voice session is invalid or expired.",
        });
      }

      // Defence in depth — the realtime session config already hides these,
      // but reject server-side in case the browser bypassed the locked config.
      if (!voiceToolsForMode(voiceSession.mode).includes(call.tool)) {
        return reply.code(403).send({
          success: false,
          message: `Tool '${call.tool}' is not available in this voice session.`,
        });
      }

      const from = await resolveVoiceFrom(username);
      if (!from) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      return executeVoiceTool({ id: from.id, username: from.username }, call);
    },
  );

  // POST /:username/voice/cost — record one `response.done`'s gpt-realtime
  // usage. Attributed to the admin agent's session with source "voice". Pushed
  // per-turn so an abrupt tab close only loses the last partial turn's cost.
  app.post(
    "/:username/voice/cost",
    {
      preHandler: [requirePermission("agent_communication")],
      config: {
        // Same shape as /voice/tool: loose ceiling to catch a runaway client
        // loop, not a tight throttle. One `response.done` per turn means real
        // sessions sit far below this.
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description:
          "Record gpt-realtime voice usage against the admin agent's session",
        tags: ["Voice"],
        params: AgentUsernameParamsSchema,
        body: VoiceCostRequestSchema,
        response: {
          200: VoiceCostResponseSchema,
          403: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const { voiceSessionId, usage } = request.body;

      // Bind cost accounting to a real minted session for this user —
      // otherwise any agent_communication user could trip the admin spend
      // cap. Per-field .max() clamps on VoiceUsageSchema bound the worst
      // case even from a session holder.
      const voiceSession = validateVoiceSession(
        voiceSessionId,
        request.supervisorUser!.uuid,
      );
      if (!voiceSession || voiceSession.fromUsername !== username) {
        return reply.code(403).send({
          success: false,
          message: "Voice session is invalid or expired.",
        });
      }

      const admin = await lookupParticipant(ADMIN_USERNAME);
      if (!admin) {
        getLogger().warn("[Voice] cost not recorded: admin agent not found");
        return { success: false, message: "Admin agent not found." };
      }

      // Attribute to the admin agent's most-recently-active run session — it
      // runs with shellModel "none", so it has a live but idle session and
      // normally carries no other cost. Costs aggregate by user_id regardless
      // of which host's admin session this is.
      const session = await hubDb.run_session.findFirst({
        where: { user_id: admin.id },
        orderBy: { last_active: "desc" },
        select: {
          run_id: true,
          subagent_id: true,
          session_id: true,
          host_id: true,
        },
      });
      if (!session) {
        getLogger().warn(
          "[Voice] cost not recorded: admin agent has no run session",
        );
        return {
          success: false,
          message: "Admin agent has no active run session.",
        };
      }

      // Use the model the session was minted with, not the current
      // VOICE_AGENT_MODEL — the variable may have changed mid-session.
      const model = voiceSession.model;
      let costInfo: ReturnType<typeof computeVoiceCost>;
      try {
        costInfo = computeVoiceCost(model, usage);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Cost pricing failed.";
        getLogger().warn(`[Voice] cost not recorded: ${message}`);
        return { success: false, message };
      }
      const { cost, inputTokens, outputTokens, cacheReadTokens } = costInfo;

      // Skip the row on a zero-cost turn (cancelled response.done, schema-
      // defaulted usage). Still re-check budget — a prior turn could have
      // pushed us over and the client needs a current overBudget to act on.
      if (cost === 0) {
        const budgetAfter = await checkVoiceBudget();
        return {
          success: true,
          cost: 0,
          overBudget: budgetAfter?.overBudget ?? false,
        };
      }

      await hubDb.costs.create({
        data: {
          user_id: admin.id,
          run_id: session.run_id,
          subagent_id: session.subagent_id,
          session_id: session.session_id,
          host_id: session.host_id,
          source: "voice",
          model,
          cost,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_write_tokens: 0,
          cache_read_tokens: cacheReadTokens,
        },
      });

      // Keep the admin run session's displayed lifetime cost in step, the same
      // way the hub's COST_WRITE handler does for agent-reported costs.
      await hubDb.run_session.updateMany({
        where: {
          user_id: admin.id,
          run_id: session.run_id,
          subagent_id: session.subagent_id,
          session_id: session.session_id,
        },
        data: { total_cost: { increment: cost } },
      });

      // Re-check the cap after writing — if this turn pushed us over, tell
      // the client to hang up so realtime spend doesn't keep accumulating.
      const budgetAfter = await checkVoiceBudget();
      return {
        success: true,
        cost,
        overBudget: budgetAfter?.overBudget ?? false,
      };
    },
  );
}
