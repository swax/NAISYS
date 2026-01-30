# NAISYS Multi-Machine Redux

**Status: In Progress**

## Problem Statement

The current multi-machine architecture (doc 001) works but is too complicated to develop, maintain, and operate:

### Complexity

- **Multi-master database sync** - Hubs and runners each have their own database. Databases are synced through the hub, essentially multi-master replication. The generic sync logic (timestamp tracking, catch-up, forward queues, stale joiner handling) was the most complex code in the system. Too clever by half, look at the old syncUtils.ts file for an example of how complex the system was - not maintainable. **Removed** - ~2,800 lines of sync infrastructure deleted.
- **Schema version coupling** - Database versions must match across all instances. Updating the cluster means updating all runners and hubs simultaneously and ensuring DB versions match before sync resumes.
- **Indirect data flow** - Online status is done by updating the local database and then syncing that around the network. Mail messages aren't sent like a message bus but also go through the sync mechanism. Everything is sync.

### Unclear Ownership

- **Who's in control?** - Runners are the main thing; hubs are gateways in a federation of runners. This is backwards for managing many runners across machines.
- **Split configuration** - Separate env/agent config files on each runner and hub.
- **Agents running without hub knowing** - Runners can start agents independently. Hub has no real authority.

### Multi-Hub Doesn't Work Well

- The same group of agents connected to multiple hubs, not necessarily seeing the same data. Very messy.
- Supervisor per hub gives a disjointed view of the network.
- The idea was runners are independent and hubs add redundancy. But if a hub can't control the network (because other hubs may conflict), it's not really managing anything.

---

## New Architecture

### Core Principles

1. **Hub is the authority** - In multi-machine mode, the hub owns the database and controls what runs on runners. Runners are lightweight execution environments.
2. **Local mode is ephemeral** - A standalone runner has no database, no Prisma, no SQLite. Config-file-driven, in-memory data structures, simple and fast.
3. **No shared DB schema** - The `@naisys/database` package is hub-only. Runner has no database dependency whatsoever. Runner talks to hub via WebSocket API.
4. **No multi-mastering** - One source of truth per deployment. Hub DB for multi-machine, in-memory for local.
5. **Explicit control model** - Either "local controlled" (standalone, ephemeral) or "hub controlled" (persistent, managed).
6. **Runners table replaces hosts** - Hub has a `runners` table that runners self-register into on first connection. A `user_runners` table maps which users (agents) can run on which runners. A runner is a naisys process instance - typically one per machine, but multiple instances on the same machine are supported.
7. **Hub routes agent starts** - In hub mode, `ns-agent start` sends a request to the hub. Hub picks the first available runner the user is assigned to and pushes `agent.start` to that runner. The target may be the requesting runner or a different one.

### Deployment Modes

| Command                        | Mode             | Description                                                 |
| ------------------------------ | ---------------- | ----------------------------------------------------------- |
| `naisys`                       | Local            | Standalone, ephemeral, yaml-driven, no database, no network |
| `naisys --hub=hub.example.com` | Hub-controlled   | Connects to hub, hub manages agents and all data            |
| `naisys-hub`                   | Hub              | WebSocket API server with database                          |
| `naisys-hub --supervisor`      | Hub + Supervisor | Hub with web UI                                             |

### Architecture Diagram

```
LOCAL MODE:                          HUB-CONTROLLED MODE:

┌─────────────────────┐              ┌─────────────────────────────────┐
│  naisys (standalone) │              │  naisys-hub                     │
│                      │              │  ┌───────────┐  ┌────────────┐ │
│  Agent configs from  │              │  │ Database  │  │ Supervisor │ │
│  yaml files          │              │  │ (SQLite/  │  │ (optional) │ │
│                      │              │  │  Postgres)│  │            │ │
│  In-memory state:    │              │  └─────┬─────┘  └────────────┘ │
│  - mail (send only)  │              │        │                       │
│  - agent list        │              │  ┌─────┴─────┐                 │
│  - notifications     │              │  │ WebSocket │                 │
│                      │              │  │ API Server│                 │
│  No persistence      │              │  └─────┬─────┘                 │
│  No database         │              └────────┼───────────────────────┘
│  No Prisma/SQLite    │                       │
└─────────────────────┘                 ┌──────┼──────┐
                                        │      │      │
                                   ┌────┴──┐ ┌─┴───┐ ┌┴──────┐
                                   │Runner │ │Run- │ │Runner │
                                   │(thin) │ │ner  │ │(thin) │
                                   │no DB  │ │     │ │no DB  │
                                   └───────┘ └─────┘ └───────┘
```

