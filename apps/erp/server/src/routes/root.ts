import { FastifyInstance } from "fastify";

import { hasPermission } from "../auth-middleware.js";

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
          rel: "items",
          href: "/api/erp/items",
          title: "Items",
          method: "GET",
        },
        {
          rel: "dispatch",
          href: "/api/erp/dispatch",
          title: "Dispatch (open order runs)",
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
        const authLinks = [
          {
            rel: "self",
            href: "/api/erp/",
            title: "API Root",
          },
          {
            rel: "me",
            href: "/api/erp/auth/me",
            title: "Current User",
          },
          ...readLinks,
        ];

        authLinks.push({
          rel: "work-centers",
          href: "/api/erp/work-centers",
          title: "Work Centers",
          method: "GET",
        });

        if (hasPermission(request.erpUser, "erp_admin")) {
          authLinks.push(
            {
              rel: "users",
              href: "/api/erp/users",
              title: "Users",
              method: "GET",
            },
            {
              rel: "admin",
              href: "/api/erp/admin",
              title: "Admin",
              method: "GET",
            },
          );
        }

        return {
          ...base,
          _links: authLinks,
          _actions: [
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
            body: { username: "", password: "" },
          },
        ],
      };
    },
  });
}
