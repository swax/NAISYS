/**
 * Verifies that fastify.swagger() can generate the OpenAPI spec without errors.
 *
 * This catches schemas that break spec generation — e.g. raw JSON Schema objects
 * passed where Zod schemas are expected (which causes "Cannot read properties of
 * undefined (reading 'parent')" at runtime).
 */
import "../schema-registry.js";

import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { describe, expect, test } from "vitest";

import adminRoutes from "../routes/admin.js";
import auditRoutes from "../routes/audit.js";
import authRoutes from "../routes/auth.js";
import dispatchRoutes from "../routes/dispatch.js";
import inventoryRoutes from "../routes/inventory.js";
import itemFieldRoutes from "../routes/item-fields.js";
import itemInstanceRoutes from "../routes/item-instances.js";
import itemRoutes from "../routes/items.js";
import laborTicketRoutes from "../routes/labor-tickets.js";
import operationDependencyRoutes from "../routes/operation-dependencies.js";
import operationFieldRefRoutes from "../routes/operation-field-refs.js";
import operationRunCommentRoutes from "../routes/operation-run-comments.js";
import operationRunTransitionRoutes from "../routes/operation-run-transitions.js";
import operationRunRoutes from "../routes/operation-runs.js";
import operationRoutes from "../routes/operations.js";
import orderRevisionTransitionRoutes from "../routes/order-revision-transitions.js";
import orderRevisionRoutes from "../routes/order-revisions.js";
import orderRunTransitionRoutes from "../routes/order-run-transitions.js";
import orderRunRoutes from "../routes/order-runs.js";
import orderRoutes from "../routes/orders.js";
import rootRoute from "../routes/root.js";
import schemaRoutes from "../routes/schemas.js";
import stepFieldAttachmentRoutes from "../routes/step-field-attachments.js";
import stepFieldRoutes from "../routes/step-fields.js";
import stepRunFieldRoutes from "../routes/step-run-fields.js";
import stepRunTransitionRoutes from "../routes/step-run-transitions.js";
import stepRunRoutes from "../routes/step-runs.js";
import stepRoutes from "../routes/steps.js";
import userPermissionRoutes from "../routes/user-permissions.js";
import userRoutes from "../routes/users.js";
import workCenterRoutes from "../routes/work-centers.js";

describe("OpenAPI spec generation", () => {
  test("fastify.swagger() succeeds for all ERP routes", async () => {
    const fastify = Fastify({ logger: false });
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);

    await fastify.register(cookie);
    await fastify.register(multipart, { limits: { fileSize: 10_000_000 } });

    await fastify.register(swagger, {
      openapi: {
        info: { title: "ERP Test", version: "1.0.0" },
        components: {
          securitySchemes: {
            cookieAuth: {
              type: "apiKey",
              in: "cookie",
              name: "naisys_session",
            },
          },
        },
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });

    // Register all route modules (schemas only — handlers aren't invoked)
    const routes: [any, string][] = [
      [adminRoutes, "/erp/api/admin"],
      [auditRoutes, "/erp/api/audit"],
      [authRoutes, "/erp/api/auth"],
      [dispatchRoutes, "/erp/api/dispatch"],
      [inventoryRoutes, "/erp/api/inventory"],
      [rootRoute, "/erp/api"],
      [itemRoutes, "/erp/api/items"],
      [itemFieldRoutes, "/erp/api/items/:key/fields"],
      [itemInstanceRoutes, "/erp/api/items/:key/instances"],
      [orderRoutes, "/erp/api/orders"],
      [orderRevisionRoutes, "/erp/api/orders/:orderKey/revs"],
      [orderRevisionTransitionRoutes, "/erp/api/orders/:orderKey/revs"],
      [orderRunRoutes, "/erp/api/orders/:orderKey/runs"],
      [orderRunTransitionRoutes, "/erp/api/orders/:orderKey/runs"],
      [operationRoutes, "/erp/api/orders/:orderKey/revs/:revNo/ops"],
      [
        operationDependencyRoutes,
        "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/deps",
      ],
      [
        operationFieldRefRoutes,
        "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/field-refs",
      ],
      [operationRunRoutes, "/erp/api/orders/:orderKey/runs/:runNo/ops"],
      [
        operationRunTransitionRoutes,
        "/erp/api/orders/:orderKey/runs/:runNo/ops",
      ],
      [
        laborTicketRoutes,
        "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/labor",
      ],
      [
        operationRunCommentRoutes,
        "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/comments",
      ],
      [stepRunRoutes, "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps"],
      [
        stepRunTransitionRoutes,
        "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps",
      ],
      [
        stepRunFieldRoutes,
        "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps",
      ],
      [
        stepFieldAttachmentRoutes,
        "/erp/api/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo/fields/:fieldSeqNo/attachments",
      ],
      [stepRoutes, "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/steps"],
      [
        stepFieldRoutes,
        "/erp/api/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields",
      ],
      [schemaRoutes, "/erp/api/schemas"],
      [userRoutes, "/erp/api/users"],
      [userPermissionRoutes, "/erp/api/users"],
      [workCenterRoutes, "/erp/api/work-centers"],
    ];

    for (const [routeModule, prefix] of routes) {
      fastify.register(routeModule, { prefix });
    }

    await fastify.ready();

    const spec = fastify.swagger();

    expect(Object.keys(spec.paths!).length).toBeGreaterThan(0);
    await fastify.close();
  });
});
