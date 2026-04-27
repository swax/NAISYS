/**
 * Mock-LLM driven session E2E.
 *
 * Most existing tests run with shellModel: none, which keeps the agent
 * pinned in debug mode and never exercises the LLM-mode branches of the
 * command loop. This test boots an agent with the built-in `mock` model
 * (LlmApiType.Mock → vendors/mock.ts), which simulates a real LLM
 * round-trip with a fixed scripted response:
 *
 *   ns-comment "Mock LLM ran at <iso>"
 *   ns-session wait 5
 *
 * One cycle is roughly 10s (5s mock latency + 5s wait), so a couple of
 * cycles is enough to drive: llmService.query (mock branch),
 * commandLoop.getLlmCommands → processOneIteration, commandHandler in
 * LLM mode (firstLine append / ns-comment routing), promptBuilder
 * LLM-mode prompts, costTracker registering query metadata, and the
 * timed-wait → resume path of ns-session wait.
 *
 *  1. Spawn standalone naisys with watcher.yaml at the root (the lead
 *     operator, shellModel: none) and watcher/alex.yaml as its
 *     subordinate (shellModel: mock). One lead → only watcher
 *     auto-starts and grabs the console in debug mode.
 *  2. From watcher, ns-agent start alex spins alex up locally.
 *  3. Wait for two of alex's mock cycles to materialise in alex's buffer
 *     via ns-agent peek (proves the LLM loop iterated more than once).
 *  4. Switch CLI focus to alex; ns-cost dumps tracked query data
 *     (mock model exercises the model-detail branch of printCosts even
 *     though its input/output cost is 0).
 *  5. Switch back to watcher; ns-agent stop alex aborts alex's loop
 *     mid-iteration (covers the AGENT STOPPED path in commandLoop.run).
 *  6. exit → clean shutdown.
 */

import { sleep } from "@naisys/common";
import { mkdirSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  createEnvFile,
  getTestDir,
  setupTestDir,
  spawnNaisys,
  waitForExit,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 180000 });

describe("Mock-LLM Loop E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  beforeEach(() => {
    testDir = getTestDir("cli_mock_llm_loop");
    setupTestDir(testDir);
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    cleanupTestDir(testDir);
  });

  test("mock model drives a real LLM loop and the operator can peek/stop it", async () => {
    createEnvFile(testDir);

    // watcher is the operator (debug mode). alex lives in watcher/ so it's
    // a subordinate — it does NOT auto-start, leaving the console with
    // watcher who can drive ns-agent start/peek/stop.
    createAgentYaml(testDir, "watcher.yaml", {
      username: "watcher",
      title: "Operator",
      shellModel: "none",
    });
    mkdirSync(join(testDir, "watcher"));
    createAgentYaml(testDir, "watcher/alex.yaml", {
      username: "alex",
      title: "MockBot",
      shellModel: "mock",
      tokenMax: 50000,
    });

    naisys = spawnNaisys(testDir, { args: [] });

    await naisys.waitForOutput("AGENT STARTED", 30000);
    await naisys.waitForPrompt();

    // --- Start alex from watcher; this exercises agentManager.startAgent
    //     in non-hub mode, including the subagent.ts startup-mail path. ---
    {
      const out = await naisys.runCommand(
        'ns-agent start alex "drive the mock LLM"',
        { waitFor: "started", timeoutMs: 30000 },
      );
      expect(out.toLowerCase()).toContain("started");
    }

    // --- ns-agent local lists watcher and alex now ---
    {
      const out = await naisys.runCommand("ns-agent local");
      expect(out).toContain("watcher");
      expect(out).toContain("alex");
    }

    // --- Wait for at least two mock cycles to land in alex's buffer ---
    // ns-agent peek pulls the buffered console for alex; we poll until the
    // "Mock LLM ran at" string appears twice (proving the loop iterated).
    const start = Date.now();
    const pollDeadlineMs = 60000;
    let peeked = "";
    while (Date.now() - start < pollDeadlineMs) {
      peeked = await naisys.runCommand("ns-agent peek alex", {
        timeoutMs: 15000,
      });
      const cycles = (peeked.match(/Mock LLM ran at/g) ?? []).length;
      if (cycles >= 2) break;
      await sleep(2000);
    }
    expect(peeked).toContain("Mock LLM ran at");
    expect(
      (peeked.match(/Mock LLM ran at/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    // ns-comment routes through commandHandler in LLM mode and shows up
    // in the buffer alongside the wait-window prompt suffix.
    expect(peeked).toContain("ns-comment");

    // --- Switch CLI to alex and dump cost data ---
    // Cost rows are recorded per query — even with 0 input/output cost the
    // model breakdown branch in costDisplayService.printCosts runs.
    await naisys.switchAgent("alex");
    {
      const out = await naisys.runCommand("ns-cost", { timeoutMs: 15000 });
      expect(out).toContain("Total cost:");
    }

    // Switch back to watcher to drive the stop.
    await naisys.switchAgent("watcher");

    // --- Stop alex mid-iteration (aborts the mock query or the wait) ---
    {
      const out = await naisys.runCommand("ns-agent stop alex", {
        waitFor: "stop requested",
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("stop requested");
    }

    // Stop is async; the mock's 5s query has to finish aborting and the
    // command loop has to drain. Poll ns-agent local until alex disappears.
    const stopDeadline = Date.now() + 15000;
    let localOut = "";
    while (Date.now() < stopDeadline) {
      localOut = await naisys.runCommand("ns-agent local", {
        timeoutMs: 15000,
      });
      if (!localOut.includes("alex")) break;
      await sleep(500);
    }
    expect(localOut).toContain("watcher");
    expect(localOut).not.toContain("alex");

    // --- Clean shutdown ---
    await naisys.runCommand("exit", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 30000,
    });

    const exitCode = await waitForExit(naisys.process, 15000);
    expect(exitCode).toBe(0);

    naisys.dumpStderrIfAny();
  });
});
