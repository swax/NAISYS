/**
 * Shared security-header hook for Fastify servers.
 *
 * Interfaces are duck-typed so @naisys/common doesn't need a Fastify dependency.
 */

interface HeaderReply {
  header: (key: string, value: string) => HeaderReply;
}

interface RequestWithUrl {
  url: string;
}

export function registerSecurityHeaders(
  fastify: {
    addHook: (
      name: string,
      fn: (
        request: RequestWithUrl,
        reply: HeaderReply,
        payload: unknown,
        done: () => void,
      ) => void,
    ) => void;
  },
  options: { enforceHsts: boolean },
): void {
  const strictCsp =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'none'";

  // Scalar API reference needs inline scripts, eval (bundled Zod JIT),
  // CDN assets, and outbound fetches to its proxy/registry services.
  const apiReferenceCsp =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob:; connect-src 'self' ws: wss: https://proxy.scalar.com https://api.scalar.com; font-src 'self' data: https://cdn.jsdelivr.net https://fonts.scalar.com; frame-ancestors 'none'";

  fastify.addHook("onSend", (request, reply, _payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");

    const isApiReference = request.url.includes("/api-reference");
    reply.header(
      "Content-Security-Policy",
      isApiReference ? apiReferenceCsp : strictCsp,
    );

    if (options.enforceHsts) {
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    done();
  });
}
