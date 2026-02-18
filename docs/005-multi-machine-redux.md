# NAISYS Multi-Machine Redux

**Status: In Progress**

## Problem Statement

The current multi-machine architecture (doc 001) works but is too complicated to develop, maintain, and operate:

### Complexity

- **Multi-master database sync** - Hubs and runners each have their own database. Databases are synced through the hub, essentially multi-master replication. The generic sync logic (timestamp tracking, catch-up, forward queues, stale joiner handling) was the most complex code in the system. Too clever by half, look at the old syncUtils.ts file for an example of how complex the system was - not maintainable.
- **Schema version coupling** - Database versions must match across all instances. Updating the cluster means updating all runners and hubs simultaneously and ensuring DB versions match before sync resumes.
- **Indirect data flow** - Online status is done by updating the local database and then syncing that around the network. Mail messages aren't sent like a message bus but also go through the sync mechanism. Everything is sync. NAISYS running without a hub connection, defining users, leads to easy network desyncs.
- **Host management** - Each naisys instance was a host, and agents are fixed to hosts. Changing the host of a user is a complex process. Mail has to be sent to user@host and when the host changes even mail sync becomes complex. Many edge cases with the cross-sync design.

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

| Term                | Meaning                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Hub**             | Central server (`naisys-hub`). Owns the database, controls what runs where                                             |
| **NAISYS instance** | A `naisys` process that connects to the hub as a client. Runs multiple agents via its agent manager. No local database |
| **Client**          | Synonym for NAISYS instance when emphasizing the hub connection                                                        |
| **Host**            | Database concept: a registered NAISYS instance in the `hosts` table                                                    |
| **Agent manager**   | Component within a NAISYS instance that manages running agents (`AgentManager`)                                        |

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
| `naisys --integrated-hub`      | Hub-controlled   | Creates both a NAISYS instance and hub and connects them    |
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
  HubEvents.USERS_UPDATED,
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

| Method       | Data             | Notes                                               |
| ------------ | ---------------- | --------------------------------------------------- |
| `log.write`  | context_log rows | Buffered, sent in batches every 1s. ✅ Done         |
| `cost.write` | costs rows       | Buffered, sent in batches every 2s. ✅ Done         |
| `heartbeat`  | activeUserIds[]  | Sent every 2s with list of active user IDs. ✅ Done |

#### Request-Response (must wait for reply)

| Method              | Params                                   | Returns            | Notes                                                                                                                                                                              |
| ------------------- | ---------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registration**    |                                          |                    |                                                                                                                                                                                    |
| (auth handshake)    | hostname, accessKey                      | hostId             | Handled during Socket.IO auth middleware. Hub validates accessKey, auto-creates host if name is new. ✅ Done                                                                       |
| `user.list`         | -                                        | users[]            | Returns all users assigned to (or allowed on) this host with full configs (username, configYaml, agentPath). Separate from registration to allow reload without reconnect. ✅ Done |
| **Session**         |                                          |                    |                                                                                                                                                                                    |
| `session.create`    | userId, modelName                        | runId, sessionId   | On agent start. ✅ Done                                                                                                                                                            |
| `session.increment` | userId, runId                            | sessionId          | On session compact. ✅ Done                                                                                                                                                        |
| **Mail**            |                                          |                    |                                                                                                                                                                                    |
| `mail.send`         | fromUserId, toUsernames[], subject, body | success/error      | Hub resolves usernames, creates records, notifies target instances. ✅ Done                                                                                                        |
| `mail.list`         | userId, filter?                          | raw message data   | Hub queries, returns raw data. Client formats for display. ✅ Done                                                                                                                 |
| `mail.read`         | userId, messageId                        | raw message data   | Hub marks as read, returns raw content. ✅ Done                                                                                                                                    |
| `mail.archive`      | userId, messageIds[]                     | success/error      | ✅ Done                                                                                                                                                                            |
| `mail.search`       | userId, terms, flags                     | raw results        | ✅ Done                                                                                                                                                                            |
| `mail.unread`       | userId                                   | unread message IDs | For notification checking. ✅ Done                                                                                                                                                 |
| **Agent**           |                                          |                    |                                                                                                                                                                                    |
| `agent.start`       | userId, taskDescription                  | success/error      | Hub resolves user, finds eligible host via user_hosts (or any host if unassigned), pushes agent.start to target instance. ✅ Done                                                  |
| `agent.stop`        | userId, reason                           | success/error      | Hub routes stop request to the host currently running the agent. ✅ Done                                                                                                           |

