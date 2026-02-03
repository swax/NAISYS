# NAISYS Multi-Machine Redux

**Status: In Progress**

## Problem Statement

The current multi-machine architecture (doc 001) works but is too complicated to develop, maintain, and operate:

### Complexity

- **Multi-master database sync** - Hubs and runners each have their own database. Databases are synced through the hub, essentially multi-master replication. The generic sync logic (timestamp tracking, catch-up, forward queues, stale joiner handling) was the most complex code in the system. Too clever by half, look at the old syncUtils.ts file for an example of how complex the system was - not maintainable. 
- **Schema version coupling** - Database versions must match across all instances. Updating the cluster means updating all runners and hubs simultaneously and ensuring DB versions match before sync resumes.
- **Indirect data flow** - Online status is done by updating the local database and then syncing that around the network. Mail messages aren't sent like a message bus but also go through the sync mechanism. Everything is sync. NAISYS running without a hub connection, defining users, leads to easy network desyncs. 
- **Host management** - Each naisys instance was a host, and agents are fixed to hosts. Changing the host of a user is a complex process. Mail has to be sent to user@host. Ideally hosts don't matter the hub trackers users and we can flex assign them to any host. The hub controls the configuration, single source of truth. Mail is sent to a user and can be received on any host that it is currently running on.

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

### Nomenclature

| Term              | Meaning                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ |
| **Hub**           | Central server (`naisys-hub`). Owns the database, controls what runs where                 |
| **NAISYS instance** | A `naisys` process that connects to the hub as a client. Runs multiple agents via its agent manager. No local database |
| **Client**        | Synonym for NAISYS instance when emphasizing the hub connection                            |
| **Host**          | Database concept: a registered NAISYS instance in the `hosts` table                        |
| **Agent manager** | Component within a NAISYS instance that manages running agents (`AgentManager`)            |

### Core Principles

1. **Hub is the authority** - In multi-machine mode, the hub owns the database and controls what runs on NAISYS instances. Instances are lightweight execution environments.
2. **Local mode is ephemeral** - A standalone NAISYS instance has no database, no Prisma, no SQLite. Config-file-driven, in-memory data structures, simple and fast.
3. **No shared DB schema** - The `@naisys/database` package is hub-only. NAISYS has no database dependency whatsoever. It talks to hub via WebSocket API.
4. **No multi-mastering** - One source of truth per deployment. Hub DB for multi-machine, in-memory for local.
5. **Explicit control model** - Either "local controlled" (standalone, ephemeral) or "hub controlled" (persistent, managed).
6. **Hosts identify NAISYS instances** - Each NAISYS instance is assigned a hostname and self-registers into the existing `hosts` table on first connection. A `user_hosts` table maps which users (agents) can run on which hosts. If a user has no `user_hosts` entries, they can run on any host. A host is a naisys process instance - typically one per machine, but multiple instances on the same machine are supported.
7. **Hub routes agent starts** - In hub mode, `ns-agent start` sends a request to the hub. Hub picks the first available host the user is assigned to (or any host if unassigned) and pushes `agent.start` to that host. The target may be the requesting instance or a different one.

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
└─────────────────────┘               ┌────────┼────────┐
                                      │        │        │
                                 ┌────┴────┐ ┌─┴─────┐ ┌┴────────┐
                                 │ naisys  │ │naisys │ │ naisys  │
                                 │(client) │ │(cli-  │ │(client) │
                                 │ no DB   │ │ ent)  │ │ no DB   │
                                 └─────────┘ └───────┘ └─────────┘
