import { AuthCache, urlMatchesPrefix } from "@naisys/common";
import {
  extractBearerToken,
  hashToken,
  SESSION_COOKIE_NAME,
} from "@naisys/common-node";
import type { ErpPermission } from "@naisys/erp-shared";
import { findAgentByApiKey } from "@naisys/hub-database";
import { findSession, findUserByApiKey } from "@naisys/supervisor-database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import erpDb from "./erpDb.js";
import { isSupervisorAuth } from "./supervisorAuth.js";

export interface ErpUser {
  id: number;
  username: string;
  permissions: ErpPermission[];
}

declare module "fastify" {
  interface FastifyRequest {
    erpUser?: ErpUser;
  }
}

const PUBLIC_PREFIXES = ["/erp/api/auth/login", "/erp/api/client-config"];

export const authCache = new AuthCache<ErpUser>();

async function loadPermissions(userId: number): Promise<ErpPermission[]> {
  const perms = await erpDb.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  });
  return perms.map((p) => p.permission);
}

async function materializeErpUser(localUser: {
  id: number;
  username: string;
}): Promise<ErpUser> {
  return {
    id: localUser.id,
    username: localUser.username,
    permissions: await loadPermissions(localUser.id),
  };
}

async function resolveCookie(token: string): Promise<ErpUser | null> {
  const tokenHash = hashToken(token);
  return authCache.getOrLoad(`cookie:${tokenHash}`, async () => {
    const localUser = isSupervisorAuth()
      ? await loadCookieUserSso(tokenHash)
      : await loadCookieUserStandalone(tokenHash);
    return localUser ? materializeErpUser(localUser) : null;
  });
}

async function loadCookieUserSso(tokenHash: string) {
  const session = await findSession(tokenHash);
  if (!session) return null;
  return erpDb.user.upsert({
    where: { uuid: session.uuid },
    create: { uuid: session.uuid, username: session.username },
    update: {},
  });
}

async function loadCookieUserStandalone(tokenHash: string) {
  const session = await erpDb.session.findUnique({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  return session?.user ?? null;
}

async function resolveApiKey(apiKey: string): Promise<ErpUser | null> {
  const apiKeyHash = hashToken(apiKey);
  return authCache.getOrLoad(`apikey:${apiKeyHash}`, async () => {
    const localUser = isSupervisorAuth()
      ? await loadApiKeyUserSso(apiKey)
      : await erpDb.user.findUnique({ where: { apiKeyHash } });
    return localUser ? materializeErpUser(localUser) : null;
  });
}

async function loadApiKeyUserSso(apiKey: string) {
  // Try supervisor DB (humans + agents with external keys),
  // then hub DB (agents matching their hub-issued runtime key).
  const supervisorUser = await findUserByApiKey(apiKey);
  const hubAgent = supervisorUser ? null : await findAgentByApiKey(apiKey);
  const match = supervisorUser ?? hubAgent;
  if (!match) return null;

  const isAgent = supervisorUser?.isAgent ?? !!hubAgent;
  return erpDb.user.upsert({
    where: { uuid: match.uuid },
    create: { uuid: match.uuid, username: match.username, isAgent },
    update: {},
  });
}

export function hasPermission(
  user: ErpUser | undefined,
  permission: ErpPermission,
): boolean {
  if (!user) return false;
  return (
    user.permissions.includes(permission) ||
    user.permissions.includes("erp_admin")
  );
}

export function requirePermission(permission: ErpPermission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.erpUser) {
      reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }
    if (!hasPermission(request.erpUser, permission)) {
      reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: `Permission '${permission}' required`,
        missingPermission: permission,
      });
      return;
    }
  };
}

function isPublicRoute(url: string): boolean {
  // Exact match: API root
  if (url === "/erp/api/" || url === "/erp/api") return true;

  for (const prefix of PUBLIC_PREFIXES) {
    if (urlMatchesPrefix(url, prefix)) return true;
  }

  if (urlMatchesPrefix(url, "/erp/api/schemas")) return true;

  // Non-ERP-API paths (static files, supervisor routes, etc.)
  if (!url.startsWith("/erp/api")) return true;

  return false;
}

export function registerAuthMiddleware(fastify: FastifyInstance) {
  const publicRead = process.env.PUBLIC_READ === "true";

  fastify.decorateRequest("erpUser", undefined);

  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      const user = await resolveCookie(token);
      if (user) request.erpUser = user;
    }

    if (!request.erpUser) {
      const apiKey = extractBearerToken(request.headers.authorization);
      if (apiKey) {
        const user = await resolveApiKey(apiKey);
        if (user) request.erpUser = user;
      }
    }

    if (request.erpUser) return; // Authenticated, always allowed
    if (isPublicRoute(request.url)) return; // Public route
    if (publicRead && request.method === "GET") return; // Public read mode

    reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Authentication required",
    });
  });
}
