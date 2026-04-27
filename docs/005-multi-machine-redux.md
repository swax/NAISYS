# NAISYS Multi-Machine Architecture

Reference for how the NAISYS multi-machine architecture works today: a single hub that owns the database and a set of NAISYS instances that connect to it as lightweight, stateless clients. The doc started life as a design plan; the migration history (phases, what was removed, regression checklist) has been pruned now that the work is done. The "Decisions" section at the bottom records the design choices that landed.

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
3. **No shared DB schema** - The `@naisys/hub-database` package is hub-only at runtime. NAISYS production code has no database dependency. It talks to the hub via the WebSocket API. (Test fixtures still import the package to spin up a hub for integration tests.)
4. **No multi-mastering** - One source of truth per deployment. Hub DB for multi-machine, in-memory for local.
5. **Explicit control model** - Either "local controlled" (standalone, ephemeral) or "hub controlled" (persistent, managed).
6. **Hosts identify NAISYS instances** - Each NAISYS instance is assigned a hostname and self-registers into the existing `hosts` table on first connection. A `user_hosts` table maps which users (agents) can run on which hosts. If a user has no `user_hosts` entries, they can run on any host. A host is a naisys process instance - typically one per machine, but multiple instances on the same machine are supported.
7. **Hub routes agent starts** - In hub mode, `ns-agent start` sends an `agent_start` request to the hub. Hub picks the least-loaded host the user is assigned to (or any non-restricted host if unassigned) and relays `agent_start` to that host. The target may be the requesting instance or a different one.

### Deployment Modes

| Command                                | Mode             | Description                                                                  |
| -------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `naisys`                               | Local            | Standalone, ephemeral, yaml-driven, no database, no network                  |
| `naisys --hub=http://host:3300`        | Hub-controlled   | Connects to an external hub, hub manages agents and all data                 |
| `naisys --integrated-hub`              | Hub-controlled   | Starts a hub in-process and connects to it (saves memory on small servers)   |
| `naisys --integrated-hub --supervisor` | Hub + Supervisor | Integrated hub with the Supervisor web UI mounted on the same Fastify server |
| `naisys-hub`                           | Hub              | Standalone hub server (Socket.IO + Fastify) with database                    |
| `naisys-hub --supervisor`              | Hub + Supervisor | Hub with Supervisor web UI                                                   |
| `naisys-hub --supervisor --erp`        | Hub + Sup + ERP  | Adds the ERP app alongside the supervisor (requires `--supervisor`)          |

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

Local mode has **no database, no Prisma, no SQLite**. NAISYS production code does not import `@naisys/hub-database`. All state is in-memory data structures that exist only for the lifetime of the process.

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

| Service            | Local Mode Behavior                            |
| ------------------ | ---------------------------------------------- |
| `logService`       | No-op (or write to console/file)               |
| `costTracker`      | In-memory running total, no persistence        |
| `runService`       | In-memory run/session counters                 |
| `hostService`      | Not needed (no host concept)                   |
| `mail`             | Send-only, direct in-process delivery          |
| `mailQueryService` | Not available (no data to query)               |
| `subagent`         | In-memory agent list from yaml configs         |
| `agentConfig`      | Loaded from yaml file, kept in memory          |
| `agentRegistrar`   | Scans yaml folder, builds in-memory agent list |

---

## Hub-Controlled Mode

### Design

NAISYS instance connects to hub via WebSocket as a client. All data operations go through the hub API. The instance has no local database. The hub owns the database, manages all persistent state, and controls which agents run on which instances.

### Hub Database: Hosts & Assignment

The hub database uses the existing `hosts` table for NAISYS instance tracking, plus a `user_hosts` mapping table:

```
hosts
  id           Int       @id @default(autoincrement())
  name         String    @unique          // NAISYS_HOSTNAME
  machine_id   String?   @unique          // Stable per-machine UUID (sticks across hostname changes)
  restricted   Boolean   @default(false)  // If true, only users in user_hosts may run here
  host_type    HostType  @default(naisys) // "naisys" or "supervisor"
  last_ip      String?
  last_version String?
  environment  String?                    // JSON: { platform, osVersion, shell, arch, nodeVersion }
  last_active  DateTime?                  // Updated from heartbeat
  created_at   DateTime  @default(now())

user_hosts
  user_id     Int
  host_id     Int
  created_at  DateTime @default(now())
  @@id([user_id, host_id])                // Composite primary key
```

