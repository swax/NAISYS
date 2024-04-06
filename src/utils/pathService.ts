/**
 * Tries to prevent a common source of errors mixing up unix and windows based paths
 * Allows NAISYS to treat paths in UNIX format even though we can run on Windows and run commands with WSL
 * Previously every service had to handle path conversion on their own which was prone to mistakes
 */

import * as fs from "fs";
import * as os from "os";
import path from "path";
import { fileURLToPath } from "url";

export class HostPath {
  constructor(private _value: string) {}

  /** Not named simply value to prevent any ambiguity hidden by the variable name like randomPath.value */
  getHostPath = () => this._value;

  /** Basically unix path */
  toNaisysPath() {
    const match = this._value.match(/^([a-zA-Z]):\\(.*)/);
    let naisysPath = this._value; // Return the original path if it doesn't match the pattern

    if (os.platform() === "win32" && match) {
      // Replace 'C:\' with '/mnt/c/' and convert backslashes to forward slashes
      naisysPath = `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
    }

    return naisysPath;
  }
}

export class NaisysPath {
  constructor(private _value: string) {}

  /** Not named simply value to prevent any ambiguity hidden by the variable name like randomPath.value */
  getNaisysPath = () => this._value;

  /** Take a unix path and convert to something that can be opened by the host with the native fs library and such */
  toHostPath() {
    const match = this._value.match(/^\/mnt\/([a-zA-Z])\//);
    let hostPath = this._value; // Return the original path if it doesn't match the pattern

    if (os.platform() === "win32" && match) {
      // Replace '/mnt/c/' with 'C:/' and convert forward slashes to backslashes
      hostPath = this._value
        .replace(`/mnt/${match[1]}/`, `${match[1].toLowerCase()}:\\`)
        .replace(/\//g, "\\");
    }

    return hostPath;
  }
}

export function ensureFileDirExists(filePath: HostPath | NaisysPath) {
  const hostPath =
    filePath instanceof NaisysPath
      ? filePath.toHostPath()
      : filePath.getHostPath();

  const dirHostPath = path.dirname(hostPath);

  ensureDirExists(new HostPath(dirHostPath));
}

export function ensureDirExists(dirPath: HostPath | NaisysPath) {
  const dirHostPath =
    dirPath instanceof NaisysPath
      ? dirPath.toHostPath()
      : dirPath.getHostPath();

  if (!fs.existsSync(dirHostPath)) {
    fs.mkdirSync(dirHostPath, { recursive: true });
  }
}

export function getInstallPath() {
  const packageUrl = new URL("../../", import.meta.url);
  const packagePath = fileURLToPath(packageUrl);
  return new HostPath(packagePath);
}
