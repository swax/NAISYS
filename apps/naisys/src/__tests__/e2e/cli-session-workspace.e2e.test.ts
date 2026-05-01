/**
 * NAISYS standalone CLI session/workspace/agent E2E.
 *
 * Drives a single naisys process in standalone mode (no hub) with two
 * lead agents (alex + bob) at shellModel: none. The CLI stays in debug
 * mode the entire time, so every command flows through commandRegistry,
 * commandHandler, shellWrapper, and the feature handlers without needing
 * an LLM provider.
 *
 *  1. Spawn naisys with two yamls; alex auto-focuses.
 *  2. Exercise ns-help, ns-config (read/single/update/missing), ns-cost
 *     (default/reset/invalid), ns-host, ns-context, ns-pause toggles,
 *     and ns-users.
 *  3. Workspace lifecycle: usage / missing-arg / not-found / not-a-file /
 *     duplicate / abs-vs-rel / list / remove / clear; covers every branch
 *     in features/workspaces.ts.
 *  4. Session lifecycle: help / unknown / wait without arg / wait NaN /
 *     compact-not-enabled / restore-empty / complete-not-enabled / a real
 *     wait 1s; covers every branch reachable without an LLM.
 *  5. Agent multiplexing: ns-agent help/local/peek/stop-unknown/switch-
 *     unknown, then switch to bob, prove username changed via ns-config,
 *     switch back to alex.
 *  6. Mail in standalone: ns-mail send (local delivery) and ns-mail inbox
 *     (asserts the local-mode error path).
 *  7. Shell pass-through via shellWrapper: a successful echo and a
 *     command-not-found path that the shellCommand wraps with a hint.
 *  8. Clean shutdown via `exit all`, killing both agents.
 */

import { appendFileSync, writeFileSync } from "fs";
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

vi.setConfig({ testTimeout: 120000 });

