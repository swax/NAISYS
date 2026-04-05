import { AuthCache } from "@naisys/common";
import {
  extractBearerToken,
  hashToken,
  SESSION_COOKIE_NAME,
} from "@naisys/common-node";
import { findAgentByApiKey } from "@naisys/hub-database";
import type { Permission } from "@naisys/supervisor-database";
import { findSession, findUserByApiKey } from "@naisys/supervisor-database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createUserForAgent,
  getUserByUuid,
  getUserPermissions,
} from "./services/userService.js";

export interface SupervisorUser {
  id: number;
  username: string;
  uuid: string;
  permissions: Permission[];
}

declare module "fastify" {
  interface FastifyRequest {
    supervisorUser?: SupervisorUser;
  }
}

const PUBLIC_PREFIXES = ["/supervisor/api/auth/login"];

export const authCache = new AuthCache<SupervisorUser>();

function isPublicRoute(url: string): boolean {
  if (url === "/supervisor/api/" || url === "/supervisor/api") return true;

  for (const prefix of PUBLIC_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }

  // Non-supervisor-API paths (static files, ERP routes, etc.)
  if (!url.startsWith("/supervisor/api")) return true;

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

export async function resolveUserFromToken(
  token: string,
): Promise<SupervisorUser | null> {
  const tokenHash = hashToken(token);
  const cacheKey = `cookie:${tokenHash}`;
  const cached = authCache.get(cacheKey);

  if (cached !== undefined) return cached;

  const session = await findSession(tokenHash);
  if (!session) {
    authCache.set(cacheKey, null);
    return null;
  }

  const user = await buildSupervisorUser(
    session.userId,
    session.username,
    session.uuid,
  );
  authCache.set(cacheKey, user);
  return user;
}

export async function resolveUserFromApiKey(
  apiKey: string,
): Promise<SupervisorUser | null> {
  const apiKeyHash = hashToken(apiKey);
  const cacheKey = `apikey:${apiKeyHash}`;
  const cached = authCache.get(cacheKey);

  if (cached !== undefined) return cached;

  // Try supervisor DB first (human users), then hub DB (agents)
  const match =
    (await findUserByApiKey(apiKey)) ?? (await findAgentByApiKey(apiKey));
  if (!match) {
    authCache.set(cacheKey, null);
    return null;
  }

  let localUser = await getUserByUuid(match.uuid);
  if (!localUser) {
    localUser = await createUserForAgent(match.username, match.uuid);
  }

  const user = await buildSupervisorUser(
    localUser.id,
    localUser.username,
    localUser.uuid,
  );
  authCache.set(cacheKey, user);
  return user;
}

export function registerAuthMiddleware(fastify: FastifyInstance) {
  const publicRead = process.env.PUBLIC_READ === "true";

  fastify.decorateRequest("supervisorUser", undefined);

  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];

    if (token) {
      const user = await resolveUserFromToken(token);
      if (user) request.supervisorUser = user;
    }

    // API key auth (for agents / machine-to-machine)
    if (!request.supervisorUser) {
      const apiKey = extractBearerToken(request.headers.authorization);
      if (apiKey) {
        const user = await resolveUserFromApiKey(apiKey);
        if (user) request.supervisorUser = user;
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
  permission: Permission,
): boolean {
  return (
    (user?.permissions.includes(permission) ||
      user?.permissions.includes("supervisor_admin")) ??
    false
  );
}

export function requirePermission(permission: Permission) {
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
