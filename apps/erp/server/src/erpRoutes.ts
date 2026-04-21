import type { FastifyPluginAsync } from "fastify";

import adminRoutes from "./routes/admin.js";
import auditRoutes from "./routes/audit.js";
import authRoutes from "./routes/auth.js";
import dispatchRoutes from "./routes/dispatch.js";
import inventoryRoutes from "./routes/inventory.js";
import itemFieldRoutes from "./routes/item-fields.js";
import itemInstanceRoutes from "./routes/item-instances.js";
import itemRoutes from "./routes/items.js";
import laborTicketRoutes from "./routes/labor-tickets.js";
import operationDependencyRoutes from "./routes/operation-dependencies.js";
import operationFieldRefRoutes from "./routes/operation-field-refs.js";
import operationRunCommentRoutes from "./routes/operation-run-comments.js";
import operationRunTransitionRoutes from "./routes/operation-run-transitions.js";
import operationRunRoutes from "./routes/operation-runs.js";
import operationRoutes from "./routes/operations.js";
import orderRevisionTransitionRoutes from "./routes/order-revision-transitions.js";
import orderRevisionRoutes from "./routes/order-revisions.js";
import orderRunTransitionRoutes from "./routes/order-run-transitions.js";
import orderRunRoutes from "./routes/order-runs.js";
import orderRoutes from "./routes/orders.js";
import rootRoute from "./routes/root.js";
import schemaRoutes from "./routes/schemas.js";
import stepFieldAttachmentRoutes from "./routes/step-field-attachments.js";
import stepFieldRoutes from "./routes/step-fields.js";
import stepRunFieldRoutes from "./routes/step-run-fields.js";
import stepRunTransitionRoutes from "./routes/step-run-transitions.js";
import stepRunRoutes from "./routes/step-runs.js";
import stepRoutes from "./routes/steps.js";
import userPermissionRoutes from "./routes/user-permissions.js";
import userRoutes from "./routes/users.js";
import workCenterRoutes from "./routes/work-centers.js";
import { isSupervisorAuth } from "./supervisorAuth.js";

export const erpRoutes: FastifyPluginAsync = (fastify) => {
  fastify.register(adminRoutes, { prefix: "/erp/api/admin" });
  fastify.register(auditRoutes, { prefix: "/erp/api/audit" });
  fastify.register(authRoutes, { prefix: "/erp/api/auth" });
  fastify.register(dispatchRoutes, { prefix: "/erp/api/dispatch" });
  fastify.register(inventoryRoutes, { prefix: "/erp/api/inventory" });
  fastify.register(rootRoute, { prefix: "/erp/api" });
  fastify.register(itemRoutes, { prefix: "/erp/api/items" });
  fastify.register(itemFieldRoutes, {
    prefix: "/erp/api/items/:key/fields",
  });
  fastify.register(itemInstanceRoutes, {
    prefix: "/erp/api/items/:key/instances",
  });
  fastify.register(orderRoutes, {
    prefix: "/erp/api/orders",
  });
  fastify.register(orderRevisionRoutes, {
    prefix: "/erp/api/orders/:orderKey/revs",
  });
  fastify.register(orderRevisionTransitionRoutes, {
    prefix: "/erp/api/orders/:orderKey/revs",
  });
  fastify.register(orderRunRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs",
  });
  fastify.register(orderRunTransitionRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs",
  });
  fastify.register(operationRoutes, {
    prefix: "/erp/api/orders/:orderKey/revs/:revNo/ops",
  });
  fastify.register(operationDependencyRoutes, {
    prefix: "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/deps",
  });
  fastify.register(operationFieldRefRoutes, {
    prefix: "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/field-refs",
  });
  fastify.register(operationRunRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs/:runNo/ops",
  });
  fastify.register(operationRunTransitionRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs/:runNo/ops",
  });
  fastify.register(laborTicketRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/labor",
  });
  fastify.register(operationRunCommentRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/comments",
  });
  fastify.register(stepRunRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps",
  });
  fastify.register(stepRunTransitionRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps",
  });
  fastify.register(stepRunFieldRoutes, {
    prefix: "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps",
  });
  fastify.register(stepFieldAttachmentRoutes, {
    prefix:
      "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo/fields/:fieldSeqNo/attachments",
  });
  fastify.register(stepFieldAttachmentRoutes, {
    prefix:
      "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo/sets/:setIndex/fields/:fieldSeqNo/attachments",
  });
  fastify.register(stepRoutes, {
    prefix: "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/steps",
  });
  fastify.register(stepFieldRoutes, {
    prefix:
      "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields",
  });
  fastify.register(schemaRoutes, { prefix: "/erp/api/schemas" });
  fastify.register(userRoutes, { prefix: "/erp/api/users" });
  fastify.register(userPermissionRoutes, { prefix: "/erp/api/users" });
  fastify.register(workCenterRoutes, { prefix: "/erp/api/work-centers" });

  // Public endpoint to expose client configuration
  fastify.get("/erp/api/client-config", { schema: { hide: true } }, () => ({
    publicRead: process.env.PUBLIC_READ === "true",
    supervisorAuth: isSupervisorAuth(),
  }));

  return Promise.resolve();
};