### Hub-Pushed Events

Hub pushes events to NAISYS instances over the WebSocket (no polling needed):

| Event              | Data                    | Trigger                                                   |
| ------------------ | ----------------------- | --------------------------------------------------------- |
| `config`           | global config object    | Hub pushes global config on connect                       |
| `user.list`        | users[]                 | Hub pushes user list on connect                           |
| `mail.received`    | recipientUserIds[]      | Hub processes a mail.send from any instance               |
| `agent.start`      | userId, taskDescription | Hub or supervisor requests agent start on this instance   |
| `agent.stop`       | userId, reason          | Hub or supervisor requests agent stop                     |
| `cost.control`     | userId, enabled, reason | Hub enforces spend limits. See Cost Control below         |
| `heartbeat.status` | activeUserIds[]         | Hub broadcasts aggregate active user IDs to all instances |

### Cost Control

Hub enforces spend limits via the `cost.control` push event. No separate spend-check call — no network round-trip on the LLM hot path.

**Cost tracking flow:**

1. Instance sends `cost.write` batches to hub (fire-and-forget, every 2s)
2. Hub processes writes, updates DB, checks global and per-agent spend limits (every 10s)
3. If limit exceeded: hub pushes `cost.control { userId, enabled: false, reason }`
4. When limit clears: hub pushes `cost.control { userId, enabled: true, reason }`

**Instance-side behavior:**

- `costTracker` listens for `COST_CONTROL` events from hub
- Stores a `hubCostControlReason` string (or undefined if spending is enabled)
- On `checkSpendLimit()`: if `hubCostControlReason` is set, throws to block LLM calls
- In local mode: enforces spend limits from config using in-memory period tracking

**Hub disconnect pause** — When a NAISYS instance loses its hub connection, `checkSpendLimit()` in `costTracker` throws because `hubClient.isConnected()` returns false, blocking LLM calls. On reconnect, the connection is restored, `isConnected()` returns true, and agents resume. Fire-and-forget data buffers in memory until reconnect, then flushes. ✅ Done

### Hub-Side Implementation

Hub API handlers are registered as Socket.IO event handlers on `naisysServer`. Each handler is a service that registers its events during hub startup. DB query logic moves from NAISYS services to hub services.

```
apps/hub/src/
  services/
    naisysServer.ts          # Socket.IO server for NAISYS connections (/naisys namespace) ✅
    naisysConnection.ts      # Per-instance connection handler ✅
    hostRegistrar.ts         # Tracks connected instances in DB (hosts table) ✅
    agentRegistrar.ts        # Seeds DB with agent configs from yaml ✅
    hubServerLog.ts          # Logging ✅
  handlers/
    hubConfigService.ts      # Pushes global config on client connect ✅
    hubUserService.ts        # Pushes user list on client connect ✅
    hubHeartbeatService.ts   # Processes heartbeat events, pushes aggregate status ✅
    hubRunService.ts         # session.create, session.increment ✅
    hubLogService.ts         # log.write processing ✅
    hubMailService.ts        # mail.send, mail.list, mail.read, etc. ✅
    hubCostService.ts        # cost.write processing, cost.control push ✅
    hubAgentService.ts       # agent.start, agent.stop routing ✅
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
  1. checkSpendLimit() blocks LLM calls when hubClient.isConnected() is false
  2. Fire-and-forget writes continue to buffer in memory
  3. Reconnect with exponential backoff (currently 2s fixed delay)
  4. On reconnect: re-register (idempotent), flush buffer, resume agents
  5. No catch-up needed - hub is the source of truth, instance has no state to sync
```

### Buffering & Resilience

For fire-and-forget data (logs, costs):

