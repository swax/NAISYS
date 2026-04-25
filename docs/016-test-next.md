# Coverage-Driven E2E Test Plan

[<- Back to main README](../README.md)

This is a prioritized list of cross-cutting E2E workflows to move
`COVERAGE.md`, not a full test inventory. The current baseline is:

| Workspace                | Statement Coverage |
| ------------------------ | -----------------: |
| `apps/naisys`            |             46.37% |
| `apps/erp/server`        |             70.37% |
| `apps/supervisor/server` |             63.24% |
| `apps/hub`               |             71.09% |
| `packages/common-node`   |             53.05% |

The highest return tests should hit more than one of those workspaces in a
single realistic workflow. Browser client code is not measured by the current
coverage setup, so UI tests only help `COVERAGE.md` when they drive server-side
routes and Node services.

## Selection Rules

Prefer tests that:

- boot real processes with `NODE_V8_COVERAGE` inherited
- cross hub, NAISYS, supervisor, and ERP boundaries
- assert persisted state through a second API or CLI surface
- use happy-path workflows first, with one or two high-value failure branches
- exercise upload/download, auth, permissions, and lifecycle transitions

Defer tests that:

- only click client UI without hitting new server routes
- duplicate an existing order lifecycle with different labels
- require live LLM providers
- require fragile timing unless the workflow is core product behavior

## 1. Multi-Host Agent Placement and Failover

**Priority: high**

**Why it should move coverage**

Host registration, assignment, least-loaded routing, status broadcasts, and
disconnect handling are central to the hub/supervisor/NAISYS boundary. Existing
mail tests prove cross-hub communication, but they do not fully exercise host
management from the supervisor perspective.

**Workflow**

1. Start a standalone hub.
2. Start a supervisor connected to that hub.
3. Start two NAISYS clients with distinct `NAISYS_HOSTNAME` values.
4. Seed three agents.
5. Use supervisor host APIs to inspect both hosts.
6. Restrict one host.
7. Assign one agent to the restricted host.
8. Start agents and assert placement:
   - assigned agent starts on the assigned host
   - unassigned agent starts on an available unrestricted host
9. Stop one NAISYS client.
10. Assert supervisor marks the host offline.
11. Attempt an action that should fail or route elsewhere.
12. Restart the client and assert status recovers.

**Coverage targets**

- `apps/hub/src/services/hostRegistrar.ts`
- `apps/hub/src/services/naisysServer.ts`
- `apps/hub/src/handlers/hubHostService.ts`
- `apps/hub/src/handlers/hubAgentService.ts`
- `apps/naisys/src/hub/hubClient.ts`
- `apps/naisys/src/services/hostService.ts`
- `apps/naisys/src/services/heartbeatService.ts`
- `apps/supervisor/server/src/services/agentHostStatusService.ts`
- `apps/supervisor/server/src/routes/hosts.ts`
- `apps/supervisor/server/src/routes/agentLifecycle.ts`

**Best home**

`apps/naisys/src/__tests__/e2e/multi-host-placement.e2e.test.ts`

This will need careful ports and cleanup. Keep it API-first and avoid UI.

## 2. ERP Execution With Attachments, Comments, Labor, and Audit

**Priority: high**

**Why it should move coverage**

The new master-data-to-dispatch flow is a strong server-coverage test. The next
ERP test should not repeat simple order lifecycle. It should exercise the
runtime side around step fields, attachments, comments, labor tickets, and audit
history.

**Workflow**

1. Login as ERP test user.
2. Create item, item field, work center, order, revision, operation, step, and
   required step field.
3. Add an operation dependency.
4. Add an operation field reference.
5. Approve the revision.
6. Cut and start an order run.
7. Start the operation run.
8. Fill a step-run field value.
9. Upload an attachment to that step-run field.
10. Add an operation-run comment.
11. Create a labor ticket against the operation run.
12. Complete the step and operation.
13. Complete the order run into an item instance.
14. Fetch audit entries and assert the workflow produced expected events.
15. Fetch inventory or item instance views and assert the produced instance.

**Coverage targets**

- `apps/erp/server/src/routes/step-run-fields.ts`
- `apps/erp/server/src/routes/step-field-attachments.ts`
- `apps/erp/server/src/routes/operation-run-comments.ts`
- `apps/erp/server/src/routes/labor-tickets.ts`
- `apps/erp/server/src/routes/audit.ts`
- `apps/erp/server/src/routes/inventory.ts`
- `apps/erp/server/src/services/field-value-service.ts`
- `apps/erp/server/src/services/attachment-service.ts`
- `apps/erp/server/src/services/operation-run-comment-service.ts`
- `apps/erp/server/src/services/labor-ticket-service.ts`
- `apps/erp/server/src/audit.ts`

