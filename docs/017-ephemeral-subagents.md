# Ephemeral Subagents

A running agent can spawn a short-lived helper — a _subagent_ — to do a focused task (research, summarization, parallel search) and tear it down when the task completes. Subagents live entirely in the parent runner's memory: they aren't registered with the hub as distinct users, don't show up in cluster heartbeats as separate hub users, and disappear when they terminate. To the hub they look like extra activity from the parent, distinguished only by a `subagentId` field on logs, costs, and session rows.

This doc is the design reference for the feature, exposed as `ns-agent create "<title>" "<task>"`.

## Why this shape

A previous version (removed in commit `d88375e2`) wrote a yaml file per subagent and spawned each as a separate Node process. Both were dropped: subagents now live as in-memory `UserEntry` rows in the local `userService` and run inside the parent's `AgentManager` like any other agent. Disk and process isolation were carrying weight no real use case asked for — the whole point of a subagent is to be cheap and short-lived.

The other major design choice — that subagents _don't_ exist as hub users — falls out of the same instinct. If the helper lives for 30 seconds and exists only to feed its parent some text, it shouldn't inflate the global user table, the hub heartbeat, or any cluster-visible state. But it _should_ still write logs and costs to the hub so the supervisor can render what the family did. So subagents are local in identity but visible in activity, with everything they emit re-stamped to ride under the parent's `userId` and `runId`.

## Identity

Each subagent gets a host-unique synthetic `userId` from a negative counter (`-1`, `-2`, …). Negative ids never collide with hub-assigned positive ids, and the same number doubles as the entry's `subagentId` on the wire — there is no separate "subagent index."

Run identity grows from a triple to a quad:

| Source     | userId   | runId    | subagentId        | sessionId   |
| ---------- | -------- | -------- | ----------------- | ----------- |
| Main agent | own      | own      | `null` (hub: `0`) | own         |
| Subagent A | parent's | parent's | `-1`              | A's, from 1 |
| Subagent B | parent's | parent's | `-2`              | B's, from 1 |

The parent's `runId` is **frozen** at the moment the subagent spawns: even if the parent later compacts and increments its own session counter, the subagent keeps writing under the original runId. Each subagent has its own session counter starting at 1, incrementing only on its own compaction.

On the wire `subagentId` is optional/nullable so older clients stay compatible. On the hub, `null` and absent both normalize to sentinel `0` — SQLite's NULL-in-PK semantics are inconsistent and Postgres rejects them outright. Negative ids never collide with `0`.

## Local identity, hub-visible activity

The synthetic id is added to the local `userService.userMap` so name resolution and mail routing work, but it is **never** sent to the hub as a user (`USERS_UPDATED`) and never counted as a distinct hub user in heartbeats. Logs, costs, and session rows for the subagent still reach the hub — re-stamped under the parent's `userId` and `runId` with `subagentId` set. That's enough for the supervisor to render the subagent as a nested row under its parent.

Each subagent's `AgentRuntime` is constructed with `hubClient = undefined`, so every hub-aware service inside takes its local-mode branch. Two narrow exceptions keep the hub view coherent:

- **Run sessions** — the subagent's `RunService` keeps a reference to the parent's hub client so it can fire `SESSION_CREATE` (and later `SESSION_INCREMENT` on compaction) before logs or costs reference the new row.
- **Log and cost buffers** — replaced with thin wrappers that re-stamp every outgoing entry with `(parentUserId, parentRunId, subagentId)` and forward to the host's real buffer.