- Buffer in memory within each service
- Logs flush every 1s, costs flush every 2s
- On disconnect: buffer retains data; on reconnect: flush buffer
- Hub disconnect pause ensures agents stop generating data while disconnected (`checkSpendLimit()` blocks LLM calls), keeping buffer sizes small

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
9. ✅ NAISYS connects to a single hub URL on startup
10. ✅ Added `sendRequest<T>()` to `hubClient` for Promise-based request/response
11. ✅ Removed interhub scaffolding (`interhubServer.ts`, `interhubClient.ts`, `interhubConnection.ts`, `interhubClientLog.ts`) - hub-to-hub federation is out of scope

**Deviation from original plan:** The original plan had separate phases for "Hub API Layer" and "Runner Hub API Client." In practice, these were done together incrementally. Socket.IO's native event + ack pattern replaced the planned JSON-RPC protocol, eliminating the need for a separate `hubApiServer.ts` router or `hubApiClient.ts`. The existing `hubClient.sendRequest()` and `naisysServer.registerEvent()` serve these roles.

### Phase 2: Remove DB Dependencies from NAISYS ✅ Done

All NAISYS services migrated to use hub API calls (in hub mode) or in-memory equivalents (in local mode). Each service checks `if (hubClient)` to branch between hub and local behavior.

**Goal:** NAISYS operates without a local database. ✅ Achieved.

**Approach:** Each service checks `if (hubClient)` to branch between hub API calls and local in-memory/yaml-based behavior. `hubClient` is `undefined` in local mode.

**What was done:**

1. ✅ **userService** — Hub mode: receives user list from hub via `user.list` push event. Local mode: loads from yaml files. Both cache in `Map<string, UserEntry>`.
2. ✅ **hostService** — Removed from NAISYS entirely. Auth handshake registers the instance's hostname in the hub's `hosts` table. Heartbeat replaces last_active updates.
3. ✅ **runService** — Hub mode: `session.create` + `session.increment` via hub API. Local mode: in-memory counters (runId=1, sessionId increments locally).
4. ✅ **logService** — Hub mode: `log.write` fire-and-forget batch (flushed every 1s). Local mode: no-op.
5. ✅ **costTracker** — Hub mode: `cost.write` fire-and-forget batch (flushed every 2s) + listens for `cost.control` push from hub. Local mode: in-memory spend limit enforcement from config. Cost display always uses in-memory `modelCosts` map (no hub-side cost report needed).
6. ✅ **agentConfig** — Config received from hub via `user.list` push on connect. Cached in memory. Local mode: loaded from yaml files.
7. ✅ **mailAddress** — Removed from NAISYS. Username resolution handled by hub as part of `mail.send`.
8. ✅ **mailDisplayService** — Hub mode: all queries via hub API (`mail.list`, `mail.read`, `mail.search`). Hub returns raw data, client formats. Local mode: service not created (no data to query).
9. ✅ **mail** — Hub mode: `mail.send`, `mail.read`, `mail.archive`, `mail.unread` via hub API. `mail.received` push replaces polling. Local mode: send-only, direct in-process delivery via event bus.
10. ✅ **subagent** — Hub mode: `agent.start`/`agent.stop` routed through hub (hub picks eligible host via `user_hosts`). Listing uses in-memory user list from `userService` + heartbeat status for remote agents. Local mode: starts agents directly in-process.

**Post-migration cleanup:**

- ✅ Removed `@naisys/database` from naisys `package.json`
- ✅ Removed `DatabaseService` imports from naisys production code
- ✅ Removed database initialization from `naisys.ts`
- ✅ The `@naisys/database` package is now hub-only
- Note: Some test files (`__tests__/mocks.ts`, `__tests__/hub/testDbHelper.ts`) still import from `@naisys/database` for integration testing. `ulidTools.ts` imports `decodeTime` from `@naisys/common` (moved from database).

### Phase 3: Cleanup & Testing

Final cleanup and verification.

1. ✅ `remoteAgentRequester.ts` removed (agent control is now hub-mediated via `agent.start`/`agent.stop`)
2. ✅ `remoteAgentHandler.ts` removed (agent start/stop is now via hub push events)
3. ✅ Old sync message types removed from `hub-protocol`
4. ✅ `@naisys/database` is not in naisys dependency tree (production code)
5. ✅ Hub disconnect pause — `checkSpendLimit()` blocks LLM calls when hub is disconnected
6. TODO: Fix and update integration/e2e tests
7. TODO: Run regression testing checklist (see below)
8. TODO: Update supervisor if needed (should mostly just work since it reads hub DB)