**Best home**

`apps/erp/server/e2e/api/runtime-audit-api.spec.ts`

Use API for setup and assertions. Use Playwright UI only if the UI itself is the
behavior under test, because browser-side client coverage is not currently
counted.

## 3. ERP Revision Diff and Dependency Workflow

**Priority: medium-high**

**Why it should move coverage**

Revision diffing, operation dependencies, field refs, and transition edge cases
are domain-heavy server code. They are good candidates for API E2E because the
business rules matter more than the UI.

**Workflow**

1. Create an order with revision 1.
2. Add multiple operations, steps, fields, dependencies, and field refs.
3. Approve revision 1.
4. Create revision 2 from revision 1.
5. Change operation sequence, step text, field requirements, dependencies, and
   refs.
6. Fetch revision diff and assert added, changed, and removed sections.
7. Reject or revert one revision transition if the API supports it.
8. Approve revision 2.
9. Cut a run from revision 2 and assert the copied runtime structure matches
   revision 2.

**Coverage targets**

- `apps/erp/server/src/services/revision-diff-service.ts`
- `apps/erp/server/src/routes/operation-dependencies.ts`
- `apps/erp/server/src/routes/operation-field-refs.ts`
- `apps/erp/server/src/routes/order-revision-transitions.ts`
- `apps/erp/server/src/services/operation-dependency-service.ts`
- `apps/erp/server/src/services/field-ref-service.ts`
- `apps/erp/server/src/services/order-revision-service.ts`
- `apps/erp/server/src/services/step-service.ts`
- `apps/erp/server/src/services/operation-service.ts`

**Best home**

`apps/erp/server/e2e/api/revision-diff-dependencies-api.spec.ts`

## 4. NAISYS CLI Session and Workspace Workflow

**Priority: medium-high**

**Why it should move coverage**

`apps/naisys` is the lowest workspace by percentage and largest uncovered
denominator. A CLI E2E that avoids live LLM calls can still exercise command
registry, command handler, shell execution, session commands, workspace
commands, config commands, and agent switching.

**Workflow**

1. Start NAISYS in standalone mode with two local agents and `shellModel: none`.
2. Run `ns-help`.
3. Run `ns-config` reads and safe updates.
4. Run workspace commands:
   - add a file
   - list workspace files
   - remove a file
5. Run session commands that do not require live compaction.
6. Start and switch agents.
7. Send mail and chat locally or through integrated hub mode.
8. Run a shell command that produces modest output.
9. Run a command that fails and assert the handled error text.
10. End with clean shutdown.

**Coverage targets**

- `apps/naisys/src/command/commandRegistry.ts`
- `apps/naisys/src/command/commandHandler.ts`
- `apps/naisys/src/command/shellCommand.ts`
- `apps/naisys/src/command/shellWrapper.ts`
- `apps/naisys/src/features/session.ts`
- `apps/naisys/src/features/workspaces.ts`
- `apps/naisys/src/agent/agentConfig.ts`
- `apps/naisys/src/agent/agentManager.ts`
- `apps/naisys/src/services/pathService.ts`
- `apps/naisys/src/services/logService.ts`

**Best home**

`apps/naisys/src/__tests__/e2e/cli-session-workspace.e2e.test.ts`

Before writing this, add helpers to `e2eTestHelper.ts` like `runCommand`,
`startAgent`, `switchAgent`, and `expectPrompt`. That will reduce flake and make
future CLI E2Es cheaper.

## 5. Supervisor Auth to ERP Auth Bridge

**Priority: medium**

**Why it should move coverage**

ERP server coverage is already much better, but supervisor-auth integration is a
cross-product boundary and likely under-tested. This also hits supervisor users
and permissions in a realistic way.

**Workflow**

1. Boot integrated supervisor + ERP with supervisor auth enabled.
2. Login as `superadmin`.
3. Create an ERP user through supervisor or shared auth setup.
4. Grant only read permissions.
5. Login to ERP and assert read endpoint succeeds.
6. Attempt a write endpoint and assert forbidden.
7. Grant write permission.
8. Retry the same write endpoint and assert success.
9. Revoke permission and assert access changes on the next request.

**Coverage targets**