Heartbeats carry every active session — the runner stamps each subagent's session entry with `userId = parent's leadUserId` and `subagentId = synthetic id`, so a parent and its subagents appear as sibling entries that share a `userId` but differ on `subagentId`. The hub deduplicates `activeUserIds` from the heartbeat's `userId` field, so the family collapses to one hub-user entry; per-row `last_active` updates use the full `(user_id, run_id, subagent_id, session_id)` key so each subagent's online/paused state stays observable.

## Cost control inherits from the parent

A subagent shares its parent's wallet — there is no separate budget. Limits are seeded from the parent at spawn (only `spendLimitHours`; `spendLimitDollars` is intentionally not copied so there's no redundant check). The subagent's `costTracker` delegates `checkSpendLimit` and `getBudgetLeft` to the parent's tracker, and after recording its own per-model breakdown it calls `parentCostTracker.addSubagentCost()` so the parent's totals (and the standalone-mode local-period check) include subagent spend.

When the hub fires a `COST_CONTROL` resume on the parent, the parent broadcasts the same wake notification to every subscribed subagent. Suspends just update the parent's reason — subagents observe it the next time they call `checkSpendLimit`.

## Communication

Mail and chat between parent and subagent use the in-memory `promptNotification.notify` path, never the hub. `mail.sendMessage` and `chat.sendMessage` split recipients by `isEphemeral`: ephemerals always go local, even when the parent is hub-connected. Outbound from a subagent naturally takes the local path because its `hubClient` is `undefined`.

The auto-start-on-message path explicitly skips ephemerals — they only start via `ns-agent create`, never by an incoming mail.

## Lifecycle

`ns-agent create` allocates a synthetic id, picks an unused name from `agentNames`, builds a minimal `AgentConfigFile` from the parent's running config (model, token cap, command settings, `spendLimitHours`), starts the subagent in the parent's `AgentManager`, and delivers the task description as the startup mail.

Nesting is rejected. A sub-subagent's logs would be stamped with the parent subagent's negative userId, which has no row in the hub `users` table and would fail the `run_session` FK. Only one level of subagents is allowed.

On any termination (task complete, manual stop, parent shutdown, crash), `handleAgentTermination` removes the entry from `userService` and from the parent's `mySubagentsMap`. The username slot is reusable.

When the parent's runtime shuts down, `subagentService.cleanup()` runs from `AgentManager.cleanupAgent()` — _before_ the parent's own `completeShutdown` — so children are signalled even if the parent's teardown later throws.

## Soft isolation

The user requested "minimal ability to interact or be known to anyone but the agent that started it." The implementation chose soft isolation rather than a hard refactor:

- `subagent list` and `mySubagentsMap` filter by `leadUserId === localUserId`, so siblings don't see each other's ephemerals.
- `ns-users` calls `userService.getVisibleUsers(perspectiveUserId)`, which drops ephemerals that aren't owned by — or aren't — the perspective user. Foreign ephemerals don't surface as a `(+N not shown)` rollup either.
- `userService.getUserByName()` is unchanged, so a sibling who guesses an ephemeral's username could still reach it via mail. The address space is small but not strictly partitioned.

Hard isolation would mean threading a `requesterUserId` parameter through every `userService` lookup. It was deferred — the leak is small and the refactor is wide.

## Hub schema additions

DB version 40 (migration `20260428000000_add_subagent_id`) adds a `subagent_id INTEGER NOT NULL DEFAULT 0` column to `context_log`, `costs`, and `run_session`; promotes `run_session`'s primary key to `(user_id, run_id, subagent_id, session_id)`; and updates the composite FKs and indexes accordingly. The migration backfills `subagent_id = 0` so existing rows continue to surface as main-agent activity.

The supervisor's `runsService.getRunsData` returns parent and subagent rows together, ordered so each parent run's sessions and subagents are contiguous (newest run first; within a run, parent `subagent_id = 0` before subagents `-1, -2, …`). That ordering is what lets the sidebar render subagent rows nested under their parent without a recursive query.

## Files of interest

| Area                                                | File                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Synthetic id + ephemeral user APIs                  | `apps/naisys/src/agent/userService.ts`                                                                 |
| `SubagentContext`, manager wiring, runtime wrappers | `apps/naisys/src/agent/agentManager.ts`, `agentRuntime.ts`, `agentManagerInterface.ts`                 |
| Frozen-runId + session create/increment             | `apps/naisys/src/services/runService.ts`                                                               |
| `ns-agent create` + cleanup + visibility filter     | `apps/naisys/src/features/subagent.ts`                                                                 |
| Ephemeral mail/chat routing                         | `apps/naisys/src/mail/mail.ts`, `apps/naisys/src/mail/chat.ts`                                         |
| Heartbeat ephemeral re-stamping                     | `apps/naisys/src/services/heartbeatService.ts`                                                         |
| Hub protocol `subagentId` field                     | `packages/hub-protocol/src/schemas/{logs,costs}.ts`                                                    |
| Hub DB schema + migration                           | `packages/hub-database/prisma/schema.prisma`, `…/migrations/20260428000000_add_subagent_id/`           |
| Hub log/cost/heartbeat scoping                      | `apps/hub/src/handlers/{hubLogService,hubCostService,hubHeartbeatService}.ts`                          |
| Supervisor nested rendering                         | `apps/supervisor/server/src/services/runsService.ts`, `apps/supervisor/server/src/routes/agentRuns.ts` |

## Open items

- **`AGENT_PEEK` for subagents.** Pause/resume/command already accept an optional `subagentId`; peek does not yet. The runner's routing already keys `agentManager.runningAgents` by synthetic userId, so only the protocol schema and hub-side dispatch need to change.
- **Hard isolation.** `userService.getUserByName` still resolves any ephemeral by exact name. Strict partitioning would mean a perspective parameter on every lookup — deferred.
- **Crash-time cleanup.** If the parent crashes (vs. shutting down cleanly), `completeShutdown` may not run, leaving ephemerals in `agentManager.runningAgents`. A more aggressive sweep tied to `cleanupAgent` would handle hard exits.