### Future: Hub-to-Hub Federation

```
┌─────────┐         ┌─────────┐
│  Hub A  │◄───────►│  Hub B  │    Hubs sync databases with each other
│ (team1) │         │ (team2) │    Each hub is authoritative for its runners
│  + DB   │         │  + DB   │    Supervisor per hub shows its own network
└────┬────┘         └────┬────┘    Reuses existing sync/catchup protocol
     │                   │         (moved from runner→hub to hub→hub)
  Runners A           Runners B
```

Federation moves to the hub level. Each hub is authoritative for its runners. Hubs would sync with each other using a purpose-built protocol. The old runner-to-hub sync code was deleted rather than relocated (see Decision 10).

**Not in scope for initial migration.** Interhub Socket.IO namespaces and connection scaffolding have been created (`interhubServer.ts`, `interhubClient.ts`, `interhubConnection.ts`), but no sync protocol is implemented yet.

---

## Local Ephemeral Mode

### Design

Local mode has **no database, no Prisma, no SQLite**. The naisys runner drops the `@naisys/database` dependency entirely. All state is in-memory data structures that exist only for the lifetime of the process.

- Agent configs loaded from yaml files
- Multiple agents run in the same process
- Mail: only `ns-mail send` is supported. Messages are routed directly to the target agent in-process via the event bus. No mail list/read/search/archive (nothing to query).
- No cost persistence, no log persistence, no session tracking
- No hub connection, no sync, no network dependency
- On restart, everything is fresh

### Mail in Local Mode

The send command delivers the message directly to the receiving agent's notification system:

```
Agent A calls: ns-mail send "agentB" "subject" "message"
  1. Look up agentB in the in-process agent list
  2. Push message content directly to agentB's notification queue
  3. agentB wakes (if wakeOnMessage), message appears in context
  4. No storage, no retrieval commands
```

This is sufficient for local dev/test where agents coordinate through direct messaging. The existing `mailEventBus.ts` already supports in-process delivery - this just cuts out the DB intermediary.

### What This Means for Services

In local mode, services that depend on the database either don't exist or are replaced with no-op / in-memory equivalents:

| Service              | Local Mode Behavior                            |
| -------------------- | ---------------------------------------------- |
| `logService`         | No-op (or write to console/file)               |
| `costTracker`        | In-memory running total, no persistence        |
| `runService`         | In-memory run/session counters                 |
| `hostService`        | Not needed (no host concept)                   |
| `mail`               | Send-only, direct in-process delivery          |
| `mailDisplayService` | Not available (no data to query)               |
| `subagent`           | In-memory agent list from yaml configs         |
| `agentConfig`        | Loaded from yaml file, kept in memory          |
| `agentRegistrar`     | Scans yaml folder, builds in-memory agent list |

---

## Hub-Controlled Mode

### Design

Runner connects to hub via WebSocket. All data operations go through the hub API. Runner has no local database. The hub owns the database, manages all persistent state, and controls which agents run on which runners.

### Hub Database: Runners & Assignment

The hub database has two tables for runner management:

```
runners
  id          String  @id       // ULID
  name        String  @unique   // e.g., "runner-east-1"
  last_active DateTime?         // Updated from heartbeat
  updated_at  DateTime @updatedAt

user_runners
  user_id     String            // FK to users
  runner_id   String            // FK to runners
  @@id([user_id, runner_id])    // Composite PK
```

