/**
 * Supervisor Mail UI E2E.
 *
 *  1. Boot integrated hub + supervisor with three agents (alpha, beta,
 *     gamma) and login to the supervisor API as superadmin.
 *  2. Seed three mail messages via the multipart endpoint so the
 *     AgentMail page has content to render:
 *       - beta  -> alpha "Status update" + attachment status.txt
 *       - gamma -> alpha "RE: Status update"
 *       - beta  -> alpha "Lunch?"
 *  3. Launch headless Chromium and register the bootstrap superadmin passkey.
 *  4. Navigate to /supervisor/agents/alpha/mail. Assert the conversation
 *     list shows two participant-grouped conversations (alpha+beta and
 *     alpha+gamma) and one auto-selects (URL switches to /mail/with/...).
 *  5. Toggle "Group by subject"; assert URL becomes /mail/about/... and
 *     that "Status update" + "Lunch?" appear as distinct conversation
 *     rows. Click the "Status update" row and assert the MailThread
 *     renders both messages and the attachment filename.
 *  6. Click Reply; assert the New Message modal opens with the subject
 *     pre-filled to "RE: Status update". Discard, then open New Message,
 *     send "Hi gamma" to gamma, and assert it appears via the supervisor
 *     mail API for gamma.
 *  7. Click "Archive All"; assert via the supervisor API that every
 *     alpha-recipient row has archivedAt populated.
 */