- Both hub and NAISYS instance have `HUB_ACCESS_KEY` in their `.env` files. If they match, the connection is accepted
- Hosts are not pre-registered. On first connection, hub creates the host entry automatically using the instance's hostname (and `machine_id` if provided). The hub pushes a targeted `host_registered` event back to the new client with its assigned `machineId` and `hostname`
- Supervisor connections also register in the `hosts` table (with `host_type = supervisor`), so the supervisor UI is treated as a first-class connected client for routing/topology purposes
- Users (agents) can be assigned to specific hosts via `user_hosts`. A user with no `user_hosts` entries can run on any non-restricted host. A host with `restricted = true` only runs users that are explicitly assigned to it
- On connection, hub validates the access key, auto-creates the host if new, and pushes `users_updated` containing the configs for users eligible to run on that host

### Agent Start Flow (Hub Mode)

When an agent calls `ns-agent start <username>`:

```
1. NAISYS instance sends agent_start request to hub (Socket.IO ack)
2. Hub looks up the user
3. Hub queries user_hosts for assigned hosts (if none, all non-restricted hosts are eligible)
4. Hub picks the least-loaded connected eligible host based on heartbeat data
   (could be the same instance or a different one)
5. Hub relays agent_start { userId, taskDescription } to target instance (Socket.IO ack)
6. Target instance's AgentManager handles the event and starts the agent locally
```

In local mode, `ns-agent start` just starts the agent directly in-process via the local `AgentManager`. No hub involved.

### Hub API Protocol

Uses Socket.IO's native event + acknowledgement pattern over the existing WebSocket connection. Each API method is a named Socket.IO event defined in `packages/hub-protocol/src/events.ts` as the `HubEvents` constant. No custom JSON-RPC framing needed — Socket.IO handles correlation and callbacks natively.

Event names are snake_case strings (`mail_send`, `users_updated`, `cost_control`, etc.). The `HubEvents` enum provides the canonical names; this doc uses those names throughout.

**Request-response** (client → hub, awaits ack):

```typescript
// Client side: hubClient.sendRequest<E>(event, payload) returns Promise<Response>
// Uses Socket.IO's built-in acknowledgement callbacks for correlation
// 30-second timeout; rejects if not connected
const response = await hubClient.sendRequest(HubEvents.MAIL_LIST, {
  userId,
  filter,
});
```

**Fire-and-forget** (client → hub, no ack):

```typescript
// Client side: hubClient.sendMessage(event, payload) — returns false if not connected
hubClient.sendMessage(HubEvents.LOG_WRITE, { entries: [...] });
```

**Hub-pushed events** (hub → client):

```typescript
// Hub side: naisysServer.broadcastToAll(event, data) or targeted via connection
// Client side: hubClient.registerEvent(event, handler)
```

Hub handlers are registered on `naisysServer` as named event handlers with Zod schema validation (schemas live in `hub-protocol`). Each handler receives `(hostId, data, ack?)` and calls `ack(response)` for request-response or omits it for fire-and-forget. Push events are produced by hub services calling `broadcastToAll` or by emitting directly on a specific socket.

### API Methods

#### Fire-and-Forget (NAISYS → Hub, no ack)

High-frequency writes that don't need confirmation. Client buffers and sends periodically (typically every 1–2 seconds or when buffer is full).

| Event        | Data                                    | Notes                                                                       |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------- |
| `log_write`  | context_log row batch                   | Batched in `hubLogBuffer`, flushed ~1s                                      |
| `cost_write` | cost row batch                          | Batched in `hubCostBuffer`, flushed ~2s                                     |
| `heartbeat`  | active user IDs + per-run session state | Sent every 2s; carries pause/run state so supervisor sees live agent status |

#### Request-Response (NAISYS → Hub, awaits ack)