- Both hub and runner have `HUB_ACCESS_KEY` in their `.env` files. If they match, the connection is accepted
- Runners are not pre-registered. On first `runner.register`, hub creates the runner entry automatically
- Users (agents) are assigned to one or more runners via `user_runners`
- On `runner.register`, hub validates the access key, auto-creates the runner if new, and returns the configs for users assigned to that runner
- A user assigned to multiple runners can be started on any of them (hub picks first available)

### Agent Start Flow (Hub Mode)

When an agent calls `ns-agent start <username>`:

```
1. Runner sends agent.start request to hub
2. Hub looks up the user
3. Hub queries user_runners for assigned runners
4. Hub picks the first connected runner that has capacity
   (could be the same runner or a different one)
5. Hub pushes agent.start { userId, config, taskDescription } to target runner
6. Target runner starts the agent locally
```

In local mode, `ns-agent start` just starts the agent directly in-process. No hub involved.

### Hub API Protocol

Uses Socket.IO's native event + acknowledgement pattern over the existing WebSocket connection. Each API method is a named Socket.IO event. No custom JSON-RPC framing needed -- Socket.IO handles correlation and callbacks natively.

**Request-response** (runner → hub, awaits ack):

```typescript
// Runner side: hubClient.sendRequest<T>(event, payload) returns Promise<T>
// Uses Socket.IO's built-in acknowledgement callbacks for correlation
const response = await hubClient.sendRequest<UserListResponse>(
  HubEvents.USER_LIST,
  {},
);
```

**Fire-and-forget** (runner → hub, no ack):

```typescript
// Runner side: hubClient.sendMessage(event, payload)
hubClient.sendMessage("log.write", { entries: [...] });
```

**Hub-pushed events** (hub → runner):

```typescript
// Hub side: runnerConnection.emit(event, data)
// Runner side: hubClient.registerEvent(event, handler)
```

Hub handlers are registered on `runnerServer` as named event handlers with Zod schema validation. Each handler receives `(runnerId, data, ack?)` and calls `ack(response)` for request-response or omits it for push events.

### API Methods

#### Fire-and-Forget (buffered, batched)

High-frequency writes that don't need confirmation. Runner buffers and sends periodically (e.g., every 1-2 seconds or when buffer is full).

| Method       | Data                               | Notes                                                                |
| ------------ | ---------------------------------- | -------------------------------------------------------------------- |
| `log.write`  | context_log rows                   | Buffered, sent in batches                                            |
| `cost.write` | costs rows                         | Buffered, sent in batches                                            |
| `heartbeat`  | runnerId, userId, runId, sessionId | Single call replaces both host and run last_active. Send every 5-10s |

#### Request-Response (must wait for reply)

| Method              | Params                                      | Returns            | Notes                                                                                                                                                                |
| ------------------- | ------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registration**    |                                             |                    |                                                                                                                                                                      |
| `runner.register`   | runnerName, accessKey                       | runnerId           | On connect (handled during Socket.IO auth handshake). Hub validates accessKey, auto-creates runner if name is new. ✅ Done                                           |
| `user.list`         | -                                           | users[]            | Returns all users assigned to this runner with full configs (username, configYaml, agentPath). Separate from registration to allow reload without reconnect. ✅ Done |
| **Session**         |                                             |                    |                                                                                                                                                                      |
| `session.create`    | userId, modelName                           | runId, sessionId   | On agent start                                                                                                                                                       |
| `session.increment` | userId, runId                               | sessionId          | On session compact                                                                                                                                                   |
| **Mail**            |                                             |                    |                                                                                                                                                                      |
| `mail.send`         | fromUserId, toUsernames[], subject, body    | success/error      | Hub resolves usernames, creates records, notifies target runners                                                                                                     |
| `mail.list`         | userId, filter?                             | raw message data   | Hub queries, returns raw data. Runner formats for display                                                                                                            |
| `mail.read`         | userId, messageId                           | raw message data   | Hub marks as read, returns raw content                                                                                                                               |
| `mail.archive`      | userId, messageIds[]                        | success/error      |                                                                                                                                                                      |
| `mail.search`       | userId, terms, flags                        | raw results        |                                                                                                                                                                      |
| `mail.users`        | -                                           | raw user data      | Runner formats into table/hierarchy                                                                                                                                  |
| `mail.unread`       | userId                                      | unread message IDs | For notification checking                                                                                                                                            |
| **Cost**            |                                             |                    |                                                                                                                                                                      |
| `cost.report`       | userId, args                                | raw cost data      | For ns-cost command. Runner formats                                                                                                                                  |
| **Subagent**        |                                             |                    |                                                                                                                                                                      |
| `agent.subagents`   | userId                                      | agent list         | For ns-agent list                                                                                                                                                    |
| `agent.start`       | fromUserId, targetUsername, taskDescription | success/error      | Hub resolves user, finds assigned runner via user_runners, pushes agent.start to target runner                                                                       |

