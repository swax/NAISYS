import type { FastifyReply, FastifyRequest } from "fastify";

import { sendForbidden, sendUnauthorized } from "../../errorHelpers.js";

// eslint-disable-next-line @typescript-eslint/require-await
export async function requireAdminOrSelf(
  request: FastifyRequest<{ Params: { username: string } }>,
  reply: FastifyReply,
) {
  if (!request.supervisorUser) {
    sendUnauthorized(reply, "Authentication required");
    return;
  }
  const isAdmin =
    request.supervisorUser.permissions.includes("supervisor_admin");
  const isSelf = request.params.username === request.supervisorUser.username;
  if (!isAdmin && !isSelf) {
    sendForbidden(reply, "Permission 'supervisor_admin' required");
    return;
  }
}
