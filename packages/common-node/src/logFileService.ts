import type fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import pino from "pino";

/**
 * Create a pino file logger that writes to NAISYS_FOLDER/logs/<filename>.
 */
export function createFileLogger(filename: string): pino.Logger {
  const logPath = path
    .join(process.env.NAISYS_FOLDER || "", "logs", filename)
    .replaceAll("\\", "/");

  return pino(
    { level: "info" },
    pino.destination({ dest: logPath, mkdir: true }),
  );
}

export interface DualLogger {
  log: (message: string) => void;
  error: (message: string) => void;
  disableConsole: () => void;
}

/**
 * Create a logger that writes to both a pino log file and the console.
 * Call disableConsole() to silence console output after startup.
 */
export function createDualLogger(filename: string): DualLogger {
  const logger = createFileLogger(filename);
  let consoleEnabled = true;

  return {
    log: (message: string) => {
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

export interface PinoLogEntry {
  level: number;
  time: number;
  msg: string;
  detail?: string;
}

const MAX_READ_BYTES = 256 * 1024;

export async function tailLogFile(
  filePath: string,
  lineCount: number,
  minLevel?: number,
): Promise<{ entries: PinoLogEntry[]; fileSize: number }> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return { entries: [], fileSize: 0 };
  }

  const fileSize = stat.size;
  if (fileSize === 0) {
    return { entries: [], fileSize: 0 };
  }

  const readSize = Math.min(fileSize, MAX_READ_BYTES);
  const position = fileSize - readSize;
  const buffer = Buffer.alloc(readSize);

  const handle = await fsp.open(filePath, "r");
  try {
    await handle.read(buffer, 0, readSize, position);
  } finally {
    await handle.close();
  }

  const text = buffer.toString("utf-8");
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  // If we didn't read from the start, drop the first line (likely partial)
  if (position > 0 && lines.length > 0) {
    lines.shift();
  }

  const OMIT_KEYS = new Set(["level", "time", "msg", "pid", "hostname"]);

  const entries: PinoLogEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const level = parsed.level ?? 30;

      if (minLevel != null && level < minLevel) continue;

      const extra: Record<string, unknown> = {};
      for (const key of Object.keys(parsed)) {
        if (!OMIT_KEYS.has(key)) {
          extra[key] = parsed[key];
        }
      }
      const detail =
        Object.keys(extra).length > 0 ? JSON.stringify(extra) : undefined;

      entries.push({
        level,
        time: parsed.time ?? 0,
        msg: parsed.msg ?? "",
        detail,
      });
    } catch {
      // skip malformed lines
    }
  }

  return { entries: entries.slice(-lineCount), fileSize };
}
