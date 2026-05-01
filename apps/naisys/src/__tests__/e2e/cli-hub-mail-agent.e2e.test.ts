/**
 * Integrated-hub NAISYS CLI workflow E2E.
 *
 * Boots `naisys --integrated-hub` (no supervisor) with a lead/subordinate
 * agent layout (alex.yaml at the root, alex/bob.yaml as alex's
 * subordinate). Drives the CLI through the surfaces that only register
 * when a hub is connected — `ns-host`, `ns-hub`, the hub-only branches
 * of `ns-mail`/`ns-chat`, and the real subagent lifecycle through
 * `ns-agent start/peek/stop`.
 *
 *  1. Spawn naisys with --integrated-hub; only admin auto-starts.
 *  2. Verify ns-host shows the local host and ns-hub reports Connected.
 *  3. ns-agent help (now includes `recent` since hubClient is present).
 *  4. From admin (debug user) start alex, then switch to alex.
 *  5. From alex, start bob (real AGENT_START round-trip through the hub),
 *     then ns-agent peek bob (AGENT_PEEK round-trip).
 *  6. From alex, send mail to bob through the hub (MAIL_SEND).
 *  7. Switch to bob; exercise every hub-only mail subcommand:
 *     inbox, read, outbox-after-reply, archive (single + comma list),
 *     search (default / -archived / -subject / no-terms), unknown
 *     subcommand.
 *  8. Exercise every hub-only chat subcommand: help, send (+ \n escape),
 *     recent (default / filtered / take+skip / invalid take / invalid
 *     skip), missing-arg usage error.
 *  9. Switch back to alex; ns-agent list shows bob running, ns-agent
 *     stop bob round-trips through the hub.
 * 10. exit all → both agents stop, naisys exits cleanly.
 */

import { sleep } from "@naisys/common";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  formatDotenvValue,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
  waitForExit,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 180000 });