---

## What Gets Removed (from NAISYS)

| Component                     | Before                                            | After                                                              | Status |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| `hubSyncClient.ts`            | Responds to sync requests, processes forwards     | Removed                                                            | ✅     |
| `interhub/` directory         | Hub-to-hub federation scaffolding                 | Removed (interhubServer, interhubClient, interhubConnection, log)  | ✅     |
| `syncUtils.ts` (NAISYS usage) | Query/upsert sync records                         | Removed from NAISYS                                                | ✅     |
| `hubForwardService.ts`        | Forward queues for sync                           | Removed                                                            | ✅     |
| `remoteAgentRouter.ts`        | Hub-side routing of remote agent commands         | Removed (replaced by `naisysServer` event handlers)                | ✅     |
| `agentRegistrar.ts` (NAISYS)  | NAISYS-side agent config scanning and DB sync     | Removed from NAISYS, rebuilt on hub as `agentRegistrar.ts`         | ✅     |
| Multi-hub connection          | NAISYS connects to multiple hubs                  | NAISYS connects to a single hub URL                                | ✅     |
| Schema version matching       | NAISYS/hub must match DB version                  | Not needed (API versioning)                                        | ✅     |
| Forward handling              | NAISYS upserts forwarded data                     | Not needed (hub is source of truth)                                | ✅     |
| `@naisys/database` dependency | NAISYS imports Prisma, SQLite                     | Removed entirely (hub-only now)                                    | ✅     |
| Database file                 | NAISYS has naisys.db                              | No local DB at all                                                 | ✅     |
| Periodic mail polling         | 5-second interval checking for cross-machine mail | Hub pushes `mail.received` events                                  | ✅     |
| Dual last_active updates      | hostService + runService both update every 2s     | Single heartbeat every 2s                                          | ✅     |
| Host concept on NAISYS        | NAISYS registers as a host, tracks host_id        | Removed from NAISYS. Hub tracks hosts in `hosts` table             | ✅     |
| `hostService.ts`              | Create/update host record, list hosts             | Removed from NAISYS. Auth handshake + heartbeat replaces it        | ✅     |
| `remoteAgentRequester.ts`     | NAISYS asks hub to route agent commands           | Removed. `agent.start` request to hub, hub routes via `user_hosts` | ✅     |
| `remoteAgentHandler.ts`       | NAISYS handles incoming agent commands            | Replaced by hub push events (`agent.start`, `agent.stop`)          | ✅     |
| `mailAddress.ts` (DB queries) | Resolve usernames via local DB                    | Hub resolves usernames in `mail.send`                              | ✅     |

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
- [ ] Cost spend limits enforced via hub push (`cost.control`)
- [ ] ns-session compact works (new session created on hub)
- [ ] NAISYS instance reconnects after hub restart, resumes operation
- [ ] Buffered data (logs/costs) flushed after reconnect
- [x] Hub pushes `mail.received` notifications (no polling) — `basic-mail.e2e.test.ts` integrated-hub test
- [ ] Supervisor shows live data from all instances
- [ ] Hub can start/stop agents on instance via push events
- [ ] ns-agent start in hub mode routes through hub to correct host via user_hosts
- [ ] Agent with no user_hosts entries can start on any connected host
- [ ] Agent assigned to specific hosts starts on first available connected host

### Local Ephemeral Mode

- [x] `naisys` starts without any hub config — `basic-mail.e2e.test.ts` standalone test
- [x] No database file created, no Prisma/SQLite loaded — `basic-mail.e2e.test.ts` standalone test
- [x] Multiple agents run in same process — `basic-mail.e2e.test.ts` standalone test
- [x] `ns-mail send` delivers message directly to target agent — `basic-mail.e2e.test.ts` standalone test
- [x] Agent configs loaded from yaml files — `basic-mail.e2e.test.ts` standalone test
- [x] Clean restart - no leftover state — `basic-mail.e2e.test.ts` standalone test (fresh temp dir per run)

### scdb Regression

