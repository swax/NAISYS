import { createHash } from "crypto";
import fs from "fs";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AgentConfig } from "../../agent/agentConfig.js";
import type { HubClient } from "../../hub/hubClient.js";
import { createStartupAttachmentService } from "../../services/agent/startupAttachmentService.js";
import type { HubAttachmentClient } from "../../services/hub/hubAttachmentClient.js";

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function makeAgentConfig(homeDir: string): AgentConfig {
  return { getHomeDir: () => homeDir } as unknown as AgentConfig;
}

function makeHubClient(hubUrl: string | undefined): HubClient | undefined {
  if (hubUrl === undefined) return undefined;
  return { getHubUrl: () => hubUrl } as unknown as HubClient;
}

describe("startupAttachmentService", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(tmpdir(), "naisys-startup-test-"));
  });
  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("getSummary returns undefined when nothing was staged", async () => {
    const hubAttachmentClient = {
      sweepStaleTmpFiles: vi.fn(() => Promise.resolve()),
      downloadToFile: vi.fn(),
      downloadToBuffer: vi.fn(),
    } as unknown as HubAttachmentClient;
    const svc = createStartupAttachmentService(
      hubAttachmentClient,
      makeHubClient("https://hub.example"),
      makeAgentConfig(homeDir),
    );

    await svc.stage([]);
    expect(svc.getSummary()).toBeUndefined();
    expect(hubAttachmentClient.sweepStaleTmpFiles).not.toHaveBeenCalled();
  });

  test("partial download failure does NOT throw; summary lists failures with curl retry", async () => {
    // The whole point of the non-fatal change: a flaky download for one
    // file should not block the agent from starting. The agent gets
    // enough info to curl the missing file itself once it's up.
    const hubAttachmentClient = {
      sweepStaleTmpFiles: vi.fn(() => Promise.resolve()),
      downloadToFile: vi.fn((publicId: string, targetPath: string) => {
        if (publicId === "broken") {
          return Promise.reject(
            new Error("Download failed (502): bad gateway"),
          );
        }
        writeFileSync(targetPath, `content-${publicId}`);
        return Promise.resolve();
      }),
      downloadToBuffer: vi.fn(),
    } as unknown as HubAttachmentClient;

    const svc = createStartupAttachmentService(
      hubAttachmentClient,
      makeHubClient("https://hub.example"),
      makeAgentConfig(homeDir),
    );

    await expect(
      svc.stage([
        {
          publicId: "ok-1",
          filename: "ok-1.txt",
          fileSize: 4,
          fileHash: "ignored",
          path: "ok-1.txt",
        },
        {
          publicId: "broken",
          filename: "broken.txt",
          fileSize: 4,
          fileHash: "ignored",
          path: "broken.txt",
        },
        {
          publicId: "ok-2",
          filename: "ok-2.txt",
          fileSize: 4,
          fileHash: "ignored",
          path: "ok-2.txt",
        },
      ]),
    ).resolves.toBeUndefined();

    // Successful downloads should have completed despite the failure.
    expect(fs.existsSync(path.join(homeDir, "ok-1.txt"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, "ok-2.txt"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, "broken.txt"))).toBe(false);

    const summary = svc.getSummary();
    expect(summary).toBeDefined();
    expect(summary).toContain("2 of 3 staged");
    expect(summary).toContain("1 failed");
    expect(summary).toContain("Failed downloads — retry with:");
    // Curl command points at the right URL and includes the error reason.
    expect(summary).toContain(
      'curl -H "Authorization: Bearer $NAISYS_API_KEY" "https://hub.example/attachments/broken" -o "broken.txt"',
    );
    expect(summary).toContain("bad gateway");
  });

  test("path-traversal attempt is reported as failure, not a thrown error", async () => {
    const hubAttachmentClient = {
      sweepStaleTmpFiles: vi.fn(() => Promise.resolve()),
      downloadToFile: vi.fn(),
      downloadToBuffer: vi.fn(),
    } as unknown as HubAttachmentClient;
    const svc = createStartupAttachmentService(
      hubAttachmentClient,
      makeHubClient("https://hub.example"),
      makeAgentConfig(homeDir),
    );

    await expect(
      svc.stage([
        {
          publicId: "evil",
          filename: "evil",
          fileSize: 1,
          fileHash: "x",
          path: "../escape.txt",
        },
      ]),
    ).resolves.toBeUndefined();

    // Defense-in-depth refusal short-circuits before downloadToFile is called.
    expect(hubAttachmentClient.downloadToFile).not.toHaveBeenCalled();
    const summary = svc.getSummary();
    expect(summary).toContain("0 of 1 staged");
    expect(summary).toContain("resolves outside home dir");
  });

  test("already-present file with matching hash is counted as cached, not redownloaded", async () => {
    const existingContent = "hello-cached";
    const existingPath = path.join(homeDir, "cached.txt");
    writeFileSync(existingPath, existingContent);

    const hubAttachmentClient = {
      sweepStaleTmpFiles: vi.fn(() => Promise.resolve()),
      downloadToFile: vi.fn(() => Promise.resolve()),
      downloadToBuffer: vi.fn(),
    } as unknown as HubAttachmentClient;
    const svc = createStartupAttachmentService(
      hubAttachmentClient,
      makeHubClient("https://hub.example"),
      makeAgentConfig(homeDir),
    );

    await svc.stage([
      {
        publicId: "cached",
        filename: "cached.txt",
        fileSize: existingContent.length,
        fileHash: sha256(existingContent),
        path: "cached.txt",
      },
    ]);

    expect(hubAttachmentClient.downloadToFile).not.toHaveBeenCalled();
    expect(svc.getSummary()).toContain("0 downloaded, 1 already present");
  });

  test("summary falls back to <HUB_URL> placeholder when no hubClient is wired", async () => {
    // Edge: subagent path nulls out hubClient. Stage isn't called with
    // attachments in that mode, but the summary should still degrade safely.
    const hubAttachmentClient = {
      sweepStaleTmpFiles: vi.fn(() => Promise.resolve()),
      downloadToFile: vi.fn(() =>
        Promise.reject(new Error("no hub credentials")),
      ),
      downloadToBuffer: vi.fn(),
    } as unknown as HubAttachmentClient;
    const svc = createStartupAttachmentService(
      hubAttachmentClient,
      undefined,
      makeAgentConfig(homeDir),
    );

    await svc.stage([
      {
        publicId: "abc",
        filename: "file.txt",
        fileSize: 1,
        fileHash: "x",
        path: "file.txt",
      },
    ]);

    const summary = svc.getSummary();
    expect(summary).toContain("<HUB_URL>/attachments/abc");
  });

  test("throws on missing NAISYS_FOLDER (catastrophic — can't stage anything)", async () => {
    const hubAttachmentClient = {
      sweepStaleTmpFiles: vi.fn(() => Promise.resolve()),
      downloadToFile: vi.fn(),
      downloadToBuffer: vi.fn(),
    } as unknown as HubAttachmentClient;
    const svc = createStartupAttachmentService(
      hubAttachmentClient,
      makeHubClient("https://hub.example"),
      { getHomeDir: () => undefined } as unknown as AgentConfig,
    );

    await expect(
      svc.stage([
        {
          publicId: "x",
          filename: "x",
          fileSize: 1,
          fileHash: "x",
          path: "x",
        },
      ]),
    ).rejects.toBeDefined();
  });
});