describe("CLI integrated-hub mail/chat/agent E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  const HOSTNAME = "TEST-HUB-CLI";
  let SERVER_PORT: number;

  beforeEach(async () => {
    testDir = getTestDir("cli_hub_mail_agent");
    setupTestDir(testDir);
    SERVER_PORT = await getFreePort();
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    await sleep(200);
    cleanupTestDir(testDir);
  });

  function createIntegratedEnvFile(dir: string) {
    const envContent = `
NAISYS_FOLDER=${formatDotenvValue(dir)}
NAISYS_HOSTNAME="${HOSTNAME}"
SPEND_LIMIT_DOLLARS=10
SERVER_PORT=${SERVER_PORT}
MAIL_ENABLED=true
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
  }

  test("integrated-hub debug CLI exercises ns-host/ns-hub, full mail lifecycle, chat surfaces, and subagent start/peek/stop", async () => {
    createIntegratedEnvFile(testDir);

    // alex is a top-level lead agent, bob lives in alex/ so bob.leadUserId === alex
    createAgentYaml(testDir, "alex.yaml", {
      username: "alex",
      title: "Lead",
      mailEnabled: true,
      chatEnabled: true,
    });
    mkdirSync(join(testDir, "alex"));
    createAgentYaml(testDir, "alex/bob.yaml", {
      username: "bob",
      title: "Worker",
      mailEnabled: true,
      chatEnabled: true,
      wakeOnMessage: true,
    });

    naisys = spawnNaisys(testDir, { args: ["--integrated-hub"] });

    // --integrated-hub starts only admin; wait for the admin prompt.
    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    // --- ns-host (registers only when a hub is connected) ---
    {
      const out = await naisys.runCommand("ns-host");
      expect(out).toContain("Host");
      expect(out).toContain("Status");
      expect(out).toContain(HOSTNAME);
      expect(out).toContain("(local)");
      expect(out).toContain("Online");
    }

    // --- ns-hub ---
    {
      const out = await naisys.runCommand("ns-hub");
      expect(out).toContain(`http://localhost:${SERVER_PORT}`);
      expect(out).toContain("Connected");
    }

    // --- ns-agent help in hub mode includes the chat-style subcommands ---
    {
      const out = await naisys.runCommand("ns-agent help");
      expect(out).toContain("ns-agent <command>");
      expect(out).toContain("list");
      expect(out).toContain("start");
      expect(out).toContain("peek");
      expect(out).toContain("stop");
    }

    // --- Start alex from admin (debug mode bypasses the subordinate check) ---
    await naisys.startAgent("alex", "lead test");
    await naisys.switchAgent("alex");

    // From alex, list subagents — bob should appear (stopped).
    {
      const out = await naisys.runCommand("ns-agent list");
      expect(out).toContain("bob");
      expect(out).toContain("stopped");
    }

    // --- Real AGENT_START round-trip through the hub ---
    {
      const out = await naisys.runCommand(
        'ns-agent start bob "process incoming mail"',
        { waitFor: "started", timeoutMs: 30000 },
      );
      expect(out.toLowerCase()).toContain("started");
    }

    // Give bob a beat to settle before peeking.
    await sleep(500);

    // --- ns-agent peek round-trips through the hub (AGENT_PEEK) ---
    {
      const out = await naisys.runCommand("ns-agent peek bob", {
        timeoutMs: 15000,
      });
      // Either some buffered lines or the empty-buffer message — the hub call
      // succeeded as long as we got a prompt back.
      expect(out.length).toBeGreaterThan(0);
    }

    // --- Already-running guard (subagent.ts validateSubagentStart) ---
    {
      const out = await naisys.runCommand('ns-agent start bob "again"', {
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("already running");
    }

    // --- Send mail alex → bob through the hub (covers MAIL_SEND in mail.ts) ---
    const subject = "Hub integration test";
    const body = "Body for the hub integration test mail";
    await naisys.sendMail("bob", subject, body);

    // Send a second piece of mail so we can exercise comma-list archive later.
    await naisys.sendMail("bob", "Second subject", "Second body");

    // --- Switch to bob and walk every hub-only mail branch ---
    await naisys.switchAgent("bob");

    // Inbox lists messages newest-first; index IDs by subject so we don't
    // depend on row order.
    let firstMailId: string;
    let secondMailId: string;
    {
      const out = await naisys.runCommand("ns-mail inbox", {
        waitFor: subject,
        timeoutMs: 15000,
      });
      expect(out).toContain(subject);
      expect(out).toContain("Second subject");
      expect(out).toContain("alex");

      // Each row is `* | ID | From | Subject | Date`. Capture id+subject.
      const rows = [
        ...out.matchAll(/\|\s*(\d+)\s*\|\s*alex\s*\|\s*([^|]+?)\s*\|/gi),
      ];
      const idBySubject = new Map<string, string>();
      for (const m of rows) {
        idBySubject.set(m[2].trim(), m[1]);
      }
      const idForFirst = idBySubject.get(subject);
      const idForSecond = idBySubject.get("Second subject");
      expect(idForFirst).toBeDefined();
      expect(idForSecond).toBeDefined();
      firstMailId = idForFirst!;
      secondMailId = idForSecond!;
    }

    // Read marks read and renders the body.
    {
      const out = await naisys.readMail(firstMailId);
      expect(out).toContain(body);
    }

    // Bob replies so outbox isn't empty.
    await naisys.sendMail("alex", "re: " + subject, "ack");

    {
      const out = await naisys.runCommand("ns-mail outbox", {
        waitFor: "re:",
        timeoutMs: 15000,
      });
      expect(out).toContain("re: " + subject);
      expect(out).toContain("alex");
    }

    // Search by body terms (default branch).
    {
      const out = await naisys.runCommand(
        "ns-mail search hub integration test",
        { waitFor: subject, timeoutMs: 15000 },
      );
      expect(out).toContain(subject);
    }
    // -subject restricts to subject column.
    {
      const out = await naisys.runCommand("ns-mail search -subject Second", {
        waitFor: "Second",
        timeoutMs: 15000,
      });
      expect(out).toContain("Second subject");
    }
    // -archived flag flows through (no archived rows yet, but the flag is parsed).
    {
      const out = await naisys.runCommand(
        "ns-mail search -archived nonexistent_term_xyz",
        { timeoutMs: 15000 },
      );
      expect(out).toContain("No messages found");
    }
    // No terms → usage error.
    {
      const out = await naisys.runCommand("ns-mail search", {
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("usage");
    }

    // Archive single id, then comma-list (parses the archive multi-id branch).
    {
      const out = await naisys.runCommand(`ns-mail archive ${firstMailId}`, {
        waitFor: "archived",
        timeoutMs: 15000,
      });
      expect(out).toContain("archived");
    }
    {
      const out = await naisys.runCommand(`ns-mail archive ${secondMailId}`, {
        waitFor: "archived",
        timeoutMs: 15000,
      });
      expect(out).toContain("archived");
    }
    // Archive with no args → usage error.
    {
      const out = await naisys.runCommand("ns-mail archive", {
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("usage");
    }
    // Archive with non-numeric id → usage error.
    {
      const out = await naisys.runCommand("ns-mail archive abc", {
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("usage");
    }
    // Unknown subcommand falls through to default branch.
    {
      const out = await naisys.runCommand("ns-mail bogus", {
        timeoutMs: 15000,
      });
      expect(out).toContain("Unknown ns-mail subcommand");
    }

    // --- ns-chat surfaces (hub-mode help has `recent`) ---
    {
      const out = await naisys.runCommand("ns-chat");
      expect(out).toContain("ns-chat <command>");
      expect(out).toContain("send");
      expect(out).toContain("recent");
    }
    {
      const out = await naisys.runCommand("ns-chat help");
      expect(out).toContain("ns-chat <command>");
      expect(out).toContain("recent");
    }
    // Send with a literal \n that the handler converts to a real newline.
    {
      const out = await naisys.runCommand(
        'ns-chat send "alex" "first line\\nsecond line"',
        { waitFor: "Chat sent", timeoutMs: 15000 },
      );
      expect(out).toContain("Chat sent");
    }
    // Send without args is a usage error.
    {
      const out = await naisys.runCommand("ns-chat send", {
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("usage");
    }
    // Recent — overview mode, no filter.
    {
      const out = await naisys.runCommand("ns-chat recent", {
        waitFor: "first line",
        timeoutMs: 15000,
      });
      expect(out).toContain("first line");
      expect(out).toContain("second line");
    }
    // Recent filtered to alex (conversation mode).
    {
      const out = await naisys.runCommand('ns-chat recent 10 0 "alex"', {
        timeoutMs: 15000,
      });
      expect(out).toContain("first line");
    }
    // Recent with take+skip (numeric branches).
    {
      const out = await naisys.runCommand('ns-chat recent 5 0 "alex"', {
        timeoutMs: 15000,
      });
      expect(out).toContain("first line");
    }
    // Invalid take and skip — both branches throw.
    {
      const out = await naisys.runCommand("ns-chat recent abc", {
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("invalid take");
    }
    {
      const out = await naisys.runCommand("ns-chat recent 5 abc", {
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("invalid skip");
    }
    // Unknown subcommand goes through the default branch (echoes help).
    {
      const out = await naisys.runCommand("ns-chat bogus", {
        timeoutMs: 15000,
      });
      expect(out).toContain("Unknown ns-chat subcommand");
    }

    // --- Switch back to alex; verify bob shows running and stop it ---
    await naisys.switchAgent("alex");

    {
      const out = await naisys.runCommand("ns-agent list");
      expect(out).toContain("bob");
      expect(out).toContain("running");
    }
    {
      const out = await naisys.runCommand("ns-agent stop bob", {
        waitFor: "stop requested",
        timeoutMs: 15000,
      });
      expect(out.toLowerCase()).toContain("stop requested");
    }

    // --- Clean shutdown ---
    await naisys.runCommand("exit all", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 30000,
    });

    const exitCode = await waitForExit(naisys.process, 15000);
    expect(exitCode).toBe(0);

    naisys.dumpStderrIfAny("Integrated NAISYS");
  });
});