```

---

## Local Ephemeral Mode

### Design

Local mode has **no database, no Prisma, no SQLite**. NAISYS drops the `@naisys/database` dependency entirely. All state is in-memory data structures that exist only for the lifetime of the process.

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

NAISYS instance connects to hub via WebSocket as a client. All data operations go through the hub API. The instance has no local database. The hub owns the database, manages all persistent state, and controls which agents run on which instances.

### Hub Database: Hosts & Assignment

The hub database uses the existing `hosts` table for NAISYS instance tracking, plus a `user_hosts` mapping table:

```
hosts
  id          String    @id       // ULID
  name        String    @unique   // NAISYS_HOSTNAME
  last_active DateTime?           // Updated from heartbeat
  created_at  DateTime  @default(now())

user_hosts
  user_id     String    @id       // FK to users
  host_id     String              // FK to hosts
  created_at  DateTime  @default(now())
```

- Both hub and NAISYS instance have `HUB_ACCESS_KEY` in their `.env` files. If they match, the connection is accepted
- Hosts are not pre-registered. On first connection, hub creates the host entry automatically using the instance's hostname
- Users (agents) can be assigned to specific hosts via `user_hosts`. If a user has no `user_hosts` entries, they can run on any host
- On connection, hub validates the access key, auto-creates the host if new, and returns the configs for users assigned to (or allowed on) that host

### Agent Start Flow (Hub Mode)

When an agent calls `ns-agent start <username>`:

```
1. NAISYS instance sends agent.start request to hub
2. Hub looks up the user
3. Hub queries user_hosts for assigned hosts (if none, all hosts are eligible)
4. Hub picks the first connected eligible host that has capacity
   (could be the same instance or a different one)
