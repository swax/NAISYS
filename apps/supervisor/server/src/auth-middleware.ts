import type { FastifyInstance } from "fastify";
import { getUserByTokenHash, hashToken } from "./services/userService.js";

export interface SupervisorUser {
  id: number;
  username: string;
}

declare module "fastify" {
  interface FastifyRequest {
    supervisorUser?: SupervisorUser;
  }
}

const COOKIE_NAME = "supervisor_session";

const PUBLIC_PREFIXES = ["/api/supervisor/auth/login"];

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
      const user = await getUserByTokenHash(tokenHash);

      if (user) {
        request.supervisorUser = {
          id: user.id,
          username: user.username,
        };
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
