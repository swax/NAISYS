/**
 * Verifies that fastify.swagger() can generate the OpenAPI spec without errors.
 *
 * This catches schemas that break spec generation — e.g. raw JSON Schema objects
 * passed where Zod schemas are expected (which causes "Cannot read properties of
 * undefined (reading 'parent')" at runtime).
 */
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import { MAX_ATTACHMENT_SIZE } from "@naisys/common";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { describe, expect, test } from "vitest";

import "../schema-registry.js";

import apiRoutes from "../routes/api.js";

describe("OpenAPI spec generation", () => {
  test("fastify.swagger() succeeds for all supervisor routes", async () => {
    const fastify = Fastify({ logger: false });
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);

    await fastify.register(cookie);
    await fastify.register(multipart, {
      limits: { fileSize: MAX_ATTACHMENT_SIZE },
    });

    await fastify.register(swagger, {
      openapi: {
        info: { title: "Supervisor Test", version: "1.0.0" },
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

    fastify.register(apiRoutes, { prefix: "/api/supervisor" });

    await fastify.ready();

    const spec = fastify.swagger();

    expect(Object.keys(spec.paths!).length).toBeGreaterThan(0);
    await fastify.close();
  });
});
