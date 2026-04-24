# Auto-Start Agents on Pending Mail

## Overview

This document is the reference for the "auto-start agents on pending mail" feature. It describes the as-built system and — where useful — the original design intent so the document can stand as an explanation of why the implementation looks the way it does.

The goal was to simplify agent lifecycle management: instead of requiring an explicit `ns-agent start <username> "<task>"` from a lead agent, any unread mail addressed to an idle agent is enough to wake that agent up. Agents no longer have to be "spawned" — they're just mailed.

## Architecture Summary

Two running modes share a common policy but implement it differently:

- **Hub mode** (multi-host): The hub owns auto-start. `hubMailService` polls every 10 seconds (plus reacts to `MAIL_SEND` and `CLIENT_CONNECTED`) for users with unread mail who are not currently active, picks the least-loaded eligible host, and sends an `AGENT_START` event to that host.
- **Standalone mode** (single process, no hub): Auto-start is triggered inline from `MailService.sendMessage()` — after writing the mail to the in-process event bus, any inactive recipient has `AgentManager.startAgent()` called.

In both modes, the same global flag gates the behavior (`globalConfig.autoStartAgentsOnMessage`, currently hardcoded to `true` in `packages/common/src/globalConfigLoader.ts`).

Agents shut themselves down via `ns-session complete "<result>"`, which mails the result to the agent's lead (or admin as fallback) and exits the process.

---

## Components

### Hub-side auto-start loop

`apps/hub/src/handlers/hubMailService.ts`

- `MAIL_AUTOSTART_CHECK_INTERVAL_MS = 10_000` — polling interval.
- `checkPendingAutoStarts()`:
  1. Short-circuits if `autoStartAgentsOnMessage` is disabled in config.
  2. Queries `mail_recipients` for distinct `user_id`s with `read_at = null` where the user is `enabled` and not `archived`, skipping `type = "from"` rows (senders pre-mark those read).
  3. Filters to users not in `heartbeatService.getActiveUserIds()`.
  4. Runs `costService.checkSpendLimits()` on the candidates so suspension decisions are up to date.
  5. For each remaining candidate, skips if spend-suspended, then calls `agentService.tryStartAgent(userId)`.
- Triggers for the loop:
  - `setInterval` every 10s.
  - `MAIL_SEND` event — immediately after accepting mail.
  - `CLIENT_CONNECTED` event — when a naisys host comes online, sweep for pending mail addressed to agents assigned to it.

`apps/hub/src/handlers/hubAgentService.ts`

- `findBestHost(startUserId)`:
  - If the user has entries in `user_hosts`, restrict eligible hosts to those.
  - Otherwise, eligible = all currently-connected non-restricted hosts.
  - Pick the host with the fewest active agents (`heartbeatService.getHostActiveAgentCount`).
- `tryStartAgent(startUserId)`:
  - Verifies the user is enabled/not archived.
  - Finds a best host; bails if none available.
  - Sends `AGENT_START` to that host. On successful ack, marks the agent as started in the heartbeat service so subsequent polls won't re-pick it.

The `AGENT_START` hub event is dual-purpose: auto-start (hub-originated, no `requesterUserId`) and manual start via `ns-agent start` (runner-originated, carries `requesterUserId` and `taskDescription`). In the manual case the hub routes to the chosen host and, after the host acks success, sends a "Agent Start" mail from the requester to the target so the start is visible in the mail thread. The mail is only sent after a successful start to avoid orphan mails from failed attempts.

### Standalone (non-hub) auto-start

`apps/naisys/src/mail/mail.ts` — `sendMessage()`:

After emitting the new-message notification to recipients, it walks the recipient list and calls `agentManager.startAgent(recipient.userId)` for any recipient that is not the sender and not currently in `agentManager.runningAgents`. No cross-host routing is required.

### Runner-side agent handlers

`apps/naisys/src/agent/agentManager.ts` registers these hub event handlers when `hubClient` is present:

- `AGENT_START` — calls `startAgent(userId)`; acks with `{ success, hostname }`. If the start was triggered by another host (i.e. `sourceHostId !== localHostId`), also surfaces a debug notification on the admin user so someone watching in debug mode sees the event.
- `AGENT_STOP` — calls `stopAgent(userId, reason)`; acks `{ success }`. Same cross-host notification as above.
- `AGENT_RUN_PAUSE` / `AGENT_RUN_RESUME` — pause/resume an agent's active run/session. Rejects if the run/session has advanced since the request was issued. On a successful state change, triggers an immediate heartbeat so the supervisor UI updates within roundtrip latency.
- `AGENT_RUN_COMMAND` — inject a debug command into a running session via `promptNotification`.
- `AGENT_PEEK` — return a slice of the agent's output buffer (`getBufferLines`), stripped of ANSI.

