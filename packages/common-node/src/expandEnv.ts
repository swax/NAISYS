import os from "os";

/** Expand ~ to the user's home directory in NAISYS_FOLDER */
export function expandNaisysFolder() {
  if (process.env.NAISYS_FOLDER?.startsWith("~")) {
    process.env.NAISYS_FOLDER = process.env.NAISYS_FOLDER.replace(
      "~",
      os.homedir(),
    );
  }
}
