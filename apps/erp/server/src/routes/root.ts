import { FastifyInstance } from "fastify";

export default async function rootRoute(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      description:
        "API discovery root - lists all available resources and actions",
      tags: ["Discovery"],
    },
    handler: async () => {
      return {
        name: "NAISYS ERP API",
        version: "1.0.0",
        description: "AI-first ERP system",
        _links: [
          {
            rel: "self",
            href: "/api/erp/",
            title: "API Root",
          },
          {
            rel: "planning-orders",
            href: "/api/erp/planning/orders",
            title: "Planning Orders",
            method: "GET",
          },
          {
            rel: "execution-orders",
            href: "/api/erp/execution/orders",
            title: "Execution Orders",
            method: "GET",
          },
          {
            rel: "openapi-spec",
            href: "/api/erp/openapi.json",
            title: "OpenAPI Specification",
          },
          {
            rel: "api-reference",
            href: "/erp/api-reference",
            title: "Interactive API Reference (Scalar)",
          },
        ],
        _actions: [
          {
            rel: "create-planning-order",
            href: "/api/erp/planning/orders",
            method: "POST",
            title: "Create Planning Order",
            schema:
              "/api/erp/openapi.json#/components/schemas/CreatePlanningOrder",
          },
          {
            rel: "create-execution-order",
            href: "/api/erp/execution/orders",
            method: "POST",
            title: "Create Execution Order",
            schema:
              "/api/erp/openapi.json#/components/schemas/CreateExecutionOrder",
          },
        ],
      };
    },
  });
}
