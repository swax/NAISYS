import path from "path";
import pino from "pino";

export type LogFn = (message: string) => void;

export interface HubClientLog {
  write: LogFn;
  error: LogFn;
  disableConsole: () => void;
}

export function createHubClientLog(): HubClientLog {
  const logPath = path.join(
    process.env.NAISYS_FOLDER || "",
    "logs",
    "hub-client.log",
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

  let consoleEnabled = true;

  return {
    write: (message: string) => {
      logger.info(message);
      if (consoleEnabled) {
        console.log(message);
      }
    },
    error: (message: string) => {
      logger.error(message);
      if (consoleEnabled) {
        console.error(message);
      }
    },
    disableConsole: () => {
      consoleEnabled = false;
    },
  };
}