### Hub-Pushed Events

Hub pushes events to runners over the WebSocket (no polling needed):

| Event            | Data                            | Trigger                                                             |
| ---------------- | ------------------------------- | ------------------------------------------------------------------- |
| `mail.received`  | recipientUserIds[]              | Hub processes a mail.send from any runner                           |
| `agent.start`    | userId, config, taskDescription | Hub or supervisor requests agent start                              |
| `agent.stop`     | userId, reason                  | Hub or supervisor requests agent stop                               |
| `agent.pause`    | userId?, reason                 | Pause agent(s). userId omitted = pause all. See Agent Pausing below |
| `agent.resume`   | userId?, reason                 | Resume agent(s). userId omitted = resume all                        |
| `config.updated` | userId, newConfig               | Agent config changed via supervisor                                 |

### Agent Pausing

Pausing is a first-class feature of the runner. An agent can be paused by multiple independent triggers. The agent resumes only when all pause reasons are cleared.

**Pause triggers:**

| Trigger            | Who pauses                                            | Who resumes                                                         |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| **Cost overrun**   | Hub pushes `agent.pause` when cost limit exceeded     | Hub pushes `agent.resume` when limit clears (new day, limit raised) |
| **Hub disconnect** | Runner self-pauses all agents on WebSocket disconnect | Runner self-resumes on reconnect                                    |
| **Hub command**    | Hub pushes `agent.pause` (manual via supervisor)      | Hub pushes `agent.resume` (manual via supervisor)                   |

**Runner-side behavior:**

- Runner tracks a set of active pause reasons per agent (e.g., `{ "cost_overrun", "hub_disconnect" }`)
- Agent is paused if the set is non-empty
- Adding a reason pauses; removing a reason only resumes if no other reasons remain
- When paused, the agent's command loop sleeps (no LLM calls, no commands)
- Buffered data (logs, costs) is still flushed on reconnect

**Cost tracking flow:**

1. Runner sends `cost.write` batches to hub (fire-and-forget)
2. Hub processes writes, updates DB, checks limits
3. If limit exceeded: hub pushes `agent.pause { reason: "cost_overrun" }`
4. When limit clears: hub pushes `agent.resume { reason: "cost_overrun" }`

No separate `cost.check` call. No network round-trip on the LLM hot path.

**Hub disconnect flow:**

1. Runner detects WebSocket disconnect
2. Runner adds `"hub_disconnect"` pause reason to all agents
3. All agents pause (no LLM calls while disconnected)
4. Fire-and-forget data continues to buffer
5. On reconnect: runner re-registers, flushes buffer, removes `"hub_disconnect"` reason
6. Agents resume (unless other pause reasons exist, e.g., cost overrun)

### Hub-Side Implementation

Hub API handlers are registered as Socket.IO event handlers on `runnerServer`. Each handler is a service that registers its events during hub startup. DB query logic moves from runner services to hub services.