- [ ] Can it run with hub?
- [ ] Can it run without hub ephemerally?

---

## Decisions

Answers to design questions resolved during planning:

1. **Local mode: no SQLite** - Break the SQLite/Prisma dependency from NAISYS entirely. In-memory data structures only. No shared schema between hub and NAISYS.

2. **Mail in local mode: send only** - `ns-mail send` routes directly to the target agent in-process. No list/read/search/archive. Sufficient for local dev/test.

3. **Cost control is hub-pushed** - Hub monitors costs from `cost.write` batches and pushes `cost.control` events with `{ userId, enabled, reason }`. Instance stores the reason and throws on `checkSpendLimit()` when disabled. No general multi-reason pause system — cost control is a simple enabled/disabled flag per agent.

4. **Hub disconnect: pause agents** - `checkSpendLimit()` in `costTracker` throws when `hubClient.isConnected()` returns false, blocking LLM calls while disconnected. Fire-and-forget data buffers until reconnect. On reconnect, flush buffer and resume. ✅ Done

5. **Agent config in hub mode: hub-pushed** - Hub owns agent configs in its database. Configs pushed to instance when starting an agent. No yaml files on instance in hub mode. Yaml files can be imported/exported to the hub.

6. **Cost tracking: hub-pushed** - No separate spend-check call. Hub monitors costs from `cost.write` batches and pushes `cost.control` (enabled/disabled) when limits change.

7. **Hosts identify NAISYS instances** - Instances self-register into the existing `hosts` table on first connection. A `user_hosts` table maps which agents can run on which hosts. If a user has no `user_hosts` entries, they can run on any host. Both hub and instance have `HUB_ACCESS_KEY` in `.env`; if they match, the connection is accepted. A host is a naisys process instance - typically one per machine, but multiple on the same machine are supported.

8. **Hub routes agent starts** - In hub mode, `ns-agent start` sends a request to the hub. Hub looks up `user_hosts` (or considers all hosts if no entries), picks the first available connected host for that user, and pushes `agent.start` to it. In local mode, `ns-agent start` just starts the agent directly in-process.

9. **Display formatting: client-side** - Hub returns raw data for mail queries. Client formats into tables/hierarchies. Cost display uses in-memory data (no hub-side cost report). Standard API pattern.

10. **Sync code: deleted** - Sync infrastructure was deleted (~2,800 lines). All sync-related indexes removed from the schema.

11. **No hub-to-hub federation** - Interhub scaffolding (`interhubServer.ts`, `interhubClient.ts`, `interhubConnection.ts`, `interhubClientLog.ts`) has been removed. Single hub architecture only. Federation is out of scope.

12. **Database package: hub-only** - `@naisys/database` is removed from NAISYS dependency. Hub is the sole consumer.

13. **Socket.IO events, not JSON-RPC** - Instead of a custom JSON-RPC protocol with correlation IDs, the hub API uses Socket.IO's native event + acknowledgement pattern. `hubClient.sendRequest<T>()` wraps acks in Promises for request-response. `hubClient.sendMessage()` is used for fire-and-forget. No custom framing or routing layer needed.

14. **User list separate from registration** - Rather than bundling the user list into the auth handshake response, a separate `user.list` event allows reloading user configs without reconnecting. Registration is handled during Socket.IO auth handshake.

15. **Hub services + handlers directories** - Hub infrastructure lives in `apps/hub/src/services/` (e.g., `naisysServer.ts`, `naisysConnection.ts`, `hostRegistrar.ts`). Hub API event handlers live in `apps/hub/src/handlers/` (e.g., `hubUserService.ts`, `hubRunService.ts`). Each handler registers its events on `naisysServer` during hub startup.

---

## Open Questions

1. **API versioning** - Replace schema_version matching with API version in the hub protocol? Hub could support multiple API versions for rolling upgrades. Simpler than requiring all instances to match DB schema.

2. **Agent config import/export** - What's the UX for getting yaml configs into/out of the hub? CLI command? Supervisor UI? Currently hub scans a yaml folder on startup via `agentRegistrar`.

3. **Host capacity** - When hub routes an `agent.start` to a host, how does it determine "first available"? Currently routes to least-loaded host based on heartbeat data. May need max agents per host config.
