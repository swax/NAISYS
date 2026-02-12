import type { FastifyBaseLogger } from "fastify";

let _logger: FastifyBaseLogger | undefined;

export function initLogger(logger: FastifyBaseLogger) {
  _logger = logger;
}

export function getLogger(): FastifyBaseLogger {
  if (!_logger) {
    throw new Error("Logger not initialized. Call initLogger() first.");
  }
  return _logger;
}
