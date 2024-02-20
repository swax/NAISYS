import * as os from "os";

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
