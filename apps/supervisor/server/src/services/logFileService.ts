import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { PinoLogEntry, ServerLogFile } from "@naisys-supervisor/shared";

const MAX_READ_BYTES = 256 * 1024;

export function getLogFilePath(fileKey: ServerLogFile): string {
  const naisysFolder = process.env.NAISYS_FOLDER;
  if (!naisysFolder) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }
  return path.join(naisysFolder, "logs", `${fileKey}.log`);
}

export async function tailLogFile(
  filePath: string,
  lineCount: number,
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

  const tailLines = lines.slice(-lineCount);

  const OMIT_KEYS = new Set(["level", "time", "msg", "pid", "hostname"]);

  const entries: PinoLogEntry[] = [];
  for (const line of tailLines) {
    try {
      const parsed = JSON.parse(line);

      const extra: Record<string, unknown> = {};
      for (const key of Object.keys(parsed)) {
        if (!OMIT_KEYS.has(key)) {
          extra[key] = parsed[key];
        }
      }
      const detail =
        Object.keys(extra).length > 0 ? JSON.stringify(extra) : undefined;

      entries.push({
        level: parsed.level ?? 30,
        time: parsed.time ?? 0,
        msg: parsed.msg ?? "",
        detail,
      });
    } catch {
      // skip malformed lines
    }
  }

  return { entries, fileSize };
}
