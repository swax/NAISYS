import * as fs from "fs";
import * as os from "os";
import path from "path";
import { get_encoding } from "tiktoken";

/** Take a unix path and convert to something that can be
 *  opened by the host with the native fs library and such */
export function unixToHostPath(unixPath: string) {
  const match = unixPath.match(/^\/mnt\/([a-zA-Z])\//);

  if (os.platform() === "win32" && match) {
    // Replace '/mnt/c/' with 'C:/' and convert forward slashes to backslashes
    return unixPath
      .replace(`/mnt/${match[1]}/`, `${match[1].toLowerCase()}:\\`)
      .replace(/\//g, "\\");
  }
  return unixPath;
}

export function hostToUnixPath(hostPath: string) {
  const match = hostPath.match(/^([a-zA-Z]):\\(.*)/);

  if (os.platform() === "win32" && match) {
    // Replace 'C:\' with '/mnt/c/' and convert backslashes to forward slashes
    return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
  }
  return hostPath; // Return the original path if it doesn't match the pattern
}

export function valueFromString(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: any,
  path: string,
  defaultValue?: string,
) {
  if (!path) {
    return obj;
  }
  const keys = path.split(".");
  let result = obj;
  for (const key of keys) {
    result = result?.[key];
    if (result === undefined) {
      return defaultValue;
    }
  }
  return result;
}

const _gpt2encoding = get_encoding("gpt2");

export function getTokenCount(text: string) {
  return _gpt2encoding.encode(text).length;
}

export function ensureFileDirExists(filePath: string) {
  filePath = unixToHostPath(filePath);
  const dirPath = path.dirname(filePath);
  ensureDirExists(dirPath);
}

export function ensureDirExists(dirPath: string) {
  dirPath = unixToHostPath(dirPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function trimChars(text: string, charList: string) {
  return text.replace(new RegExp(`^[${charList}]+|[${charList}]+$`, "g"), "");
}