import { sleep } from "@naisys/common";
import type {
  AgentListResponse,
  MailDataResponse,
  SendMailResponse,
} from "@naisys/supervisor-shared";
import { writeFileSync } from "fs";
import { join } from "path";
import { type Browser, chromium, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  dumpClientCoverage,
  formatDotenvValue,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";
import {
  loginAsSuperAdmin,
  registerSuperAdminPasskeyViaUi,
  waitFor,
} from "./supervisorApiHelper.js";

vi.setConfig({ testTimeout: 180000 });

describe("Supervisor Mail UI E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;

  const HOSTNAME = "TEST-SUPERVISOR-MAIL-UI";
  let SERVER_PORT: number;
  let API_BASE: string;
  let APP_BASE: string;

  beforeEach(async () => {
    testDir = getTestDir("supervisor_mail_ui");
    setupTestDir(testDir);
    SERVER_PORT = await getFreePort();
    API_BASE = `http://localhost:${SERVER_PORT}/supervisor/api`;
    APP_BASE = `http://localhost:${SERVER_PORT}/supervisor`;
  });

  afterEach(async () => {
    if (page) {
      await dumpClientCoverage(page);
      page = null;
    }
    if (browser) {
      await browser.close();
      browser = null;
    }
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    await sleep(500);
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

  test("renders conversations, sends a reply, and archives all", async () => {
    // ---- Step 1: boot integrated hub + supervisor with 3 agents ----
    createIntegratedEnvFile(testDir);
    createAgentYaml(testDir, "alpha.yaml", {
      username: "alpha",
      title: "Alpha Bot",
      mailEnabled: true,
    });
    createAgentYaml(testDir, "beta.yaml", {
      username: "beta",
      title: "Beta Bot",
      mailEnabled: true,
    });
    createAgentYaml(testDir, "gamma.yaml", {
      username: "gamma",
      title: "Gamma Bot",
      mailEnabled: true,
    });

    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", testDir],
      env: { NODE_ENV: "production", NAISYS_FOLDER: testDir },
    });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    const api = await loginAsSuperAdmin(naisys, API_BASE);

    const agents = await api.get<AgentListResponse>("/agents");
    const alpha = agents.items.find((a) => a.name === "alpha");
    const beta = agents.items.find((a) => a.name === "beta");
    const gamma = agents.items.find((a) => a.name === "gamma");
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(gamma).toBeDefined();

    // ---- Step 2: seed three mail messages for alpha ----
    const attachmentText = "status report payload";
    const attachmentName = "status.txt";

    const mail1 = new FormData();
    mail1.append("fromId", String(beta!.id));
    mail1.append("toIds", JSON.stringify([alpha!.id]));
    mail1.append("subject", "Status update");
    mail1.append("message", "Sprint is on track.");
    mail1.append(
      "attachments",
      new Blob([attachmentText], { type: "text/plain" }),
      attachmentName,
    );
    const mail1Result = await api.postMultipart<SendMailResponse>(
      "/agents/beta/mail",
      mail1,
    );
    expect(mail1Result.success).toBe(true);

    const mail2 = await api.post<SendMailResponse>("/agents/gamma/mail", {
      fromId: gamma!.id,
      toIds: [alpha!.id],
      subject: "RE: Status update",
      message: "Thanks for the update.",
    });
    expect(mail2.success).toBe(true);

    const mail3 = await api.post<SendMailResponse>("/agents/beta/mail", {
      fromId: beta!.id,
      toIds: [alpha!.id],
      subject: "Lunch?",
      message: "Want to grab lunch tomorrow?",
    });
    expect(mail3.success).toBe(true);

    // Wait for all three to land in alpha's inbox via the API.
    await waitFor(
      "alpha to have all 3 seeded messages",
      () => api.get<MailDataResponse>("/agents/alpha/mail?count=20"),
      (r) => (r.data?.mail.length ?? 0) >= 3,
    );

    // ---- Step 3: register bootstrap passkey and enter the UI as superadmin ----
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // Auto-accept any window.confirm dialogs (Archive All, discard message).
    page.on("dialog", (dialog) => {
      void dialog.accept();
    });

    await registerSuperAdminPasskeyViaUi(naisys, page);

    // ---- Step 4: open alpha's mail page; default mode groups by participants ----
    await page.goto(`${APP_BASE}/agents/alpha/mail`);

    // Wait for one of the conversation rows (beta or gamma) to render.
    await page
      .getByText("beta (Beta Bot)")
      .first()
      .waitFor({ state: "visible", timeout: 15000 });
    await page
      .getByText("gamma (Gamma Bot)")
      .first()
      .waitFor({ state: "visible", timeout: 15000 });

    // Auto-select effect should navigate to /mail/with/<other>.
    await page.waitForURL(/\/agents\/alpha\/mail\/with\//, { timeout: 10000 });

    // ---- Step 5: toggle group-by-subject and open Status update thread ----
    await page.getByLabel("Group by subject").check();
    await page.waitForURL(
      (url) =>
        url.pathname.includes("/agents/alpha/mail/about/") ||
        url.pathname.endsWith("/agents/alpha/mail"),
      { timeout: 10000 },
    );

    // Both subjects should appear as conversation rows.
    await page
      .getByText("Status update", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
    await page
      .getByText("Lunch?", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 10000 });

    // Click into "Status update" — both messages should render in the thread.
    await page.getByText("Status update", { exact: true }).first().click();
    await page.waitForURL(/\/agents\/alpha\/mail\/about\/Status%20update/, {
      timeout: 10000,
    });

    await page
      .getByText("Sprint is on track.")
      .waitFor({ state: "visible", timeout: 10000 });
    await page
      .getByText("Thanks for the update.")
      .waitFor({ state: "visible", timeout: 10000 });
    await page
      .getByText(attachmentName)
      .first()
      .waitFor({ state: "visible", timeout: 10000 });

    // ---- Step 6: Reply opens prefilled modal; discard it then send fresh ----
    await page.getByRole("button", { name: "Reply" }).click();
    const replyDialog = page.getByRole("dialog");
    await replyDialog
      .getByText("New Message")
      .waitFor({ state: "visible", timeout: 10000 });
    const subjectValue = await replyDialog.getByLabel("Subject").inputValue();
    expect(subjectValue).toMatch(/^RE: Status update/);

    await replyDialog.getByRole("button", { name: "Cancel" }).click();
    await replyDialog.waitFor({ state: "hidden", timeout: 10000 });

    // Open the New Message modal fresh and send "Hi gamma" to gamma.
    await page.getByRole("button", { name: "New Message" }).click();
    const newDialog = page.getByRole("dialog");
    await newDialog
      .getByText("New Message")
      .waitFor({ state: "visible", timeout: 10000 });

    // Mantine MultiSelect: click input, then click the option for gamma.
    await newDialog.getByLabel("To").click();
    await page
      .getByRole("option", { name: /^gamma/ })
      .first()
      .click();
    await newDialog.getByLabel("Subject").fill("Hi gamma");
    await newDialog.getByLabel("Message").fill("Pinging you from the UI test.");
    await newDialog.getByRole("button", { name: "Send" }).click();

    // Modal should close on send.
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 15000 });

    // Verify via API that the new message landed for gamma.
    await waitFor(
      "gamma inbox to receive Hi gamma",
      () => api.get<MailDataResponse>("/agents/gamma/mail?count=20"),
      (r) =>
        (r.data?.mail ?? []).some(
          (m) => m.subject === "Hi gamma" && m.fromUsername === "alpha",
        ),
    );

    // ---- Step 7: Archive All; assert API reports archivedAt for alpha ----
    await page.getByRole("button", { name: "Archive All" }).click();

    await waitFor(
      "alpha mail rows to be archived",
      () => api.get<MailDataResponse>("/agents/alpha/mail?count=20"),
      (r) => {
        const rows = r.data?.mail ?? [];
        if (rows.length === 0) return false;
        return rows.every((m) =>
          m.recipients.some(
            (rec) => rec.username === "alpha" && rec.archivedAt !== null,
          ),
        );
      },
    );

    naisys.dumpStderrIfAny("Integrated NAISYS");
  });
});
