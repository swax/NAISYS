import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthCache } from "@naisys/common";
import { hashToken } from "@naisys/common/dist/hashToken.js";
import { findSession } from "@naisys/supervisor-database";
import { findAgentByApiKey } from "@naisys/hub-database";
import {
  createUser,
  getUserByUuid,
  getUserPermissions,
} from "./services/userService.js";

export interface SupervisorUser {
  id: number;
  username: string;
  uuid: string;
  permissions: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    supervisorUser?: SupervisorUser;
  }
}

const COOKIE_NAME = "naisys_session";

const PUBLIC_PREFIXES = ["/api/supervisor/auth/login"];

export const authCache = new AuthCache<SupervisorUser>();

function isPublicRoute(url: string): boolean {
  if (url === "/api/supervisor/" || url === "/api/supervisor") return true;

  for (const prefix of PUBLIC_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }

  // Non-supervisor-API paths (static files, ERP routes, etc.)
  if (!url.startsWith("/api/supervisor")) return true;

  return false;
}

async function buildSupervisorUser(
  id: number,
  username: string,
  uuid: string,
): Promise<SupervisorUser> {
  const permissions = await getUserPermissions(id);
  return { id, username, uuid, permissions };
}

export function registerAuthMiddleware(fastify: FastifyInstance) {
  const publicRead = process.env.PUBLIC_READ === "true";

  fastify.decorateRequest("supervisorUser", undefined);

  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.cookies?.[COOKIE_NAME];

    if (token) {
      const tokenHash = hashToken(token);
      const cacheKey = `cookie:${tokenHash}`;
      const cached = authCache.get(cacheKey);

      if (cached !== undefined) {
        // Cache hit (valid or negative)
        if (cached) request.supervisorUser = cached;
      } else {
        // Supervisor DB is source of truth for sessions
        const session = await findSession(tokenHash);
        if (session) {
          let localUser = await getUserByUuid(session.uuid);
          if (!localUser) {
            localUser = await createUser(session.username, session.uuid);
          }
          const user = await buildSupervisorUser(
            localUser.id,
            localUser.username,
            localUser.uuid,
          );
          authCache.set(cacheKey, user);
          request.supervisorUser = user;
        } else {
          authCache.set(cacheKey, null);
        }
      }
    }

    // API key auth (for agents / machine-to-machine)
    if (!request.supervisorUser) {
      const apiKey = request.headers["x-api-key"] as string | undefined;
      if (apiKey) {
        const apiKeyHash = hashToken(apiKey);
        const cacheKey = `apikey:${apiKeyHash}`;
        const cached = authCache.get(cacheKey);

        if (cached !== undefined) {
          if (cached) request.supervisorUser = cached;
        } else {
          const agent = await findAgentByApiKey(apiKey);
          if (agent) {
            let localUser = await getUserByUuid(agent.uuid);
            if (!localUser) {
              localUser = await createUser(agent.username, agent.uuid);
            }
            const user = await buildSupervisorUser(
              localUser.id,
              localUser.username,
              localUser.uuid,
            );
            authCache.set(cacheKey, user);
            request.supervisorUser = user;
          } else {
            authCache.set(cacheKey, null);
          }
        }
      }
    }

    if (request.supervisorUser) return; // Authenticated

    if (isPublicRoute(request.url)) return; // Public route

    if (publicRead && request.method === "GET") return; // Public read mode

    reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Authentication required",
    });
  });
}

export function hasPermission(
  user: SupervisorUser | undefined,
  permission: string,
): boolean {
  return (
    (user?.permissions.includes(permission) ||
      user?.permissions.includes("supervisor_admin")) ??
    false
  );
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.supervisorUser) {
      reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }

    if (!hasPermission(request.supervisorUser, permission)) {
      reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: `Permission '${permission}' required`,
      });
      return;
    }
  };
}