| Event                                                            | Params                                   | Returns          | Notes                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Registration**                                                 |                                          |                  |                                                                                                                      |
| (auth handshake)                                                 | hostname, machineId, accessKey           | accepted/error   | Handled during Socket.IO auth middleware. Hub validates `HUB_ACCESS_KEY`, auto-creates host if name/machineId is new |
| **Session**                                                      |                                          |                  |                                                                                                                      |
| `session_create`                                                 | userId, modelName                        | runId, sessionId | On agent start                                                                                                       |
| `session_increment`                                              | userId, runId                            | sessionId        | On session compact                                                                                                   |
| **Mail**                                                         |                                          |                  |                                                                                                                      |
| `mail_send`                                                      | fromUserId, toUsernames[], subject, body | success/error    | Hub resolves usernames, creates records, pushes `mail_received` to target hosts                                      |
| `mail_list`                                                      | userId, filter?                          | raw message data | Hub queries, returns raw data. Client formats for display                                                            |
| `mail_peek`                                                      | userId, messageId                        | raw message data | Fetches a message without marking it read (split from the original `mail.read`)                                      |
| `mail_mark_read`                                                 | userId, messageIds[]                     | success/error    | Marks messages as read (the second half of the original `mail.read`)                                                 |
| `mail_archive`                                                   | userId, messageIds[]                     | success/error    |                                                                                                                      |
| `mail_search`                                                    | userId, terms, flags                     | raw results      |                                                                                                                      |
| `mail_unread`                                                    | userId                                   | unread messages  | For notification checking                                                                                            |
| **Agent control (two-hop relay: requester → hub → target host)** |                                          |                  |                                                                                                                      |
| `agent_start`                                                    | userId, taskDescription                  | success/error    | Hub finds eligible host via `user_hosts` (or any non-restricted host if unassigned), relays to target                |
| `agent_stop`                                                     | userId, reason                           | success/error    | Hub routes stop request to the host currently running the agent                                                      |
| `agent_run_pause`                                                | userId                                   | success/error    | Forces the agent's command loop into an indefinite wait                                                              |
| `agent_run_resume`                                               | userId                                   | success/error    | Resumes a paused run                                                                                                 |
| `agent_run_command`                                              | userId, command                          | success/error    | Sends a command into the agent's active session (used by supervisor debug)                                           |
| `agent_peek`                                                     | userId                                   | output snapshot  | Peeks at the agent's current output buffer                                                                           |
| **Admin (Supervisor → Hub)**                                     |                                          |                  |                                                                                                                      |
| `rotate_access_key`                                              | -                                        | new key          | Rotates `HUB_ACCESS_KEY` (admin-only)                                                                                |

### Hub-Pushed Events

Hub pushes events over the WebSocket (no polling needed). Some events are broadcast to all clients, some are targeted, and some go only to supervisor connections.

#### To all NAISYS clients (broadcast)

| Event               | Data                                       | Trigger                                                                           |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `users_updated`     | users[] with full configs                  | On client connect, and whenever the supervisor changes users (`users_changed`)    |
| `hosts_updated`     | connected host topology                    | On connect, and on host changes (`hosts_changed`)                                 |
| `variables_updated` | global config (shell limits, spend limits) | On connect, and on variable changes (`variables_changed`)                         |
| `models_updated`    | LLM and image model definitions            | On connect, and on model changes (`models_changed`)                               |
| `agents_status`     | aggregate active-agent map + counters      | Periodically and on agent state changes (replaces the planned `heartbeat.status`) |

#### Targeted to a specific NAISYS client

| Event             | Data                    | Trigger                                                              |
| ----------------- | ----------------------- | -------------------------------------------------------------------- |
| `host_registered` | machineId, hostname     | Sent to a newly connected client with its assigned identity          |
| `cost_control`    | userId, enabled, reason | Spend-limit enforcement, sent to the host running the affected agent |
| `mail_received`   | recipient user IDs      | New mail notification, sent to hosts running recipient agents        |

The relayed agent-control requests (`agent_start`, `agent_stop`, `agent_run_pause`, `agent_run_resume`, `agent_run_command`, `agent_peek`) also arrive at the target NAISYS instance as Socket.IO events with acks; the `AgentManager` registers handlers for each.

#### Supervisor-only push events

The supervisor backend connects to the hub as a Socket.IO client with `host_type = supervisor`. It receives the broadcasts above plus these incremental data-stream events:

| Event               | Data                                 | Trigger                                     |
| ------------------- | ------------------------------------ | ------------------------------------------- |
| `log_push`          | context_log entries + session deltas | Periodic flush after `log_write` ingestion  |
| `mail_push`         | new mail message data                | After `mail_send` is processed              |
| `mail_read_push`    | read-receipt deltas                  | After `mail_mark_read`                      |
| `cost_push`         | cost deltas per session              | Periodic flush after `cost_write` ingestion |
| `session_push`      | new RunSession                       | After `session_create`/`session_increment`  |
| `session_heartbeat` | per-session lastActive bumps         | Per heartbeat tick                          |

#### Supervisor → Hub triggers (fire-and-forget)

Sent by the supervisor when it has mutated the database directly and wants the hub to refresh and re-broadcast:

| Event               | Triggers broadcast of |
| ------------------- | --------------------- |
| `users_changed`     | `users_updated`       |
| `variables_changed` | `variables_updated`   |
| `models_changed`    | `models_updated`      |
| `hosts_changed`     | `hosts_updated`       |

### Cost Control

Hub enforces spend limits via the `cost_control` push event. No separate spend-check call — no network round-trip on the LLM hot path.

**Cost tracking flow:**