5. Hub pushes agent.start { userId, config, taskDescription } to target instance
6. Target instance starts the agent locally via its agent manager
```

In local mode, `ns-agent start` just starts the agent directly in-process. No hub involved.

### Hub API Protocol

Uses Socket.IO's native event + acknowledgement pattern over the existing WebSocket connection. Each API method is a named Socket.IO event. No custom JSON-RPC framing needed -- Socket.IO handles correlation and callbacks natively.

**Request-response** (client → hub, awaits ack):

```typescript
// Client side: hubClient.sendRequest<T>(event, payload) returns Promise<T>
// Uses Socket.IO's built-in acknowledgement callbacks for correlation
const response = await hubClient.sendRequest<UserListResponse>(
  HubEvents.USER_LIST,
  {},
);
```

**Fire-and-forget** (client → hub, no ack):

```typescript
// Client side: hubClient.sendMessage(event, payload)
hubClient.sendMessage("log.write", { entries: [...] });
```

**Hub-pushed events** (hub → client):

```typescript
// Hub side: naisysConnection.emit(event, data)
// Client side: hubClient.registerEvent(event, handler)
```

Hub handlers are registered on `naisysServer` as named event handlers with Zod schema validation. Each handler receives `(hostId, data, ack?)` and calls `ack(response)` for request-response or omits it for push events.

### API Methods

#### Fire-and-Forget (buffered, batched)

High-frequency writes that don't need confirmation. Client buffers and sends periodically (e.g., every 1-2 seconds or when buffer is full).

| Method       | Data                               | Notes                                                                |
| ------------ | ---------------------------------- | -------------------------------------------------------------------- |
| `log.write`  | context_log rows                   | Buffered, sent in batches                                            |
| `cost.write` | costs rows                         | Buffered, sent in batches                                            |
| `heartbeat`  | hostId, userId, runId, sessionId   | Single call replaces both host and run last_active. Send every 5-10s |

#### Request-Response (must wait for reply)

| Method              | Params                                      | Returns            | Notes                                                                                                                                                                |
| ------------------- | ------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registration**    |                                             |                    |                                                                                                                                                                      |
| (auth handshake)    | hostname, accessKey                         | hostId             | Handled during Socket.IO auth middleware. Hub validates accessKey, auto-creates host if name is new. ✅ Done                                                         |
| `user.list`         | -                                           | users[]            | Returns all users assigned to (or allowed on) this host with full configs (username, configYaml, agentPath). Separate from registration to allow reload without reconnect. ✅ Done |
| **Session**         |                                             |                    |                                                                                                                                                                      |
| `session.create`    | userId, modelName                           | runId, sessionId   | On agent start                                                                                                                                                       |
| `session.increment` | userId, runId                               | sessionId          | On session compact                                                                                                                                                   |
| **Mail**            |                                             |                    |                                                                                                                                                                      |
| `mail.send`         | fromUserId, toUsernames[], subject, body    | success/error      | Hub resolves usernames, creates records, notifies target instances                                                                                                   |
| `mail.list`         | userId, filter?                             | raw message data   | Hub queries, returns raw data. Client formats for display                                                                                                            |
| `mail.read`         | userId, messageId                           | raw message data   | Hub marks as read, returns raw content                                                                                                                               |
| `mail.archive`      | userId, messageIds[]                        | success/error      |                                                                                                                                                                      |
| `mail.search`       | userId, terms, flags                        | raw results        |                                                                                                                                                                      |
| `mail.users`        | -                                           | raw user data      | Client formats into table/hierarchy                                                                                                                                  |
| `mail.unread`       | userId                                      | unread message IDs | For notification checking                                                                                                                                            |
| **Cost**            |                                             |                    |                                                                                                                                                                      |
| `cost.report`       | userId, args                                | raw cost data      | For ns-cost command. Client formats                                                                                                                                  |
| **Subagent**        |                                             |                    |                                                                                                                                                                      |
| `agent.subagents`   | userId                                      | agent list         | For ns-agent list                                                                                                                                                    |
| `agent.start`       | fromUserId, targetUsername, taskDescription | success/error      | Hub resolves user, finds eligible host via user_hosts (or any host if unassigned), pushes agent.start to target instance                                             |

### Hub-Pushed Events

Hub pushes events to NAISYS instances over the WebSocket (no polling needed):

| Event            | Data                            | Trigger                                                                |
| ---------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `mail.received`  | recipientUserIds[]              | Hub processes a mail.send from any instance                            |
| `agent.start`    | userId, config, taskDescription | Hub or supervisor requests agent start                                 |
| `agent.stop`     | userId, reason                  | Hub or supervisor requests agent stop                                  |
| `agent.pause`    | userId?, reason                 | Pause agent(s). userId omitted = pause all. See Agent Pausing below    |
| `agent.resume`   | userId?, reason                 | Resume agent(s). userId omitted = resume all                           |
| `config.updated` | userId, newConfig               | Agent config changed via supervisor                                    |

### Agent Pausing

Pausing is a first-class feature of the NAISYS instance. An agent can be paused by multiple independent triggers. The agent resumes only when all pause reasons are cleared.

**Pause triggers:**

| Trigger            | Who pauses                                                   | Who resumes                                                         |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Cost overrun**   | Hub pushes `agent.pause` when cost limit exceeded            | Hub pushes `agent.resume` when limit clears (new day, limit raised) |
| **Hub disconnect** | Instance self-pauses all agents on WebSocket disconnect      | Instance self-resumes on reconnect                                  |
| **Hub command**    | Hub pushes `agent.pause` (manual via supervisor)             | Hub pushes `agent.resume` (manual via supervisor)                   |

**Instance-side behavior:**

- Instance tracks a set of active pause reasons per agent (e.g., `{ "cost_overrun", "hub_disconnect" }`)
- Agent is paused if the set is non-empty
- Adding a reason pauses; removing a reason only resumes if no other reasons remain
- When paused, the agent's command loop sleeps (no LLM calls, no commands)
- Buffered data (logs, costs) is still flushed on reconnect

**Cost tracking flow:**

1. Instance sends `cost.write` batches to hub (fire-and-forget)
2. Hub processes writes, updates DB, checks limits
3. If limit exceeded: hub pushes `agent.pause { reason: "cost_overrun" }`
4. When limit clears: hub pushes `agent.resume { reason: "cost_overrun" }`

No separate `cost.check` call. No network round-trip on the LLM hot path.

**Hub disconnect flow:**

1. Instance detects WebSocket disconnect
2. Instance adds `"hub_disconnect"` pause reason to all agents
3. All agents pause (no LLM calls while disconnected)
4. Fire-and-forget data continues to buffer
5. On reconnect: instance re-registers, flushes buffer, removes `"hub_disconnect"` reason
6. Agents resume (unless other pause reasons exist, e.g., cost overrun)

### Hub-Side Implementation

Hub API handlers are registered as Socket.IO event handlers on `naisysServer`. Each handler is a service that registers its events during hub startup. DB query logic moves from NAISYS services to hub services.

```
apps/hub/src/
  services/
    naisysServer.ts          # Socket.IO server for NAISYS connections (/naisys namespace) ✅
    naisysConnection.ts      # Per-instance connection handler ✅
    hostRegistrar.ts         # Tracks connected instances in DB (hosts table) ✅
    agentRegistrar.ts        # Seeds DB with agent configs from yaml ✅
    hostService.ts           # Hub host identity and DB record ✅
    hubServerLog.ts          # Logging ✅
  handlers/
    hubUserService.ts        # Handles user_list requests from instances ✅
    hubHeartbeatService.ts   # Processes heartbeat events ✅
    hubRunService.ts         # session.create, session.increment ✅
    hubLogService.ts         # log.write processing ✅
    hubMailService.ts        # mail.send, mail.list, mail.read, etc. (TODO)
    hubCostService.ts        # cost.write processing, cost.status push (TODO)
    hubAgentService.ts       # agent.subagents, agent.start routing (TODO)