- `apps/erp/server/src/supervisorAuth.ts`
- `apps/erp/server/src/auth-middleware.ts`
- `apps/erp/server/src/routes/auth.ts`
- `apps/erp/server/src/routes/users.ts`
- `apps/erp/server/src/routes/user-permissions.ts`
- `apps/supervisor/server/src/routes/users.ts`
- `apps/supervisor/server/src/auth-middleware.ts`
- `packages/supervisor-database`

**Best home**

Either:

- `apps/naisys/src/__tests__/e2e/supervisor-erp-auth.e2e.test.ts`
- or `apps/erp/server/e2e/api/supervisor-auth-api.spec.ts`

Prefer the NAISYS integrated-process test if the goal is cross-workspace
coverage.

## 6. Models and Variables Propagation

**Priority: medium**

**Why it should move coverage**

Models and variables touch supervisor routes, hub broadcasts, NAISYS model
service, and config resolution. It is a good cross-cutting API workflow with
low UI risk.

**Workflow**

1. Boot integrated hub + supervisor + NAISYS client.
2. Login as `superadmin`.
3. Save a model through supervisor API.
4. Save variables through supervisor API.
5. Assert hub broadcasts are received by the NAISYS process.
6. Start an agent whose config references the variable.
7. Run `ns-config` or a shell command that proves the resolved value is present.
8. Delete the model and variable.
9. Assert list endpoints reflect deletion.

**Coverage targets**

- `apps/supervisor/server/src/routes/models.ts`
- `apps/supervisor/server/src/routes/variables.ts`
- `apps/supervisor/server/src/services/modelService.ts`
- `apps/supervisor/server/src/services/variableService.ts`
- `apps/hub/src/handlers/hubModelsService.ts`
- `apps/hub/src/handlers/hubConfigService.ts`
- `apps/naisys/src/services/modelService.ts`
- `apps/naisys/src/globalConfig.ts`
- `packages/common-node`

**Best home**

`apps/naisys/src/__tests__/e2e/models-variables-propagation.e2e.test.ts`

## 7. Hub Access Key Rotation and Reconnect

**Priority: medium**

**Why it should move coverage**

This is narrower, but it targets hub security and reconnect behavior that is
important and hard to cover with pure unit tests.

**Workflow**

1. Start hub + supervisor + one NAISYS client.
2. Assert client is connected.
3. Rotate the hub access key through supervisor/admin or hub route.
4. Assert old key no longer authenticates for a new client.
5. Update the client env/key file.
6. Restart or reconnect the client.
7. Assert host and agent status recover.

**Coverage targets**

- `apps/hub/src/handlers/hubAccessKeyService.ts`
- `apps/hub/src/services/accessKeyService.ts`
- `apps/hub/src/services/naisysServer.ts`
- `apps/naisys/src/hub/hubConnection.ts`
- `apps/naisys/src/hub/hubClientConfig.ts`
- `apps/supervisor/server/src/services/hubConnectionService.ts`
- `packages/common-node`

**Best home**

`apps/naisys/src/__tests__/e2e/hub-access-key-rotation.e2e.test.ts`

## Suggested Order

1. **ERP Execution With Attachments, Comments, Labor, and Audit**
   - Good next ERP server jump without duplicating order lifecycle.
2. **Multi-Host Agent Placement and Failover**
   - More complex, but probably the most valuable distributed-system test.
3. **NAISYS CLI Session and Workspace Workflow**
   - Directly attacks the lowest coverage workspace.

## Measuring Each Addition

For each new workflow:

1. Run the focused test once.
2. Run `npm run coverage:full`.
3. Inspect `git diff COVERAGE.md`.
4. Keep the test if it either:
   - moves at least one low-coverage workspace meaningfully, or
   - finds a real bug in a core workflow.
5. If `COVERAGE.md` does not move, check whether the exercised process is
   missing `NODE_V8_COVERAGE` or exiting without a graceful flush.

## Practical Guardrails

- Keep Playwright UI tests for user-visible workflow confidence.
- Prefer API E2E for coverage movement when the UI is not the subject.
- Do not add live LLM-provider E2Es for coverage. Use `shellModel: none`, mock
  providers, or command-only workflows.
- Avoid tests that depend on exact prompt formatting unless prompt formatting is
  the behavior under test.
- Use unique ports and unique temp folders per E2E file.
- Add helper methods before the second copy-paste appears.
- Always assert through a second boundary: if the workflow writes through CLI,
  verify through API or database-facing route; if it writes through API, verify
  through CLI or another read model.
