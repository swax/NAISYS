import { AuthCache, urlMatchesPrefix } from "@naisys/common";
import {
  extractBearerToken,
  hashToken,
  SESSION_COOKIE_NAME,
} from "@naisys/common-node";
import { findAgentByApiKey } from "@naisys/hub-database";
import type { Permission } from "@naisys/supervisor-database";
import { findSession, findUserByApiKey } from "@naisys/supervisor-database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { sendForbidden, sendUnauthorized } from "./error-helpers.js";
import {
  getUserPermissions,
  upsertUserForAgent,
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

const PUBLIC_PREFIXES = [
  "/supervisor/api/auth/passkey/login-options",
  "/supervisor/api/auth/passkey/login-verify",
  "/supervisor/api/auth/passkey/register-options",
  "/supervisor/api/auth/passkey/register-verify",
  "/supervisor/api/auth/password/login",
  "/supervisor/api/auth/password/register",
  "/supervisor/api/auth/registration-token/lookup",
];

export const authCache = new AuthCache<SupervisorUser>();

function isPublicRoute(url: string): boolean {
  if (url === "/supervisor/api/" || url === "/supervisor/api") return true;

  for (const prefix of PUBLIC_PREFIXES) {
    if (urlMatchesPrefix(url, prefix)) return true;
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
  return authCache.getOrLoad(`cookie:${tokenHash}`, async () => {
    const session = await findSession(tokenHash);
    if (!session) return null;
    return buildSupervisorUser(session.userId, session.username, session.uuid);
  });
}

export async function resolveUserFromApiKey(
  apiKey: string,
): Promise<SupervisorUser | null> {
  return authCache.getOrLoad(`apikey:${hashToken(apiKey)}`, async () => {
    // Supervisor DB holds humans + agents with external keys; hub DB holds
    // agents matching their hub-issued runtime key.
    const match =
      (await findUserByApiKey(apiKey)) ?? (await findAgentByApiKey(apiKey));
    if (!match) return null;

    const localUser = await upsertUserForAgent(match.username, match.uuid);

    return {
      id: localUser.id,
      username: localUser.username,
      uuid: localUser.uuid,
      permissions: localUser.permissions.map((p) => p.permission),
    };
  });
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

    sendUnauthorized(reply, "Authentication required");
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
      sendUnauthorized(reply, "Authentication required");
      return;
    }

    if (!hasPermission(request.supervisorUser, permission)) {
      sendForbidden(reply, `Permission '${permission}' required`);
      return;
    }
  };
}