```

Hub services use Prisma queries - essentially the same queries currently in NAISYS services. The logic moves; the queries stay the same. No separate `hubApiServer.ts` router needed -- Socket.IO event registration handles routing natively.

### Connection Lifecycle

```
NAISYS startup (hub mode):
  1. Connect to hub WebSocket (/naisys namespace)
  2. Auth handshake: { hostname, accessKey }
     -> hub validates accessKey matches its own HUB_ACCESS_KEY
     -> if invalid: error + disconnect, NAISYS startup fails
     -> if hostname is new: hub creates host entry in hosts table
     -> hub returns hostId
  3. Request user.list -> receive assigned/eligible agents with full configs
  4. For each agent: call session.create -> receive runId, sessionId
  5. Start agents via agent manager, begin heartbeat interval
  6. Agents run normally, all data operations go through hub API
  7. Hub may push additional agent.start / agent.stop at any time

Hub disconnect:
  1. Instance pauses all agents (adds "hub_disconnect" pause reason)
  2. Fire-and-forget writes continue to buffer in memory (bounded)
  3. Reconnect with exponential backoff
  4. On reconnect: re-register (idempotent), flush buffer, remove "hub_disconnect" pause
  5. Agents resume (unless other pause reasons exist)
  6. No catch-up needed - hub is the source of truth, instance has no state to sync
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

Establish the new architecture: remove sync, set up hub/client separation, create shared infrastructure.

**What was done:**

1. ✅ Removed multi-master sync infrastructure (~2,800 lines): `hubSyncServer.ts`, `hubSyncClient.ts`, `syncUtils.ts`, `hubForwardService.ts`, 3 integration tests
2. ✅ Replaced `isMultiMachineMode` with `isHubMode`
3. ✅ Renamed `agentRunner` → `agentManager`, `naisysRegistrar` → `hostRegistrar`
4. ✅ Created `@naisys/common` package with shared agent config schemas and loader
5. ✅ Created `naisysServer.ts`, `naisysConnection.ts`, `hostRegistrar.ts` on hub
6. ✅ NAISYS instances register as hosts in the existing `hosts` table; added `user_hosts` mapping table
7. ✅ Created `agentRegistrar.ts` on hub (seeds DB from yaml)
8. ✅ Hub startup requires `HUB_ACCESS_KEY`, NAISYS instance authenticates with it
9. ✅ NAISYS connects to single hub on startup (multiple URLs are fallback, not multi-hub)
10. ✅ Added `sendRequest<T>()` to `hubClient` for Promise-based request/response
11. ✅ Removed interhub scaffolding (`interhubServer.ts`, `interhubClient.ts`, `interhubConnection.ts`, `interhubClientLog.ts`) - hub-to-hub federation is out of scope

