import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { getGitCommitHash, resolveHubAccessKey } from "@naisys/common-node";
import os from "os";

import { getInstallPath } from "../services/runtime/pathService.js";
import { detectHostEnvironment } from "./hostEnvironment.js";

export function createHubClientConfig(hubUrl: string) {
  if (!resolveHubAccessKey()) {
    throw new Error(
      "HUB_ACCESS_KEY is required to connect to a hub. Set it in .env or place it in NAISYS_FOLDER/cert/hub-access-key.",
    );
  }

  // Origin (and any prefix) without the `/hub` suffix — exposed to agent
  // shells as $NAISYS_API_URL_BASE so commands can target sibling endpoints
  // like /erp/api/* without hardcoding the host/port.
  const apiUrlBase = hubUrl.replace(/\/hub\/?$/, "");

  const hostname = process.env.NAISYS_HOSTNAME || os.hostname();
  const machineId = process.env.NAISYS_MACHINE_ID || "";
  const instanceId = randomUUID();
  const processStartedAt = Date.now();

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

  const environment = detectHostEnvironment();

  return {
    hubUrl,
    apiUrlBase,
    hostname,
    machineId,
    instanceId,
    processStartedAt,
    clientVersion,
    environment,
  };
}

export type HubClientConfig = ReturnType<typeof createHubClientConfig>;
