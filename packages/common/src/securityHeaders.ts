/**
 * Shared security-header hook for Fastify servers.
 *
 * Interfaces are duck-typed so @naisys/common doesn't need a Fastify dependency.
 */

interface HeaderReply {
  header: (key: string, value: string) => HeaderReply;
}

export function registerSecurityHeaders(
  fastify: {
    addHook: (
      name: string,
      fn: (
        request: unknown,
        reply: HeaderReply,
        payload: unknown,
        done: () => void,
      ) => void,
    ) => void;
  },
  options: { enforceHsts: boolean },
): void {
  fastify.addHook("onSend", (_request, reply, _payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'none'",
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
