/**
 * Custom JSON content-type parser that accepts empty bodies on POST endpoints.
 * Without this, sending Content-Type: application/json with no body (common
 * with HTTP clients calling bodiless state-transition actions like /start,
 * /complete) causes a JSON parse error.
 *
 * Interface is duck-typed so @naisys/common doesn't need a Fastify dependency.
 */

interface FastifyLike {
  addContentTypeParser(
    contentType: string,
    opts: { parseAs: "string" },
    parser: (
      req: unknown,
      body: string,
      done: (err: Error | null, body?: unknown) => void,
    ) => void,
  ): void;
}

export function registerLenientJsonParser(fastify: FastifyLike): void {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        done(null, body.length > 0 ? JSON.parse(body) : undefined);
      } catch (err: unknown) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );
}
