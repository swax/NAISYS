import { createHash } from "crypto";
import type { FastifyInstance } from "fastify";
import prisma from "./db.js";
import { findHubSession, isHubAvailable } from "@naisys/database";

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

  // Non-ERP-API paths (static files, supervisor routes, etc.)
  if (!url.startsWith("/api/erp")) return true;

  return false;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function registerAuthMiddleware(fastify: FastifyInstance) {
  const publicRead = process.env.PUBLIC_READ === "true";

  fastify.decorateRequest("erpUser", undefined);

  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.cookies?.[COOKIE_NAME];

    if (token) {
      const tokenHash = hashToken(token);

      if (isHubAvailable()) {
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
          request.erpUser = {
            id: localUser.id,
            username: localUser.username,
          };
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
          request.erpUser = {
            id: user.id,
            username: user.username,
          };
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
