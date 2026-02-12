import type { FastifyInstance } from "fastify";
import { AuthCache } from "@naisys/common";
import { findHubSession, isHubAvailable } from "@naisys/database";
import {
  createUser,
  getUserByTokenHash,
  getUserByUuid,
  hashToken,
} from "./services/userService.js";

export interface SupervisorUser {
  id: number;
  username: string;
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
      } else if (isHubAvailable()) {
        // SSO mode: hub is source of truth
        const hubSession = await findHubSession(tokenHash);
        if (hubSession) {
          let localUser = await getUserByUuid(hubSession.uuid);
          if (!localUser) {
            localUser = await createUser(
              hubSession.username,
              hubSession.password_hash,
              hubSession.uuid,
            );
          }
          const user = { id: localUser.id, username: localUser.username };
          authCache.set(cacheKey, user);
          request.supervisorUser = user;
        } else {
          authCache.set(cacheKey, null);
        }
      } else {
        // Standalone mode: local session only
        const user = await getUserByTokenHash(tokenHash);
        if (user) {
          const supervisorUser = { id: user.id, username: user.username };
          authCache.set(cacheKey, supervisorUser);
          request.supervisorUser = supervisorUser;
        } else {
          authCache.set(cacheKey, null);
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
