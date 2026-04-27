/**
 * Supervisor admin workflow E2E.
 *
 *  1. Boot integrated hub + supervisor with two agents (operatorbot,
 *     peerbot) and login to the supervisor API as superadmin.
 *  2. Create a limited supervisor user; assert they cannot save a variable.
 *  3. Grant manage_variables; assert the same save now succeeds.
 *  4. Save and re-list a custom LLM model via the model routes.
 *  5. Save a variable through the variable route as superadmin.
 *  6. Export operatorbot's agent config, edit the YAML, and import it back;
 *     assert the revision history grew.
 *  7. Set and clear peerbot's lead agent.
 *  8. Disable, enable, archive, unarchive, and reset-spend on peerbot.
 *  9. Create a host, mark it restricted, assign and unassign peerbot, then
 *     delete the host while it is offline.
 * 10. Clean up the custom model, variable, permission, and limited user.
 */

import { sleep } from "@naisys/common";
import type {
  AgentDetailResponse,
  AgentListResponse,
  ConfigRevisionListResponse,
  ExportAgentConfigResponse,
  HostDetailResponse,
  ImportAgentConfigResponse,
  ModelsResponse,
  UpdateAgentConfigResponse,
  UserDetailResponse,
} from "@naisys/supervisor-shared";
import { writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";
import {
  createSupervisorApiKeyClient,
  loginAsSuperAdmin,
} from "./supervisorApiHelper.js";

vi.setConfig({ testTimeout: 150000 });

interface SuccessResponse {
  success: boolean;
  message: string;
}

interface CreateUserResponse extends SuccessResponse {
  id: number;
  username: string;
  registrationUrl: string;
  registrationExpiresAt: string;
}

describe("Supervisor Admin E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  const HOSTNAME = "TEST-SUPERVISOR-ADMIN";
  let SERVER_PORT: number;
  let API_BASE: string;

  beforeEach(async () => {
    testDir = getTestDir("supervisor_admin");
    setupTestDir(testDir);
    SERVER_PORT = await getFreePort();
    API_BASE = `http://localhost:${SERVER_PORT}/supervisor/api`;
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    await sleep(500);
    cleanupTestDir(testDir);
  });

  function createIntegratedEnvFile(dir: string) {
    const envContent = `
NAISYS_FOLDER="${dir}"
NAISYS_HOSTNAME="${HOSTNAME}"
SPEND_LIMIT_DOLLARS=10
SERVER_PORT=${SERVER_PORT}
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
  }

  test("should manage users, models, variables, configs, agents, and hosts via the supervisor API", async () => {
    createIntegratedEnvFile(testDir);
    createAgentYaml(testDir, "operatorbot.yaml", {
      username: "operatorbot",
      title: "Admin Workflow Operator",
      mailEnabled: true,
      chatEnabled: true,
    });
    createAgentYaml(testDir, "peerbot.yaml", {
      username: "peerbot",
      title: "Admin Workflow Peer",
      mailEnabled: true,
      chatEnabled: true,
    });

    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", testDir],
      env: { NODE_ENV: "production", NAISYS_FOLDER: testDir },
    });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    const admin = await loginAsSuperAdmin(naisys, API_BASE);

    // ---- Step 2: create a limited user (no permissions) ----
    const limitedUsername = "limitedbot";
    const created = await admin.post<CreateUserResponse>("/users", {
      username: limitedUsername,
    });
    expect(created.success).toBe(true);
    expect(created.username).toBe(limitedUsername);
    expect(created.registrationUrl).toContain("/supervisor/register?token=");

    const limitedDetail = await admin.get<UserDetailResponse>(
      `/users/${limitedUsername}`,
    );
    expect(limitedDetail.apiKey).toEqual(expect.any(String));
    const limited = createSupervisorApiKeyClient(
      API_BASE,
      limitedDetail.apiKey!,
    );

    // ---- Step 2 cont.: privileged action without permission must 403 ----
    await expect(
      limited.put<SuccessResponse>("/variables/ADMIN_E2E_VAR", {
        value: "v1",
        exportToShell: false,
        sensitive: false,
      }),
    ).rejects.toThrow(/403/);

    // ---- Step 3: grant manage_variables and retry ----
    const grant = await admin.post<SuccessResponse>(
      `/users/${limitedUsername}/permissions`,
      { permission: "manage_variables" },
    );
    expect(grant.success).toBe(true);

    const savedByLimited = await limited.put<SuccessResponse>(
      "/variables/ADMIN_E2E_VAR",
      { value: "v1", exportToShell: false, sensitive: false },
    );
    expect(savedByLimited.success).toBe(true);

    // ---- Step 4: custom LLM model save + list ----
    const customModelKey = "admin-e2e-mock-llm";
    const savedModel = await admin.put<SuccessResponse>("/models/llm", {
      model: {
        key: customModelKey,
        label: "Admin E2E Mock LLM",
        versionName: "test-1",
        apiType: "mock",
        maxTokens: 1024,
        apiKeyVar: "ADMIN_E2E_MODEL_KEY",
        inputCost: 0,
        outputCost: 0,
      },
    });
    expect(savedModel.success).toBe(true);

    const models = await admin.get<ModelsResponse>("/models");
    expect(
      models.llmModelDetails.some(
        (m) => m.key === customModelKey && m.isCustom,
      ),
    ).toBe(true);

    // ---- Step 5: save another variable as admin (sensitive, masked for non-managers) ----
    const adminVarSaved = await admin.put<SuccessResponse>(
      "/variables/ADMIN_E2E_SECRET",
      { value: "topsecret", exportToShell: true, sensitive: true },
    );
    expect(adminVarSaved.success).toBe(true);

    // ---- Step 6: export → edit → import agent config; assert revisions ----
    const exported = await admin.get<ExportAgentConfigResponse>(
      "/agents/operatorbot/config/export",
    );
    expect(exported.yaml).toContain("username: operatorbot");

    const editedYaml = exported.yaml.replace(/tokenMax:\s*\d+/, "tokenMax: 60000");
    expect(editedYaml).toContain("tokenMax: 60000");

    const imported = await admin.post<ImportAgentConfigResponse>(
      "/agents/operatorbot/config/import",
      { yaml: editedYaml },
    );
    expect(imported.success).toBe(true);
    expect(imported.config?.tokenMax).toBe(60000);

    // PUT /config — change tokenMax once more so we have at least two revisions
    const updatedConfig = { ...imported.config!, tokenMax: 70000 };
    const updated = await admin.put<UpdateAgentConfigResponse>(
      "/agents/operatorbot/config",
      { config: updatedConfig as unknown as Record<string, unknown> },
    );
    expect(updated.success).toBe(true);

    const revisions = await admin.get<ConfigRevisionListResponse>(
      "/agents/operatorbot/config/revisions",
    );
    expect(revisions.items.length).toBeGreaterThanOrEqual(2);

    // ---- Step 7: set then clear peerbot's lead agent ----
    const setLead = await admin.put<SuccessResponse>("/agents/peerbot/lead", {
      leadAgentUsername: "operatorbot",
    });
    expect(setLead.success).toBe(true);

    const peerWithLead = await admin.get<AgentDetailResponse>(
      "/agents/peerbot",
    );
    expect(peerWithLead.leadUsername).toBe("operatorbot");

    const clearLead = await admin.put<SuccessResponse>("/agents/peerbot/lead", {
      leadAgentUsername: null,
    });
    expect(clearLead.success).toBe(true);

    // ---- Step 8: disable → enable → archive → unarchive → reset-spend on peerbot ----
    const disabled = await admin.post<SuccessResponse>(
      "/agents/peerbot/disable",
      {},
    );
    expect(disabled.success).toBe(true);
    const peerDisabled = await admin.get<AgentDetailResponse>(
      "/agents/peerbot",
    );
    expect(peerDisabled.enabled).toBe(false);

    const enabled = await admin.post<SuccessResponse>(
      "/agents/peerbot/enable",
      {},
    );
    expect(enabled.success).toBe(true);
    const peerEnabled = await admin.get<AgentDetailResponse>(
      "/agents/peerbot",
    );
    expect(peerEnabled.enabled).toBe(true);

    const archived = await admin.post<SuccessResponse>(
      "/agents/peerbot/archive",
    );
    expect(archived.success).toBe(true);
    const peerArchived = await admin.get<AgentDetailResponse>(
      "/agents/peerbot",
    );
    expect(peerArchived.archived).toBe(true);

    const unarchived = await admin.post<SuccessResponse>(
      "/agents/peerbot/unarchive",
    );
    expect(unarchived.success).toBe(true);
    const peerUnarchived = await admin.get<AgentDetailResponse>(
      "/agents/peerbot",
    );
    expect(peerUnarchived.archived).toBe(false);

    const resetSpend = await admin.post<SuccessResponse>(
      "/agents/peerbot/reset-spend",
    );
    expect(resetSpend.success).toBe(true);

    // ---- Step 9: create host, restrict, assign agent, unassign, delete ----
    const TEST_HOST = "ADMIN-E2E-HOST";
    const hostCreated = await admin.post<SuccessResponse & { id: number }>(
      "/hosts",
      { name: TEST_HOST },
    );
    expect(hostCreated.success).toBe(true);

    const restricted = await admin.put<SuccessResponse>(
      `/hosts/${TEST_HOST}`,
      { restricted: true },
    );
    expect(restricted.success).toBe(true);

    const hostDetail = await admin.get<HostDetailResponse>(
      `/hosts/${TEST_HOST}`,
    );
    expect(hostDetail.restricted).toBe(true);
    expect(hostDetail.online).toBe(false);

    const agents = await admin.get<AgentListResponse>("/agents");
    const peer = agents.items.find((a) => a.name === "peerbot");
    expect(peer).toBeDefined();

    const assigned = await admin.post<SuccessResponse>(
      `/hosts/${TEST_HOST}/agents`,
      { agentId: peer!.id },
    );
    expect(assigned.success).toBe(true);

    const hostWithAgent = await admin.get<HostDetailResponse>(
      `/hosts/${TEST_HOST}`,
    );
    expect(hostWithAgent.assignedAgents.some((a) => a.name === "peerbot")).toBe(
      true,
    );

    const unassigned = await admin.del<SuccessResponse>(
      `/hosts/${TEST_HOST}/agents/peerbot`,
    );
    expect(unassigned.success).toBe(true);

    const hostDeleted = await admin.del<SuccessResponse>(`/hosts/${TEST_HOST}`);
    expect(hostDeleted.success).toBe(true);

    // ---- Step 10: cleanup model, variables, permission, user ----
    const modelDeleted = await admin.del<SuccessResponse>(
      `/models/llm/${customModelKey}`,
    );
    expect(modelDeleted.success).toBe(true);

    const var1Deleted = await admin.del<SuccessResponse>(
      "/variables/ADMIN_E2E_VAR",
    );
    expect(var1Deleted.success).toBe(true);

    const var2Deleted = await admin.del<SuccessResponse>(
      "/variables/ADMIN_E2E_SECRET",
    );
    expect(var2Deleted.success).toBe(true);

    const revoked = await admin.del<SuccessResponse>(
      `/users/${limitedUsername}/permissions/manage_variables`,
    );
    expect(revoked.success).toBe(true);

    const userDeleted = await admin.del<SuccessResponse>(
      `/users/${limitedUsername}`,
    );
    expect(userDeleted.success).toBe(true);
  });
});
