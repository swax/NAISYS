import type { FastifyInstance } from "fastify";
import { AuthCache } from "@naisys/common";
import { hashToken } from "@naisys/common/dist/hashToken.js";
import prisma from "./db.js";
import {
  findAgentByApiKey,
  findHubSession,
  isHubAvailable,
} from "@naisys/hub-database";

export interface ErpUser {
  id: number;
  username: string;
}

declare module "fastify" {
  interface FastifyRequest {
    erpUser?: ErpUser;
  }
}

const COOKIE_NAME = "naisys_session";

const PUBLIC_PREFIXES = ["/api/erp/auth/login", "/api/erp/client-config"];

export const authCache = new AuthCache<ErpUser>();

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
      } else if (isHubAvailable()) {
        // SSO mode: hub is source of truth
        const hubSession = await findHubSession(tokenHash);
        if (hubSession) {
          let localUser = await prisma.user.findUnique({
            where: { uuid: hubSession.uuid },
          });
          if (!localUser) {
            localUser = await prisma.user.create({
              data: {
                uuid: hubSession.uuid,
                username: hubSession.username,
                passwordHash: hubSession.password_hash,
              },
            });
          }
          const erpUser = { id: localUser.id, username: localUser.username };
          authCache.set(cacheKey, erpUser);
          request.erpUser = erpUser;
        } else {
          authCache.set(cacheKey, null);
        }
      } else {
        // Standalone mode: local session only
        const user = await prisma.user.findFirst({
          where: {
            sessionTokenHash: tokenHash,
            sessionExpiresAt: { gt: new Date() },
          },
        });
        if (user) {
          const erpUser = { id: user.id, username: user.username };
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
        } else {
          const agent = await findAgentByApiKey(apiKey);
          if (agent) {
            let localUser = await prisma.user.findUnique({
              where: { uuid: agent.uuid },
            });
            if (!localUser) {
              localUser = await prisma.user.create({
                data: {
                  uuid: agent.uuid,
                  username: agent.username,
                  passwordHash: "!api-key-only",
                  authType: "api_key",
                },
              });
            }
            const erpUser = { id: localUser.id, username: localUser.username };
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
