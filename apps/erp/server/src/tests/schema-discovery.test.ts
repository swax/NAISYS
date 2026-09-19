import {
  FailOperationRunSchema,
  TransitionNoteSchema,
} from "@naisys/erp-shared";
import Fastify from "fastify";
import { describe, expect, test } from "vitest";

import schemaRoutes from "../routes/schemas.js";
import { schemaRegistry } from "../schema-registry.js";

describe("schema discovery", () => {
  test("every advertised request schema can be fetched as JSON", async () => {
    const app = Fastify();
    schemaRoutes(app);
    try {
      for (const name of Object.keys(schemaRegistry)) {
        const response = await app.inject({ url: `/${name}` });
        expect(response.statusCode, `${name}: ${response.body}`).toBe(200);
        expect(response.json()).toHaveProperty("$schema");
      }
    } finally {
      await app.close();
    }
  });

  test("optional transition bodies still normalize null and absent input", () => {
    for (const schema of [TransitionNoteSchema, FailOperationRunSchema]) {
      for (const input of [null, undefined, {}])
        expect(schema.parse(input)).toEqual({});
      expect(schema.parse({ note: "quota" })).toEqual({ note: "quota" });
      expect(schema.safeParse({ note: "x".repeat(2001) }).success).toBe(false);
      expect(schema.safeParse({ force: true }).success).toBe(false);
    }
  });
});
