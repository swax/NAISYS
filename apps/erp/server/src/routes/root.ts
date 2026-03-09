import { FastifyInstance } from "fastify";

export default function rootRoute(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      description:
        "API discovery root - lists all available resources and actions",
      tags: ["Discovery"],
    },
    handler: (request) => {
      const publicRead = process.env.PUBLIC_READ === "true";

      const base = {
        name: "NAISYS ERP API",
        version: "1.0.0",
        description: "AI-first ERP system",
      };

      const readLinks = [
        {
          rel: "orders",
          href: "/api/erp/orders",
          title: "Orders",
          method: "GET",
        },
        {
          rel: "schemas",
          href: "/api/erp/schemas/",
          title: "Schema Catalog",
        },
        {
          rel: "api-reference",
          href: "/erp/api-reference",
          title: "Interactive API Reference (Scalar)",
        },
      ];

      if (request.erpUser) {
        return {
          ...base,
          _links: [
            {
              rel: "self",
              href: "/api/erp/",
              title: "API Root",
            },
            ...readLinks,
          ],
          _actions: [
            {
              rel: "create-order",
              href: "/api/erp/orders",
              method: "POST",
              title: "Create Order",
              schema: "/api/erp/schemas/CreateOrder",
            },
            {
              rel: "logout",
              href: "/api/erp/auth/logout",
              method: "POST",
              title: "Logout",
            },
          ],
        };
      }

      return {
        ...base,
        _links: [
          {
            rel: "self",
            href: "/api/erp/",
            title: "API Root",
          },
          ...(publicRead
            ? readLinks
            : [
                {
                  rel: "schemas",
                  href: "/api/erp/schemas/",
                  title: "Schema Catalog",
                },
              ]),
        ],
        _actions: [
          {
            rel: "login",
            href: "/api/erp/auth/login",
            method: "POST",
            title: "Login",
            schema: "/api/erp/schemas/LoginRequest",
          },
        ],
      };
    },
  });
}
