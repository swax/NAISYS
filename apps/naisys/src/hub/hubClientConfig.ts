import { readFileSync } from "node:fs";

import { getGitCommitHash, resolveHubAccessKey } from "@naisys/common-node";
import os from "os";

import { getInstallPath } from "../services/pathService.js";

export function createHubClientConfig(hubUrl: string) {
  if (!resolveHubAccessKey()) {
    throw new Error(
      "HUB_ACCESS_KEY is required to connect to a hub. Set it in .env or place it in NAISYS_FOLDER/cert/hub-access-key.",
    );
  }

  const hostname = process.env.NAISYS_HOSTNAME || os.hostname();
  const machineId = process.env.NAISYS_MACHINE_ID || "";

  let clientVersion = "";
  try {
    const pkg = JSON.parse(
      readFileSync(`${getInstallPath()}/package.json`, "utf-8"),
    );
    clientVersion = pkg.version;
  } catch {
    // version unavailable
  }

  const commitHash = getGitCommitHash(getInstallPath());
  if (commitHash) {
    clientVersion += `/${commitHash}`;
  }

  return {
    hubUrl,
    hostname,
    machineId,
    clientVersion,
  };
}

export type HubClientConfig = ReturnType<typeof createHubClientConfig>;