1. Instance sends `cost_write` batches to hub (fire-and-forget, every ~2s)
2. Hub processes writes, updates DB, checks global and per-agent spend limits
3. If limit exceeded: hub pushes `cost_control { userId, enabled: false, reason }` to the host running the agent
4. When limit clears: hub pushes `cost_control { userId, enabled: true, reason }`

**Instance-side behavior:**

- `costTracker` listens for `cost_control` events from hub
- Stores a `hubCostControlReason` string (or undefined if spending is enabled)
- On `checkSpendLimit()`: if `hubCostControlReason` is set, throws to block LLM calls
- In local mode: enforces spend limits from config using in-memory period tracking

**Hub disconnect pause** — When a NAISYS instance loses its hub connection, `checkSpendLimit()` in `costTracker` throws because `hubClient.isConnected()` returns false, blocking LLM calls. On reconnect, the connection is restored, `isConnected()` returns true, and agents resume. Fire-and-forget data buffers in memory until reconnect, then flushes.

### Hub-Side Implementation

Hub API handlers are registered as Socket.IO event handlers on `naisysServer`. Each handler is a service that registers its events during hub startup. DB query logic that used to live in NAISYS services now lives in hub services.

```
apps/hub/src/
  naisysHub.ts               # Hub entry point + commander CLI; exports startHub()
  services/
    naisysServer.ts          # Socket.IO server, event registration/dispatch, auth middleware
    naisysConnection.ts      # Per-client connection lifecycle, forwards events to dispatcher
    hostRegistrar.ts         # Auto-creates host entries on first connect, tracks online status
    agentRegistrar.ts        # Seeds DB with agent configs from yaml at startup
    accessKeyService.ts      # HUB_ACCESS_KEY rotation
  handlers/
    hubConfigService.ts      # variables_updated (global config) push
    hubUserService.ts        # users_updated push on connect / on supervisor change
    hubHostService.ts        # hosts_updated broadcast
    hubModelsService.ts      # models_updated push
    hubHeartbeatService.ts   # heartbeat ingestion + agents_status broadcast
    hubRunService.ts         # session_create, session_increment
    hubLogService.ts         # log_write ingestion + log_push to supervisors
    hubMailService.ts        # mail_send/list/peek/mark_read/archive/search/unread + mail_received push
    hubSendMailService.ts    # Auxiliary mail send service (auto-starts agents if needed)
    hubCostService.ts        # cost_write ingestion + cost_control push + cost_push to supervisors
    hubAgentService.ts       # agent_start/stop/run_pause/run_resume/run_command/peek (routing + relay)
    hubAccessKeyService.ts   # rotate_access_key admin handler
    hubAttachmentService.ts  # Mail/context attachment uploads
```

Hub services use Prisma queries — essentially the same queries that used to live in NAISYS services. The logic moved; the queries stayed. No separate `hubApiServer.ts` router was needed — Socket.IO event registration handles routing natively.

### Connection Lifecycle

