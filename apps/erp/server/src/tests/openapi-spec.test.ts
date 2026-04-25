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

import { erpRoutes } from "../erpRoutes.js";

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

    await fastify.register(erpRoutes);

    await fastify.ready();

    const spec = fastify.swagger();
    const paths = Object.keys(spec.paths!);

    expect(paths.length).toBeGreaterThan(0);

    // Both stepFieldAttachmentRoutes registrations should be present —
    // the non-set path and the set-indexed path.
    expect(
      paths.some((p) => p.includes("/fields/{fieldSeqNo}/attachments")),
    ).toBe(true);
    expect(
      paths.some((p) =>
        p.includes("/sets/{setIndex}/fields/{fieldSeqNo}/attachments"),
      ),
    ).toBe(true);

    await fastify.close();
  });
});