```
apps/hub/src/
  services/
    runnerServer.ts          # Socket.IO server for runner connections (/runners namespace) ✅
    runnerConnection.ts      # Per-runner connection handler ✅
    runnerRegistrar.ts       # Tracks connected runners in DB ✅
    hubUserService.ts        # Handles user_list requests from runners ✅
    agentRegistrar.ts        # Seeds DB with agent configs from yaml ✅
    hostService.ts           # Hub host identity and DB record ✅
    hubServerLog.ts          # Logging ✅
    hubMailService.ts        # mail.send, mail.list, mail.read, etc. (TODO)
    hubSessionService.ts     # session.create, session.increment (TODO)
    hubCostService.ts        # cost.write processing, cost.status push (TODO)
    hubAgentService.ts       # agent.subagents, agent.start routing (TODO)
  interhub/
    interhubServer.ts        # Socket.IO server for hub-to-hub (/interhub namespace) ✅
    interhubClient.ts        # Client for connecting to peer hubs ✅
    interhubConnection.ts    # Single hub-to-hub connection handler ✅
    interhubClientLog.ts     # Logging ✅
```

Hub handlers use Prisma queries - essentially the same queries currently in runner services. The logic moves; the queries stay the same. No separate `hubApiServer.ts` router needed -- Socket.IO event registration handles routing natively.

### Connection Lifecycle

```
Runner startup (hub mode):
  1. Connect to hub WebSocket
  2. Send runner.register { runnerName, accessKey }
     -> hub validates accessKey matches its own HUB_ACCESS_KEY
     -> if invalid: error + disconnect, runner startup fails
     -> if runner name is new: hub creates runner entry
     -> hub returns runnerId + list of assigned agents with full configs
  3. For each agent: call session.create -> receive runId, sessionId
  4. Start agents, begin heartbeat interval
  5. Agents run normally, all data operations go through hub API
  6. Hub may push additional agent.start / agent.stop at any time

Hub disconnect:
  1. Runner pauses all agents (adds "hub_disconnect" pause reason)
  2. Fire-and-forget writes continue to buffer in memory (bounded)
  3. Reconnect with exponential backoff
  4. On reconnect: re-register (idempotent), flush buffer, remove "hub_disconnect" pause
  5. Agents resume (unless other pause reasons exist)
  6. No catch-up needed - hub is the source of truth, runner has no state to sync
```

### Buffering & Resilience

For fire-and-forget data (logs, costs, heartbeats):

- Buffer in memory (bounded queue, e.g., 10,000 entries)
- Flush to hub every 1-2 seconds or when buffer is full
- On disconnect: agents are paused, but buffer retains any data written before pause took effect
- On reconnect: flush buffer
- If buffer overflows: drop oldest entries (log a warning)

Note: Since agents pause on hub disconnect, the buffer mostly holds data written just before the disconnect was detected plus any final flush. Buffer overflow is unlikely but handled as a safety net.

---

## Migration Plan

### Phase 1: Foundation ✅ Done

Establish the new architecture: remove sync, set up hub/runner separation, create shared infrastructure.

**What was done:**

1. ✅ Removed multi-master sync infrastructure (~2,800 lines): `hubSyncServer.ts`, `hubSyncClient.ts`, `syncUtils.ts`, `hubForwardService.ts`, 3 integration tests
2. ✅ Replaced `isMultiMachineMode` with `isHubMode`
3. ✅ Renamed `agentManager` → `agentRunner`, `naisysConnection` → `runnerConnection`, `hubServer` → `runnerServer`
4. ✅ Created `@naisys/common` package with shared agent config schemas and loader
5. ✅ Split hub into `/runners` and `/interhub` Socket.IO namespaces
6. ✅ Created `runnerServer.ts`, `runnerConnection.ts`, `runnerRegistrar.ts` on hub
7. ✅ Added `runners` table to database
8. ✅ Created `agentRegistrar.ts` on hub (seeds DB from yaml)
9. ✅ Hub startup requires `HUB_ACCESS_KEY`, runner authenticates with it
10. ✅ Runner connects to single hub on startup (multiple URLs are fallback, not multi-hub)
11. ✅ Added `sendRequest<T>()` to `hubClient` for Promise-based request/response
12. ✅ Scaffolded interhub client/server/connection for future hub-to-hub federation

