import type { FastifyInstance } from "fastify";

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
          href: "/erp/api/orders",
          title: "Orders",
          method: "GET",
        },
        {
          rel: "items",
          href: "/erp/api/items",
          title: "Items",
          method: "GET",
        },
        {
          rel: "dispatch",
          href: "/erp/api/dispatch",
          title: "Dispatch (open order runs)",
          method: "GET",
        },
        {
          rel: "schemas",
          href: "/erp/api/schemas/",
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
            href: "/erp/api/",
            title: "API Root",
          },
          {
            rel: "me",
            href: "/erp/api/auth/me",
            title: "Current User",
          },
          ...readLinks,
        ];

        authLinks.push({
          rel: "work-centers",
          href: "/erp/api/work-centers",
          title: "Work Centers",
          method: "GET",
        });

        if (hasPermission(request.erpUser, "erp_admin")) {
          authLinks.push(
            {
              rel: "users",
              href: "/erp/api/users",
              title: "Users",
              method: "GET",
            },
            {
              rel: "admin",
              href: "/erp/api/admin",
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
              href: "/erp/api/auth/logout",
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
            href: "/erp/api/",
            title: "API Root",
          },
          ...(publicRead
            ? readLinks
            : [
                {
                  rel: "schemas",
                  href: "/erp/api/schemas/",
                  title: "Schema Catalog",
                },
              ]),
        ],
        _actions: [
          {
            rel: "login",
            href: "/erp/api/auth/login",
            method: "POST",
            title: "Login",
            schema: "/erp/api/schemas/LoginRequest",
            body: { username: "", password: "" },
          },
        ],
      };
    },
  });
}