**Deviation from original plan:** The original plan had separate phases for "Hub API Layer" and "Runner Hub API Client." In practice, these were done together incrementally. Socket.IO's native event + ack pattern replaced the planned JSON-RPC protocol, eliminating the need for a separate `hubApiServer.ts` router or `hubApiClient.ts`. The existing `hubClient.sendRequest()` and `naisysServer.registerEvent()` serve these roles.

### Phase 2: Remove DB Dependencies from NAISYS (In Progress)

Replace each NAISYS service's DB usage with hub API calls (in hub mode) or in-memory equivalents (in local mode). Use `isHubMode` branching in each service. Do this one service at a time.

**Goal:** NAISYS operates without a local database.

**Approach:** Each service uses `isHubMode` to branch between hub API calls and local in-memory/yaml-based behavior. The `userService` is the template for this pattern.

Order of migration (roughly least to most complex):

1. ✅ **userService** -> In hub mode: request user list from hub via `user.list` event. In local mode: load from yaml files. Both cache in `Map<string, UserEntry>`.
2. **hostService** -> Remove from NAISYS. Instance has no local host concept. Auth handshake registers the instance's hostname in the hub's `hosts` table. Heartbeat replaces last_active updates. Note: `localHostId` is used by many services -- replace with `hostId` (from hub registration) or generated transient ID (local mode).
3. **runService** -> `session.create` + `session.increment`. Heartbeat covers last_active. In local mode: in-memory counters.
4. **logService** -> `log.write` (fire-and-forget batch). In local mode: no-op or console output.
5. **costTracker** -> `cost.write` (fire-and-forget batch) + listen for `agent.pause`/`agent.resume` push. Cost report via `cost.report` API. In local mode: in-memory running total.
6. **agentConfig** -> Config received from hub on agent start (via `user.list` or `agent.start` push). Cached in memory. In local mode: loaded from yaml.
7. **mailAddress** -> Username resolution moves to hub (part of `mail.send`). In local mode: resolve from in-memory user list.
8. **mailDisplayService** -> All queries become API calls (`mail.list`, `mail.read`, `mail.search`, `mail.users`). Hub returns raw data, client formats. In local mode: not available (no data to query).
9. **mail** -> `mail.send`, `mail.read` (mark as read), `mail.archive`, `mail.unread`. `mail.received` push replaces polling. In local mode: send-only, direct in-process delivery via event bus.
10. **subagent** -> `agent.subagents` for listing. `agent.start` request to hub for starting (hub routes to eligible host via `user_hosts`). In local mode: in-memory agent list from userService.

After all services migrated:

- Remove `@naisys/database` from naisys `package.json`
- Remove all `import { DatabaseService } from "@naisys/database"` from naisys
- Remove database initialization from `naisys.ts`
- The `@naisys/database` package becomes hub-only

### Phase 3: Cleanup & Renames

Final cleanup pass after all services are migrated.

1. Remove unused database types/imports from naisys
2. Remove `remoteAgentRequester.ts` if remote agent control is now hub-mediated
3. Remove `remoteAgentHandler.ts` if agent start/stop is now via hub push events
4. Update `hub-protocol` to remove old sync message types (catch_up, sync_request, sync_response, forward)
5. Verify `@naisys/database` is not in naisys dependency tree
6. Update supervisor if needed (should mostly just work since it reads hub DB)

---

