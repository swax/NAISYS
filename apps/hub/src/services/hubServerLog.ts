import path from "path";
import pino from "pino";

export type LogFn = (message: string) => void;

export interface HubServerLog {
  log: LogFn;
  error: LogFn;
}

/**
 * Creates a log service for the hub.
 * In hosted mode, logs to a file using pino.
 * In standalone mode, uses console.log.
 */
export function createHubServerLog(
  startupType: "standalone" | "hosted"
): HubServerLog {
  if (startupType === "hosted") {
    const logPath = path.join(
      process.env.NAISYS_FOLDER || "",
      "logs",
      "hub-server.log"
    );

    const logger = pino({
      level: "info",
      transport: {
        target: "pino/file",
        options: {
          destination: logPath,
          mkdir: true,
        },
      },
    });

    return {
      log: (message: string) => logger.info(message),
      error: (message: string) => logger.error(message),
    };
  }

  // Standalone mode - use console
  return {
    log: (message: string) => console.log(message),
    error: (message: string) => console.error(message),
  };
}