There is no dedicated `remoteAgentRouter.ts` / `remoteAgentHandler.ts` file. The design originally called for separate router modules, but the handlers ended up inline in the existing `hubAgentService` (hub side) and `AgentManager` (runner side) where the context was already available.

### `ns-agent` command

`apps/naisys/src/features/subagent.ts`. Subcommands:

| Subcommand | Usage | Notes |
| --- | --- | --- |
| `help` | `help` | Lists subcommands. Shows debug-only commands when in debug mode. |
| `list` | `list` | Lists the caller's subagents (filtered by `leadUserId === localUserId`) with per-agent running state. |
| `start` | `start <name> "<task>"` | Local or remote start. In hub mode routes through `AGENT_START`. Requires target to be a direct subordinate (bypassed in debug mode). |
| `stop` | `stop [-r] <name>` | Stops one agent, or with `-r` also stops all running subordinates recursively. Same subordinate-only permission check (bypassed in debug mode). |
| `peek` | `peek <name> [skip] [take]` | Shows buffered output of a running agent. Remote-capable via `AGENT_PEEK`. Same subordinate-only permission check. |
| `local` | `!local` | Debug-only. Lists agents running in this process. |
| `switch` | `!switch <name>` | Debug-only. Switches the console focus to a locally-running agent. |

Notes vs. the original plan:

- The plan proposed removing `ns-agent list`. It was kept: `ns-users` shows the whole organization hierarchy, but `ns-agent list` remains as a quick "just my subordinates" view.
- The plan proposed an `ns-agent log` subcommand. Output buffers are exposed via `ns-agent peek` instead; the request type is `AGENT_PEEK` rather than a separate `AGENT_LOG`.
- The plan proposed `<username@host>` disambiguation. In practice, usernames are globally unique across the cluster (enforced by the hub user table) so bare `<username>` is always sufficient — no host suffix is needed.
- `ns-agent stop` supports `-r` for recursive stops of all running subordinates; not in the original plan.

Permissions are checked in `subagent.ts`:

- `start` — target must be a subordinate (via `isSubordinate()` walking `leadUserId`). Debug mode bypasses the check.
- `stop` — same subordinate-only check. Debug mode bypasses.
- `peek` — same subordinate-only check. (The original plan had no permission check on logs; in the implementation peek is treated the same as stop to keep debug output scoped.)

### `ns-users` command

`apps/naisys/src/agent/userDisplayService.ts`. Command definition: `usersCmd` in `commandDefs.ts` (kept as its own top-level command, not folded into `ns-mail users`).

Output is a tree indented by depth. Columns: `Username`, `Title`, `Lead`, `Status`, and in debug mode an additional `*Host` column showing assigned host display names.

Perspective:

- Default is the calling user.
- `ns-users <username>` re-roots the view on another user.
- The view filters to "relevant" users only: root-level users, the perspective user's ancestor chain, all peers at each level of that chain, and all descendants. Users in hidden branches are replaced with a `(+N not shown)` marker under the visible parent so the caller knows they exist without flooding the output.

Status is computed by `determineAgentStatus()` in `packages/common/src/agentStatus.ts`, which returns one of `active | available | disabled | offline | suspended` with priority `disabled > offline > suspended > active > available`:

- `disabled` — user not enabled.
- `offline` — user has assigned hosts and none are online; or no assigned hosts and no non-restricted host is online.
- `suspended` — spend-suspended via cost tracking.
- `active` — currently running (from hub heartbeat).
- `available` — otherwise eligible to be auto-started.

The design doc originally proposed `HOST_ONLINE_THRESHOLD_MS` and `USER_ONLINE_THRESHOLD_MS` constants in `@naisys/common` with `isHostOnline()` / `isAgentOnline()` helpers based on timestamp comparison against `hosts.last_active`. The implementation took a different path: the hub tracks real-time connection state directly (a host is online iff it currently has a naisys socket open), and active-agent tracking uses the heartbeat service rather than `last_active` polling. The threshold-based helpers were not needed.

### `ns-session complete`

`apps/naisys/src/features/session.ts` — `handleComplete()`.

Syntax: `ns-session complete "<result>"`.

Recipient resolution: `localUser.leadUserId ?? getUserByName(ADMIN_USERNAME).userId`. The original plan had the caller specify a target username (`complete <username> "<result>"`); this was simplified because in practice the result always goes to the lead (or admin as fallback), and adding a recipient parameter invited misuse.

Gated by `agentConfig.completeSessionEnabled` — agents without that flag only have `wait`.

---

## Hub protocol

`packages/hub-protocol/src/schemas/agents.ts` defines the request/response schemas:

```typescript
AgentStartRequest { startUserId, taskDescription?, requesterUserId?, sourceHostId? }
AgentStartResponse { success, error?, hostname? }

AgentStopRequest { userId, reason, sourceHostId? }
AgentStopResponse { success, error? }

AgentRunPauseRequest { userId, runId, sessionId, sourceHostId? }
AgentRunPauseResponse { success, error?, changed? }

AgentRunCommandRequest { userId, runId, sessionId, command, sourceHostId? }
AgentRunCommandResponse { success, error? }

AgentPeekRequest { userId, skip?, take?, sourceHostId? }
AgentPeekResponse { success, error?, lines?, totalLines? }
```