## What Gets Removed (from NAISYS)

| Component                     | Before                                            | After                                                                 | Status |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `hubSyncClient.ts`            | Responds to sync requests, processes forwards     | Removed                                                               | ✅     |
| `interhub/` directory         | Hub-to-hub federation scaffolding                 | Removed (interhubServer, interhubClient, interhubConnection, log)     | ✅     |
| `syncUtils.ts` (NAISYS usage) | Query/upsert sync records                         | Removed from NAISYS                                                   | ✅     |
| `hubForwardService.ts`        | Forward queues for sync                           | Removed                                                               | ✅     |
| `remoteAgentRouter.ts`        | Hub-side routing of remote agent commands         | Removed (replaced by `naisysServer` event handlers)                   | ✅     |
| `agentRegistrar.ts` (NAISYS)  | NAISYS-side agent config scanning and DB sync     | Removed from NAISYS, rebuilt on hub as `agentRegistrar.ts`            | ✅     |
| Multi-hub connection          | NAISYS connects to multiple hubs                  | NAISYS connects to one hub (multiple URLs are fallback)               | ✅     |
| Schema version matching       | NAISYS/hub must match DB version                  | Not needed (API versioning)                                           | ✅     |
| Forward handling              | NAISYS upserts forwarded data                     | Not needed (hub is source of truth)                                   | ✅     |
| `@naisys/database` dependency | NAISYS imports Prisma, SQLite                     | Removed entirely                                                      |        |
| Database file                 | NAISYS has naisys.db                              | No local DB at all                                                    |        |
| Periodic mail polling         | 5-second interval checking for cross-machine mail | Hub pushes `mail.received` events                                     |        |
| Dual last_active updates      | hostService + runService both update every 2s     | Single heartbeat every 5-10s                                          |        |
| Host concept on NAISYS        | NAISYS registers as a host, tracks host_id        | Removed from NAISYS. Hub tracks hosts in `hosts` table                |        |
| `hostService.ts`              | Create/update host record, list hosts             | Removed from NAISYS. Auth handshake + heartbeat replaces it           |        |
| `remoteAgentRequester.ts`     | NAISYS asks hub to route agent commands           | Removed. `agent.start` request to hub, hub routes via `user_hosts`    |        |
| `remoteAgentHandler.ts`       | NAISYS handles incoming agent commands            | Replaced by hub push events (`agent.start`, `agent.stop`)             |        |
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

- [x] NAISYS instance self-registers on first connection (hub auto-creates host entry)
- [x] NAISYS instance connects to hub, authenticates with matching HUB_ACCESS_KEY
- [x] NAISYS instance with wrong HUB_ACCESS_KEY is rejected and disconnected
- [x] NAISYS instance receives assigned agents with full configs via user.list
- [ ] NAISYS instance starts assigned agents
- [ ] Agent logs and costs flow to hub (visible in supervisor)
- [ ] ns-mail send/list/read/archive/search work across instances
- [ ] ns-mail users shows all users from all instances
- [ ] Subagent start/stop works (local and remote via hub)
- [ ] Cost spend limits enforced via hub push (`cost.status`)
- [ ] ns-session compact works (new session created on hub)
- [ ] NAISYS instance reconnects after hub restart, resumes operation
- [ ] Buffered data (logs/costs) flushed after reconnect
- [ ] Hub pushes `mail.received` notifications (no polling)
- [ ] Supervisor shows live data from all instances
- [ ] Hub can start/stop agents on instance via push events
- [ ] ns-agent start in hub mode routes through hub to correct host via user_hosts
- [ ] Agent with no user_hosts entries can start on any connected host
- [ ] Agent assigned to specific hosts starts on first available connected host

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

1. **Local mode: no SQLite** - Break the SQLite/Prisma dependency from NAISYS entirely. In-memory data structures only. No shared schema between hub and NAISYS.

