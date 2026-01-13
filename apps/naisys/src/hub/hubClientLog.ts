import path from "path";
import pino from "pino";

export type LogFn = (message: string) => void;

export interface HubClientLog {
  log: LogFn;
  error: LogFn;
}

export function createHubClientLog(): HubClientLog {
  const logPath = path.join(
    process.env.NAISYS_FOLDER || "",
    "logs",
    "hub-client.log"
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