```
NAISYS startup (hub mode):
  1. Connect to hub WebSocket (/hub namespace)
  2. Auth handshake (Socket.IO middleware): { hostname, machineId, accessKey, version, ... }
     -> hub validates accessKey matches its own HUB_ACCESS_KEY
     -> if invalid: error + disconnect, NAISYS startup fails
     -> if hostname/machineId is new: hub creates host entry in hosts table
  3. Hub pushes initial state: host_registered (targeted), users_updated, hosts_updated,
     variables_updated, models_updated
  4. For each lead agent the instance starts: call session_create -> receive runId, sessionId
  5. Start agents via AgentManager, begin heartbeat interval (every 2s)
  6. Agents run normally, all data operations go through hub API
  7. Hub may push agent_start / agent_stop / agent_run_pause / etc. at any time

Hub disconnect:
  1. checkSpendLimit() blocks LLM calls when hubClient.isConnected() is false
  2. Fire-and-forget writes continue to buffer in memory (logs, costs)
  3. Reconnect with backoff
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

## Decisions

Answers to design questions resolved during planning:

1. **Local mode: no SQLite** - Break the SQLite/Prisma dependency from NAISYS entirely. In-memory data structures only. No shared schema between hub and NAISYS.

2. **Mail in local mode: send only** - `ns-mail send` routes directly to the target agent in-process. No list/read/search/archive. Sufficient for local dev/test.

3. **Cost control is hub-pushed** - Hub monitors costs from `cost_write` batches and pushes `cost_control` events with `{ userId, enabled, reason }` to the host running the agent. Instance stores the reason and throws on `checkSpendLimit()` when disabled. No general multi-reason pause system — cost control is a simple enabled/disabled flag per agent.

4. **Hub disconnect: pause agents** - `checkSpendLimit()` in `costTracker` throws when `hubClient.isConnected()` returns false, blocking LLM calls while disconnected. Fire-and-forget data buffers until reconnect. On reconnect, flush buffer and resume.

5. **Agent config in hub mode: hub-pushed** - Hub owns agent configs in its database. Configs are pushed to instances via `users_updated` on connect and whenever they change. No yaml files on instance in hub mode. Yaml files can be imported/exported to the hub via `agentRegistrar`.

6. **Cost tracking: hub-pushed** - No separate spend-check call. Hub monitors costs from `cost_write` batches and pushes `cost_control` (enabled/disabled) when limits change.

7. **Hosts identify NAISYS instances** - Instances self-register into the existing `hosts` table on first connection (via auth handshake). A `user_hosts` table maps which agents can run on which hosts. If a user has no `user_hosts` entries, they can run on any non-restricted host; a host with `restricted = true` only accepts assigned users. Both hub and instance have `HUB_ACCESS_KEY` in `.env`; if they match, the connection is accepted. A host is typically one per machine but multiple on the same machine are supported (distinguished by `machine_id`). The supervisor connects as a host too, with `host_type = supervisor`.

8. **Hub routes agent starts** - In hub mode, `ns-agent start` sends an `agent_start` request to the hub. Hub looks up `user_hosts` (or considers all non-restricted hosts if no entries), picks the least-loaded eligible connected host based on heartbeat data, and relays `agent_start` to it. In local mode, `ns-agent start` just starts the agent directly in-process.

9. **Display formatting: client-side** - Hub returns raw data for mail queries. Client formats into tables/hierarchies. Cost display uses in-memory data (no hub-side cost report). Standard API pattern.

10. **Sync code: deleted** - Sync infrastructure was deleted (~2,800 lines). All sync-related indexes removed from the schema.

11. **No hub-to-hub federation** - Interhub scaffolding (`interhubServer.ts`, `interhubClient.ts`, `interhubConnection.ts`, `interhubClientLog.ts`) has been removed. Single hub architecture only. Federation is out of scope.

12. **Database package: hub-only at runtime** - `@naisys/hub-database` is not imported by NAISYS production code. It still appears in `apps/naisys/package.json` because integration test fixtures need it to spin up a hub for testing. Hub is the sole runtime consumer.

13. **Socket.IO events, not JSON-RPC** - Instead of a custom JSON-RPC protocol with correlation IDs, the hub API uses Socket.IO's native event + acknowledgement pattern. `hubClient.sendRequest<E>()` wraps acks in Promises for request-response (with a 30s timeout). `hubClient.sendMessage()` is used for fire-and-forget. No custom framing or routing layer needed. Event names are defined as constants in `packages/hub-protocol/src/events.ts`.

14. **User list pushed, not requested** - Rather than a request-response `user.list` API, the hub pushes `users_updated` on connect (and whenever the supervisor signals `users_changed`). Same pattern for `hosts_updated`, `variables_updated`, `models_updated`. Registration is handled during Socket.IO auth handshake.

15. **Hub services + handlers directories** - Hub infrastructure lives in `apps/hub/src/services/` (e.g., `naisysServer.ts`, `naisysConnection.ts`, `hostRegistrar.ts`, `agentRegistrar.ts`, `accessKeyService.ts`). Hub API event handlers live in `apps/hub/src/handlers/` (e.g., `hubUserService.ts`, `hubRunService.ts`, `hubAgentService.ts`). Each handler registers its events on `naisysServer` during hub startup.

16. **Supervisor as a hub client** - The supervisor backend is a Socket.IO client of the hub (with `host_type = supervisor`). It receives the same broadcasts as NAISYS clients plus a set of supervisor-only push events (`log_push`, `mail_push`, `mail_read_push`, `cost_push`, `session_push`, `session_heartbeat`) carrying full incremental data for the live UI. When the supervisor mutates the DB directly, it sends fire-and-forget triggers (`users_changed`, `variables_changed`, `models_changed`, `hosts_changed`) to make the hub re-broadcast.

---

## Open Questions

1. **API versioning** - Replace schema_version matching with API version in the hub protocol? Hub could support multiple API versions for rolling upgrades. Simpler than requiring all instances to match DB schema.

2. **Agent config import/export** - What's the UX for getting yaml configs into/out of the hub? CLI command? Supervisor UI? Currently hub scans a yaml folder on startup via `agentRegistrar`.

3. **Host capacity** - When hub routes an `agent_start` to a host, how does it determine "first available"? Currently routes to least-loaded host based on heartbeat data. May need a max-agents-per-host config knob.