**Deviation from original plan:** The original plan had separate phases for "Hub API Layer" and "Runner Hub API Client." In practice, these were done together incrementally. Socket.IO's native event + ack pattern replaced the planned JSON-RPC protocol, eliminating the need for a separate `hubApiServer.ts` router or `hubApiClient.ts`. The existing `hubClient.sendRequest()` and `runnerServer.registerEvent()` serve these roles.

### Phase 2: Remove DB Dependencies from Runner (In Progress)

Replace each runner service's DB usage with hub API calls (in hub mode) or in-memory equivalents (in local mode). Use `isHubMode` branching in each service. Do this one service at a time.

**Goal:** Runner operates without a local database.

**Approach:** Each service uses `isHubMode` to branch between hub API calls and local in-memory/yaml-based behavior. The `userService` is the template for this pattern.

Order of migration (roughly least to most complex):

1. ✅ **userService** -> In hub mode: request user list from hub via `user.list` event. In local mode: load from yaml files. Both cache in `Map<string, UserEntry>`.
2. **hostService** -> Remove entirely. Runner has no host concept. `runner.register` replaces host registration. Heartbeat replaces last_active updates. Note: `localHostId` is used by many services -- replace with `runnerId` (from hub registration) or generated transient ID (local mode).
3. **runService** -> `session.create` + `session.increment`. Heartbeat covers last_active. In local mode: in-memory counters.
4. **logService** -> `log.write` (fire-and-forget batch). In local mode: no-op or console output.
5. **costTracker** -> `cost.write` (fire-and-forget batch) + listen for `agent.pause`/`agent.resume` push. Cost report via `cost.report` API. In local mode: in-memory running total.
6. **agentConfig** -> Config received from hub on agent start (via `user.list` or `agent.start` push). Cached in memory. In local mode: loaded from yaml.
7. **mailAddress** -> Username resolution moves to hub (part of `mail.send`). In local mode: resolve from in-memory user list.
8. **mailDisplayService** -> All queries become API calls (`mail.list`, `mail.read`, `mail.search`, `mail.users`). Hub returns raw data, runner formats. In local mode: not available (no data to query).
9. **mail** -> `mail.send`, `mail.read` (mark as read), `mail.archive`, `mail.unread`. `mail.received` push replaces polling. In local mode: send-only, direct in-process delivery via event bus.
10. **subagent** -> `agent.subagents` for listing. `agent.start` request to hub for starting (hub routes to correct runner). In local mode: in-memory agent list from userService.

After all services migrated:

- Remove `@naisys/database` from naisys `package.json`
- Remove all `import { DatabaseService } from "@naisys/database"` from naisys
- Remove database initialization from `naisys.ts`
- The `@naisys/database` package becomes hub-only

### Phase 3: Cleanup & Renames

Final cleanup pass after all services are migrated.

1. Remove unused database types/imports from naisys
2. Remove `remoteAgentRequester.ts` from runner if remote agent control is now hub-mediated
3. Remove `remoteAgentHandler.ts` if agent start/stop is now via hub push events
4. Update `hub-protocol` to remove runner-sync message types (catch_up, sync_request, sync_response, forward)
5. Verify `@naisys/database` is not in naisys dependency tree
6. Update supervisor if needed (should mostly just work since it reads hub DB)

---

## What Gets Removed (from runner)

