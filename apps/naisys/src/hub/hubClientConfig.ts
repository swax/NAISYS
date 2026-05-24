import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { getGitCommitHash, resolveHostAccessKey } from "@naisys/common-node";

import { getInstallPath } from "../services/runtime/pathService.js";
import { detectHostEnvironment } from "./hostEnvironment.js";

export function createHubClientConfig(hubUrl: string) {
  if (!resolveHostAccessKey()) {
    throw new Error(
      "HOST_ACCESS_KEY is required to connect to a hub. Generate one for this host in the supervisor (Hosts → host → Access Key) and set it in .env.",
    );
  }

  // Origin (and any prefix) without the `/hub` suffix — exposed to agent
  // shells as $NAISYS_API_URL_BASE so commands can target sibling endpoints
  // like /erp/api/* without hardcoding the host/port.
  const apiUrlBase = hubUrl.replace(/\/hub\/?$/, "");

  const instanceId = randomUUID();
  const processStartedAt = Date.now();

  const pkg = JSON.parse(
    readFileSync(`${getInstallPath()}/package.json`, "utf-8"),
  );
  let clientVersion: string = pkg.version;

  const commitHash = getGitCommitHash(getInstallPath());
  if (commitHash) {
    clientVersion += `/${commitHash}`;
  }

  const environment = detectHostEnvironment();

  return {
    hubUrl,
    apiUrlBase,
    instanceId,
    processStartedAt,
    clientVersion,
    environment,
  };
}

export type HubClientConfig = ReturnType<typeof createHubClientConfig>;
