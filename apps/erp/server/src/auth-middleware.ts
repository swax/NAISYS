import { createHash } from "crypto";
import type { FastifyInstance } from "fastify";
import prisma from "./db.js";

export interface ErpUser {
  id: number;
  username: string;
  title: string;
}

declare module "fastify" {
  interface FastifyRequest {
    erpUser?: ErpUser;
  }
}

const COOKIE_NAME = "erp_session";

const PUBLIC_PREFIXES = ["/api/erp/auth/login"];

function isPublicRoute(url: string): boolean {
  // Exact match: API root
  if (url === "/api/erp/" || url === "/api/erp") return true;

  // Prefix matches
  for (const prefix of PUBLIC_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }

  // Schema routes
  if (url.startsWith("/api/erp/schemas")) return true;

  // Non-API paths (static files, etc.)
  if (!url.startsWith("/api/")) return true;

  return false;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function registerAuthMiddleware(fastify: FastifyInstance) {
  const publicRead = process.env.ERP_PUBLIC_READ === "true";

  fastify.decorateRequest("erpUser", undefined);

  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.cookies?.[COOKIE_NAME];

    if (token) {
      const tokenHash = hashToken(token);
      const user = await prisma.user.findFirst({
        where: {
          sessionTokenHash: tokenHash,
          sessionExpiresAt: { gt: new Date() },
        },
      });

      if (user) {
        request.erpUser = {
          id: user.id,
          username: user.username,
          title: user.title,
        };
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