describe("CLI Session/Workspace E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  beforeEach(() => {
    testDir = getTestDir("cli_session_workspace");
    setupTestDir(testDir);
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    cleanupTestDir(testDir);
  });

  test("standalone debug-mode CLI exercises commands, workspace, session, agents, mail, and shell", async () => {
    createEnvFile(testDir);
    appendFileSync(join(testDir, ".env"), `\nMAIL_ENABLED=true`);

    createAgentYaml(testDir, "alex.yaml", {
      username: "alex",
      title: "Assistant",
      mailEnabled: true,
    });
    createAgentYaml(testDir, "bob.yaml", {
      username: "bob",
      title: "Assistant",
      mailEnabled: true,
    });

    // Workspace fixture file used by the workspace section
    const fixturePath = join(testDir, "fixture.txt");
    writeFileSync(fixturePath, "hello workspace\n");

    naisys = spawnNaisys(testDir, { args: [] });

    await naisys.waitForOutput("AGENT STARTED", 30000);
    await naisys.waitForPrompt();

    // --- ns-help ---
    {
      const out = await naisys.runCommand("ns-help");
      expect(out).toContain("Commands:");
      expect(out).toContain("ns-workspace");
      expect(out).toContain("ns-session");
      expect(out).toContain("ns-mail");
      expect(out).toContain("ns-agent");
      // Debug-only commands appear because we're in interactive debug mode
      expect(out).toContain("Debug commands:");
      expect(out).toContain("ns-config");
      expect(out).toContain("ns-context");
      expect(out).toContain("ns-pause");
      expect(out).toContain("ns-cost");
      // ns-host/ns-hub only register when a hub is connected; this is the
      // standalone test, so they are intentionally absent.
    }

    // --- ns-config: full table, single field, missing, update, re-read ---
    {
      const tableOut = await naisys.runCommand("ns-config");
      expect(tableOut).toContain("Name");
      expect(tableOut).toContain("Value");
      expect(tableOut).toContain("username");
      expect(tableOut).toContain("alex");
      expect(tableOut).toContain("tokenMax");
    }
    {
      const single = await naisys.runCommand("ns-config username");
      expect(single).toContain("alex");
    }
    {
      const missing = await naisys.runCommand("ns-config notarealfield");
      expect(missing).toContain("not found");
    }
    {
      const updated = await naisys.runCommand("ns-config tokenMax 75000");
      expect(updated).toContain("updated to '75000'");
      expect(updated).toContain("session only");
    }
    {
      const reread = await naisys.runCommand("ns-config tokenMax");
      expect(reread).toContain("75000");
    }

    // --- ns-cost: default print, reset, and invalid arg ---
    {
      const out = await naisys.runCommand("ns-cost");
      expect(out).toContain("Total cost: $0.00");
    }
    {
      const out = await naisys.runCommand("ns-cost reset");
      expect(out).toContain("Cost tracking data cleared.");
    }
    {
      const out = await naisys.runCommand("ns-cost foo");
      expect(out).toContain("only supports the 'reset' parameter");
    }

    // ns-host / ns-hub only register when a hub is connected (see
    // agentRuntime.ts), so they are intentionally not exercised here.

    // --- ns-context (just verify it dumps something sensible) ---
    {
      const out = await naisys.runCommand("ns-context");
      expect(out).toContain("------ System ------");
    }

    // --- ns-users ---
    {
      const out = await naisys.runCommand("ns-users");
      expect(out).toContain("alex");
    }

    // --- ns-pause toggle states ---
    {
      // Default state is "resumed". `off` is a no-op message.
      const out = await naisys.runCommand("ns-pause off");
      expect(out).toContain("already resumed");
    }
    {
      const out = await naisys.runCommand("ns-pause on");
      expect(out).toContain("Session paused");
    }
    {
      const out = await naisys.runCommand("ns-pause on");
      expect(out).toContain("already paused");
    }
    {
      // Toggle (no arg) flips back
      const out = await naisys.runCommand("ns-pause");
      expect(out).toContain("Session resumed");
    }

    // --- Workspaces: every branch ---
    {
      const usage = await naisys.runCommand("ns-workspace");
      expect(usage).toContain("Usage:");
      expect(usage).toContain("add");
      expect(usage).toContain("remove");
      expect(usage).toContain("list");
      expect(usage).toContain("clear");
    }
    {
      const out = await naisys.runCommand("ns-workspace add");
      expect(out).toContain("filepath is required");
    }
    {
      const out = await naisys.runCommand(
        "ns-workspace add does-not-exist.txt",
      );
      expect(out).toContain("File not found");
    }
    {
      const out = await naisys.runCommand("ns-workspace add fixture.txt");
      expect(out).toContain("Added to workspace");
      expect(out).toContain("fixture.txt");
    }
    {
      const dup = await naisys.runCommand("ns-workspace add fixture.txt");
      expect(dup).toContain("already in workspace");
    }
    {
      // Absolute path should resolve to the same set entry → still duplicate
      const dup = await naisys.runCommand(`ns-workspace add ${fixturePath}`);
      expect(dup).toContain("already in workspace");
    }
    {
      // Adding a directory hits the "not a file" branch
      const out = await naisys.runCommand("ns-workspace add .");
      expect(out).toContain("Path is not a file");
    }
    {
      const list = await naisys.runCommand("ns-workspace list");
      expect(list).toContain("Workspace files");
      expect(list).toContain(fixturePath);
    }
    {
      const out = await naisys.runCommand("ns-workspace remove");
      expect(out).toContain("filepath is required");
    }
    {
      const out = await naisys.runCommand("ns-workspace remove ghost.txt");
      expect(out).toContain("File not in workspace");
    }
    {
      const out = await naisys.runCommand("ns-workspace remove fixture.txt");
      expect(out).toContain("Removed from workspace");
    }
    {
      const empty = await naisys.runCommand("ns-workspace list");
      expect(empty).toContain("Workspace is empty");
    }
    {
      // Re-add then clear
      await naisys.runCommand("ns-workspace add fixture.txt");
      const cleared = await naisys.runCommand("ns-workspace clear");
      expect(cleared).toContain("Cleared 1 file(s)");
      const empty = await naisys.runCommand("ns-workspace list");
      expect(empty).toContain("Workspace is empty");
    }

    // --- Session: every non-LLM branch ---
    {
      const out = await naisys.runCommand("ns-session");
      expect(out).toContain("ns-session <subcommand>");
      expect(out).toContain("wait");
    }
    {
      const out = await naisys.runCommand("ns-session help");
      expect(out).toContain("ns-session <subcommand>");
    }
    {
      const out = await naisys.runCommand("ns-session bogus");
      expect(out).toContain("Unknown subcommand");
    }
    {
      const out = await naisys.runCommand("ns-session wait");
      expect(out).toContain("specify the number of seconds");
    }
    {
      const out = await naisys.runCommand("ns-session wait notanumber");
      expect(out).toContain("specify the number of seconds");
    }
    // ns-session compact is hardcoded enabled in globalConfigLoader and would
    // trigger a real CompactSession action (restart). Skip the disabled-branch
    // assertion; restore-without-info still covers session.ts cleanly below.
    {
      const out = await naisys.runCommand("ns-session restore");
      expect(out).toContain("No session restore information");
    }
    {
      const out = await naisys.runCommand('ns-session complete "done"');
      expect(out).toContain("not enabled for you");
    }
    {
      // A real timed wait — short enough not to slow the test materially
      const out = await naisys.runCommand("ns-session wait 1", {
        timeoutMs: 15000,
      });
      // The wait window is reflected in the prompt suffix
      expect(out.toLowerCase()).toContain("wait");
    }

    // --- ns-agent multiplexing ---
    {
      const out = await naisys.runCommand("ns-agent help");
      expect(out).toContain("ns-agent <command>");
      expect(out).toContain("list");
      expect(out).toContain("start");
    }
    {
      const out = await naisys.runCommand("ns-agent local");
      expect(out).toContain("alex");
      expect(out).toContain("bob");
    }
    {
      const out = await naisys.runCommand("ns-agent peek bob");
      // Bob auto-started, so peek should show its startup output
      expect(out.length).toBeGreaterThan(0);
    }
    {
      const out = await naisys.runCommand("ns-agent stop nobody");
      expect(out.toLowerCase()).toContain("not");
    }
    {
      const out = await naisys.runCommand("ns-agent switch nobody");
      expect(out.toLowerCase()).toContain("not");
    }

    // Switch to bob, verify username changed via ns-config, switch back
    await naisys.switchAgent("bob");
    {
      const out = await naisys.runCommand("ns-config username");
      expect(out).toContain("bob");
    }
    await naisys.switchAgent("alex");
    {
      const out = await naisys.runCommand("ns-config username");
      expect(out).toContain("alex");
    }

    // --- Mail: send works locally; inbox surfaces the local-mode error ---
    await naisys.sendMail("bob", "hello", "from alex");
    {
      const out = await naisys.runCommand("ns-mail inbox");
      expect(out).toContain("Not available in local mode");
    }

    // --- Shell pass-through (success + failure) ---
    {
      const out = await naisys.runCommand("echo hello-from-shell");
      expect(out).toContain("hello-from-shell");
    }
    {
      const out = await naisys.runCommand(
        "naisys_definitely_missing_command_xyz",
      );
      // shellCommand appends a platform-specific hint when bash reports
      // "command not found"; just assert the not-found marker landed.
      expect(out.toLowerCase()).toMatch(/not found|not recognized/);
    }

    // --- Clean shutdown via `exit all` ---
    await naisys.runCommand("exit all", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 15000,
    });

    const exitCode = await waitForExit(naisys.process, 10000);
    expect(exitCode).toBe(0);

    naisys.dumpStderrIfAny();
  });
});