| Component                     | Before                                            | After                                                                 | Status |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `hubSyncClient.ts`            | Responds to sync requests, processes forwards     | Removed (deleted, not moved -- will rewrite for hub-to-hub if needed) | ✅     |
| `syncUtils.ts` (runner usage) | Query/upsert sync records                         | Removed from runner                                                   | ✅     |
| `hubForwardService.ts`        | Forward queues for sync                           | Removed                                                               | ✅     |
| `remoteAgentRouter.ts`        | Hub-side routing of remote agent commands         | Removed (replaced by `runnerServer` event handlers)                   | ✅     |
| `agentRegistrar.ts` (runner)  | Runner-side agent config scanning and DB sync     | Removed from runner, rebuilt on hub as `agentRegistrar.ts`            | ✅     |
| Multi-hub connection          | Runner connects to multiple hubs                  | Runner connects to one hub (multiple URLs are fallback)               | ✅     |
| Schema version matching       | Runner/hub must match DB version                  | Not needed (API versioning)                                           | ✅     |
| Forward handling              | Runner upserts forwarded data                     | Not needed (hub is source of truth)                                   | ✅     |
| `@naisys/database` dependency | Runner imports Prisma, SQLite                     | Removed entirely                                                      |        |
| Database file                 | Runner has naisys.db                              | No local DB at all                                                    |        |
| Periodic mail polling         | 5-second interval checking for cross-machine mail | Hub pushes `mail.received` events                                     |        |
| Dual last_active updates      | hostService + runService both update every 2s     | Single heartbeat every 5-10s                                          |        |
| Host concept on runner        | Runner registers as a host, tracks host_id        | Removed. Replaced by `runners` table on hub                           |        |
| `hostService.ts`              | Create/update host record, list hosts             | Removed. `runner.register` + heartbeat replaces it                    |        |
| `remoteAgentRequester.ts`     | Runner asks hub to route agent commands           | Removed. `agent.start` request to hub, hub routes via `user_runners`  |        |
| `remoteAgentHandler.ts`       | Runner handles incoming agent commands            | Replaced by hub push events (`agent.start`, `agent.stop`)             |        |
| `mailAddress.ts` (DB queries) | Resolve usernames via local DB                    | Hub resolves usernames                                                |        |

## What Stays

| Component                    | Notes                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| Agent runtime / command loop | Core agent execution unchanged                                   |
| LLM providers                | Direct API calls to LLM, no hub involvement                      |
| Shell command execution      | Local process, no hub involvement                                |
| Mail event bus               | Still used for same-process notifications in local mode          |
| Agent yaml config format     | Same config files (local mode reads them, hub imports from them) |
| Hub database + Prisma        | Hub keeps `@naisys/database`, gains API handlers                 |
| Supervisor                   | Points at hub DB, minimal changes                                |
| `hub-protocol` package       | Extended with API message schemas (e.g., `UserListResponse`)     |
| `@naisys/common` package     | New shared package for agent config schemas and loader           |
| WebSocket connection         | Same Socket.IO transport, event + ack pattern for API            |

---

## Regression Testing

### Hub Mode

- [x] Runner self-registers on first connection (hub auto-creates runner entry)
- [x] Runner connects to hub, authenticates with matching HUB_ACCESS_KEY
- [x] Runner with wrong HUB_ACCESS_KEY is rejected and disconnected
- [x] Runner receives assigned agents with full configs via user.list
- [ ] Runner starts assigned agents
- [ ] Agent logs and costs flow to hub (visible in supervisor)
- [ ] ns-mail send/list/read/archive/search work across runners
- [ ] ns-mail users shows all users from all runners
- [ ] Subagent start/stop works (local and remote via hub)
- [ ] Cost spend limits enforced via hub push (`cost.status`)
- [ ] ns-session compact works (new session created on hub)
- [ ] Runner reconnects after hub restart, resumes operation
- [ ] Buffered data (logs/costs) flushed after reconnect
- [ ] Hub pushes `mail.received` notifications (no polling)
- [ ] Supervisor shows live data from all runners
- [ ] Hub can start/stop agents on runner via push events
- [ ] ns-agent start in hub mode routes through hub to correct runner via user_runners
- [ ] Agent assigned to multiple runners starts on first available connected runner

### Local Ephemeral Mode

- [ ] `naisys` starts without any hub config
- [ ] No database file created, no Prisma/SQLite loaded
- [ ] Multiple agents run in same process
- [ ] `ns-mail send` delivers message directly to target agent
- [ ] Agent configs loaded from yaml files
- [ ] Clean restart - no leftover state

