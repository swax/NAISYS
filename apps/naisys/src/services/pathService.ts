/**
 * Path utilities for NAISYS
 * With native Windows support, paths are used as-is on all platforms (no WSL conversion needed)
 */

import * as fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function ensureFileDirExists(filePath: string) {
  const dirPath = path.dirname(filePath);
  ensureDirExists(dirPath);
}

export function ensureDirExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getInstallPath() {
  const packageUrl = new URL("../../", import.meta.url);
  return fileURLToPath(packageUrl);
}
