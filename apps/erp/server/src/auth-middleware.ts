import { AuthCache } from "@naisys/common";
import { hashToken } from "@naisys/common-node";
import { findAgentByApiKey } from "@naisys/hub-database";
import { findSession, findUserByApiKey } from "@naisys/supervisor-database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import erpDb from "./erpDb.js";
import { isSupervisorAuth } from "./supervisorAuth.js";

export interface ErpUser {
  id: number;
  username: string;
  permissions: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    erpUser?: ErpUser;
  }
}

const COOKIE_NAME = "naisys_session";

const PUBLIC_PREFIXES = ["/api/erp/auth/login", "/api/erp/client-config"];

export const authCache = new AuthCache<ErpUser>();

async function loadPermissions(userId: number): Promise<string[]> {
  const perms = await erpDb.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  });
  return perms.map((p) => p.permission);
}

export function hasPermission(
  user: ErpUser | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  return (
    user.permissions.includes(permission) ||
    user.permissions.includes("erp_admin")
  );
}

export function requirePermission(permission: string) {
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
      });
      return;
    }
  };
}

function isPublicRoute(url: string): boolean {
  // Exact match: API root
  if (url === "/api/erp/" || url === "/api/erp") return true;

  // Prefix matches
  for (const prefix of PUBLIC_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }

  // Schema routes
  if (url.startsWith("/api/erp/schemas")) return true;

  // Non-ERP-API paths (static files, supervisor routes, etc.)
  if (!url.startsWith("/api/erp")) return true;

  return false;
}

export function registerAuthMiddleware(fastify: FastifyInstance) {
  const publicRead = process.env.PUBLIC_READ === "true";

  fastify.decorateRequest("erpUser", undefined);

  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.cookies?.[COOKIE_NAME];

    if (token) {
      const tokenHash = hashToken(token);
      const cacheKey = `cookie:${tokenHash}`;
      const cached = authCache.get(cacheKey);

      if (cached !== undefined) {
        // Cache hit (valid or negative)
        if (cached) request.erpUser = cached;
      } else if (isSupervisorAuth()) {
        // SSO mode: supervisor DB is source of truth for sessions
        const session = await findSession(tokenHash);
        if (session) {
          let localUser = await erpDb.user.findUnique({
            where: { uuid: session.uuid },
          });
          if (!localUser) {
            localUser = await erpDb.user.create({
              data: {
                uuid: session.uuid,
                username: session.username,
                passwordHash: session.passwordHash,
              },
            });
          }
          const permissions = await loadPermissions(localUser.id);
          const erpUser = {
            id: localUser.id,
            username: localUser.username,
            permissions,
          };
          authCache.set(cacheKey, erpUser);
          request.erpUser = erpUser;
        } else {
          authCache.set(cacheKey, null);
        }
      } else {
        // Standalone mode: local session only
        const session = await erpDb.session.findUnique({
          where: {
            tokenHash,
            expiresAt: { gt: new Date() },
          },
          include: { user: true },
        });
        if (session) {
          const permissions = await loadPermissions(session.user.id);
          const erpUser = {
            id: session.user.id,
            username: session.user.username,
            permissions,
          };
          authCache.set(cacheKey, erpUser);
          request.erpUser = erpUser;
        } else {
          authCache.set(cacheKey, null);
        }
      }
    }

    // API key auth (for agents / machine-to-machine)
    if (!request.erpUser) {
      const apiKey = request.headers["x-api-key"] as string | undefined;
      if (apiKey) {
        const apiKeyHash = hashToken(apiKey);
        const cacheKey = `apikey:${apiKeyHash}`;
        const cached = authCache.get(cacheKey);

        if (cached !== undefined) {
          if (cached) request.erpUser = cached;
        } else if (isSupervisorAuth()) {
          // SSO mode: try supervisor DB (human users), then hub DB (agents)
          const match =
            (await findUserByApiKey(apiKey)) ??
            (await findAgentByApiKey(apiKey));
          if (match) {
            let localUser = await erpDb.user.findUnique({
              where: { uuid: match.uuid },
            });
            if (!localUser) {
              localUser = await erpDb.user.create({
                data: {
                  uuid: match.uuid,
                  username: match.username,
                  passwordHash: "!api-key-only",
                  isAgent: true,
                },
              });
            }
            const permissions = await loadPermissions(localUser.id);
            const erpUser = {
              id: localUser.id,
              username: localUser.username,
              permissions,
            };
            authCache.set(cacheKey, erpUser);
            request.erpUser = erpUser;
          } else {
            authCache.set(cacheKey, null);
          }
        } else {
          // Standalone mode: check local ERP user table
          const localUser = await erpDb.user.findUnique({
            where: { apiKey },
          });
          if (localUser) {
            const permissions = await loadPermissions(localUser.id);
            const erpUser = {
              id: localUser.id,
              username: localUser.username,
              permissions,
            };
            authCache.set(cacheKey, erpUser);
            request.erpUser = erpUser;
          } else {
            authCache.set(cacheKey, null);
          }
        }
      }
    }

    // Check if auth is required
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