### scdb Regression

- [ ] Can it run with hub?
- [ ] Can it run without hub ephemerally?

---

## Decisions

Answers to design questions resolved during planning:

1. **Local mode: no SQLite** - Break the SQLite/Prisma dependency from naisys entirely. In-memory data structures only. No shared schema between hub and runner.

2. **Mail in local mode: send only** - `ns-mail send` routes directly to the target agent in-process. No list/read/search/archive. Sufficient for local dev/test.

3. **Pausing is first-class** - Agent pausing is a general mechanism with multiple triggers: cost overrun (hub pushes pause), hub disconnect (runner self-pauses), manual hub command. Runner tracks a set of pause reasons per agent and only resumes when all reasons are cleared.

4. **Hub disconnect: pause agents** - Runner pauses all agents on hub disconnect. Agents are not useful without the hub (no mail, no cost tracking, no session management). Fire-and-forget data buffers until reconnect. On reconnect, flush buffer and resume.

5. **Agent config in hub mode: hub-pushed** - Hub owns agent configs in its database. Configs pushed to runner when starting an agent. No yaml files on runner in hub mode. Yaml files can be imported/exported to the hub.

6. **Cost tracking: hub-pushed** - No separate spend-check call. Hub monitors costs from `cost.write` batches and pushes `agent.pause` / `agent.resume` when limits change.

7. **Runners table replaces hosts** - Hub has a `runners` table (self-registered on first connection) and a `user_runners` table (which agents can run on which runners). Both hub and runner have `HUB_ACCESS_KEY` in `.env`; if they match, the connection is accepted. The old `hosts` table is replaced; `hosts` may still exist for hub identity in hub-to-hub federation. A runner is a naisys process instance - typically one per machine, but multiple on the same machine is supported.

8. **Hub routes agent starts** - In hub mode, `ns-agent start` sends a request to the hub. Hub looks up `user_runners`, picks the first available connected runner for that user, and pushes `agent.start` to it. In local mode, `ns-agent start` just starts the agent directly in-process.

9. **Display formatting: runner-side** - Hub returns raw data for mail and cost queries. Runner formats into tables/hierarchies. Standard API pattern, allows runner-side logic on the data.

10. **Sync code: deleted** - Sync infrastructure was deleted from the runner (~2,800 lines) rather than relocated to the hub. If hub-to-hub federation needs sync later, it will be rewritten purpose-built for that use case rather than adapting the old runner-to-hub protocol.

11. **Database package: hub-only** - `@naisys/database` is removed from naisys runner dependency. Hub is the sole consumer.

12. **Socket.IO events, not JSON-RPC** - Instead of a custom JSON-RPC protocol with correlation IDs, the hub API uses Socket.IO's native event + acknowledgement pattern. `hubClient.sendRequest<T>()` wraps acks in Promises for request-response. `hubClient.sendMessage()` is used for fire-and-forget. No custom framing or routing layer needed.

13. **User list separate from registration** - Rather than bundling the user list into the `runner.register` response, a separate `user.list` event allows reloading user configs without reconnecting. Registration is handled during Socket.IO auth handshake.

14. **Hub services, not handlers directory** - Hub API handlers live in `apps/hub/src/services/` alongside other hub services (e.g., `hubUserService.ts`), not in a separate `handlers/` directory. Each service registers its events on `runnerServer` during hub startup.

---

## Open Questions

1. **API versioning** - Replace schema_version matching with API version in the hub protocol? Hub could support multiple API versions for rolling upgrades. Simpler than requiring all instances to match DB schema.

2. **Agent config import/export** - What's the UX for getting yaml configs into/out of the hub? CLI command? Supervisor UI? Hub scans a folder on startup?

3. **Local mode pausing** - Should local mode support pausing (e.g., for in-memory cost limits), or is pausing hub-mode only?

4. **Runner capacity** - When hub routes an `agent.start` to a runner, how does it determine "first available"? Simple round-robin? Track running agent count per runner? Max agents per runner config?