Key fields vs. the original design:

- `requesterUserId` is used by the hub to send the "Agent Start" task mail after a successful start.
- `sourceHostId` is used by runners to suppress a redundant "this came from you" notification on loopback.
- There is no separate log request type; `AGENT_PEEK` covers the buffer-inspection use case for both local and remote.

### Stop fan-out

`AGENT_STOP` on the hub is forwarded to every host that heartbeat tracking shows currently running the agent. The hub acks with the first response; `heartbeatService.removeStoppedAgent` is called when a host acks success. This handles the (rare) case where more than one host believes it's running the same user.

---

## Idempotency / duplicate-start prevention

The original design proposed an in-memory `Map<user_id, mail_id>` on each `AgentManager` to avoid restarting an agent for mail it's already seen. That turned out to be unnecessary because:

1. Auto-start only fires when the user is not in `heartbeatService.getActiveUserIds()`. An already-active agent is skipped.
2. A successful start calls `heartbeatService.addStartedAgent(hostId, userId)` eagerly (before the host's first heartbeat arrives), so the next poll won't re-pick the same user in the brief window before the heartbeat catches up.
3. Agents read their own unread mail on startup via `ns-mail` — the mail triggers the wake-up but isn't itself consumed by the start.

Cost throttling is provided by the existing `SPEND_LIMIT_DOLLARS` / `SPEND_LIMIT_HOURS` mechanism plus `costService.isUserSpendSuspended()` checks in the auto-start path. There is no hard concurrency cap on agents.

---

## `wakeOnMessage` vs. auto-start

These remain distinct:

- `wakeOnMessage` (per-agent config in `agentConfig.ts`) — for an agent that is already running but paused in `ns-session wait`, wake the session when new mail arrives. Consumed by `promptNotificationService.shouldWake()` and `promptBuilder.getInput()`.
- Auto-start — starts the agent process from scratch when it isn't running.

An agent can have `wakeOnMessage: false` and still be auto-started; the two controls operate at different lifecycle stages.

---

## Mail delivery feedback

Not implemented. The original plan had `sendMessage()` return a "delivery pending — recipient's host is offline" hint. In hub mode the message is always accepted (queued in the hub database), and once a host connects the `CLIENT_CONNECTED` sweep picks it up. The caller gets a plain "Mail sent" either way.

---

## Configuration

### Global config flag

`autoStartAgentsOnMessage: boolean` in `GlobalConfig` (`packages/common/src/globalConfigLoader.ts`). Currently hardcoded to `true`; the field exists so future environments can disable the behavior without code changes. No `.env` var binding yet.

### Hardcoded values

- Hub poll interval: `MAIL_AUTOSTART_CHECK_INTERVAL_MS = 10_000` (10 seconds).
- Runner auto-start in standalone mode: no interval — triggered inline from `sendMessage()`.

### Removed config

- `subagentMax` has been removed from agent config. With auto-start in place there is no concurrency cap to manage; spend limits gate overall activity instead.

---

## Files of interest

| Area | File |
| --- | --- |
| Hub auto-start loop | `apps/hub/src/handlers/hubMailService.ts` |
| Hub agent routing / host selection | `apps/hub/src/handlers/hubAgentService.ts` |
| Runner agent event handlers | `apps/naisys/src/agent/agentManager.ts` |
| `ns-agent` command | `apps/naisys/src/features/subagent.ts` |
| `ns-users` command | `apps/naisys/src/agent/userDisplayService.ts` |
| `ns-session complete` | `apps/naisys/src/features/session.ts` |
| Agent status calculation | `packages/common/src/agentStatus.ts` |
| Standalone auto-start | `apps/naisys/src/mail/mail.ts` — `sendMessage()` |
| Hub event schemas | `packages/hub-protocol/src/schemas/agents.ts` |
| Hub event names | `packages/hub-protocol/src/events.ts` |
| Global config loader | `packages/common/src/globalConfigLoader.ts` |

---

## Open / future items

- **Cluster-wide spend limits.** `SPEND_LIMIT_DOLLARS` is currently per-host. With auto-start distributing agents across hosts, we want a cluster-total spend cap so overall activity is bounded regardless of how many hosts are up.
- **`autoStartAgentsOnMessage` env binding.** The config field exists but isn't wired to an environment variable. If a deployment needs to disable auto-start it currently has to patch `globalConfigLoader.ts`.
- **Startup error escalation.** If an agent repeatedly fails to start (crash loop, bad config), nothing currently surfaces that to a human or lead agent. Today the behavior is implicit: the hub keeps trying on each poll tick.
