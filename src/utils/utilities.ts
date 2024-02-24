import * as fs from "fs";
import * as os from "os";
import { get_encoding } from "tiktoken";

/** Take a NAISYS path and convert to something that can be
 *  opened by the host with the native fs library and such */
export function naisysToHostPath(filePath: string) {
  if (os.platform() === "win32" && filePath.startsWith("/mnt/")) {
    // "/mnt/c/" -> "c:/"
    filePath = filePath.substring(5);
    return filePath[0] + ":" + filePath.substring(1);
  } else {
    return filePath;
  }
}

export function valueFromString(obj: any, path: string, defaultValue?: string) {
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
  const dir = filePath.split("/").slice(0, -1).join("/");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