2. **Mail in local mode: send only** - `ns-mail send` routes directly to the target agent in-process. No list/read/search/archive. Sufficient for local dev/test.

3. **Pausing is first-class** - Agent pausing is a general mechanism with multiple triggers: cost overrun (hub pushes pause), hub disconnect (instance self-pauses), manual hub command. Instance tracks a set of pause reasons per agent and only resumes when all reasons are cleared.

4. **Hub disconnect: pause agents** - Instance pauses all agents on hub disconnect. Agents are not useful without the hub (no mail, no cost tracking, no session management). Fire-and-forget data buffers until reconnect. On reconnect, flush buffer and resume.

5. **Agent config in hub mode: hub-pushed** - Hub owns agent configs in its database. Configs pushed to instance when starting an agent. No yaml files on instance in hub mode. Yaml files can be imported/exported to the hub.

6. **Cost tracking: hub-pushed** - No separate spend-check call. Hub monitors costs from `cost.write` batches and pushes `agent.pause` / `agent.resume` when limits change.

7. **Hosts identify NAISYS instances** - Instances self-register into the existing `hosts` table on first connection. A `user_hosts` table maps which agents can run on which hosts. If a user has no `user_hosts` entries, they can run on any host. Both hub and instance have `HUB_ACCESS_KEY` in `.env`; if they match, the connection is accepted. A host is a naisys process instance - typically one per machine, but multiple on the same machine are supported.

8. **Hub routes agent starts** - In hub mode, `ns-agent start` sends a request to the hub. Hub looks up `user_hosts` (or considers all hosts if no entries), picks the first available connected host for that user, and pushes `agent.start` to it. In local mode, `ns-agent start` just starts the agent directly in-process.

9. **Display formatting: client-side** - Hub returns raw data for mail and cost queries. Client formats into tables/hierarchies. Standard API pattern, allows client-side logic on the data.

10. **Sync code: deleted** - Sync infrastructure was deleted (~2,800 lines). All sync-related indexes removed from the schema.

11. **No hub-to-hub federation** - Interhub scaffolding (`interhubServer.ts`, `interhubClient.ts`, `interhubConnection.ts`, `interhubClientLog.ts`) has been removed. Single hub architecture only. Federation is out of scope.

12. **Database package: hub-only** - `@naisys/database` is removed from NAISYS dependency. Hub is the sole consumer.

13. **Socket.IO events, not JSON-RPC** - Instead of a custom JSON-RPC protocol with correlation IDs, the hub API uses Socket.IO's native event + acknowledgement pattern. `hubClient.sendRequest<T>()` wraps acks in Promises for request-response. `hubClient.sendMessage()` is used for fire-and-forget. No custom framing or routing layer needed.

14. **User list separate from registration** - Rather than bundling the user list into the auth handshake response, a separate `user.list` event allows reloading user configs without reconnecting. Registration is handled during Socket.IO auth handshake.

15. **Hub services + handlers directories** - Hub infrastructure lives in `apps/hub/src/services/` (e.g., `naisysServer.ts`, `naisysConnection.ts`, `hostRegistrar.ts`). Hub API event handlers live in `apps/hub/src/handlers/` (e.g., `hubUserService.ts`, `hubRunService.ts`). Each handler registers its events on `naisysServer` during hub startup.

---

## Open Questions

1. **API versioning** - Replace schema_version matching with API version in the hub protocol? Hub could support multiple API versions for rolling upgrades. Simpler than requiring all instances to match DB schema.

2. **Agent config import/export** - What's the UX for getting yaml configs into/out of the hub? CLI command? Supervisor UI? Hub scans a folder on startup?

3. **Local mode pausing** - Should local mode support pausing (e.g., for in-memory cost limits), or is pausing hub-mode only?

4. **Host capacity** - When hub routes an `agent.start` to a host, how does it determine "first available"? Simple round-robin? Track running agent count per host? Max agents per host config?
