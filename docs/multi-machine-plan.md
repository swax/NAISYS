# NAISYS Multi-Machine Architecture Plan

## Overview

Transform NAISYS from a single-machine agent runner to a distributed system with three components:

- **Runner** - Lightweight agent runner (npm install and go)
- **Hub** - WebSocket sync server, forwards data between runners
- **Supervisor** - Web UI for viewing agents, logs, mail, costs

Components can run together (same process) or separately:

| Command | Components | Use Case |
|---------|------------|----------|
| `naisys.js` | Runner only | Standalone agent runner |
| `naisys.js --supervisor` | Runner + Supervisor | Single-runner with UI |
| `naisys.js --hub --supervisor` | Runner + Hub + Supervisor | All-in-one on small VPS |
| `naisys_hub.js` | Hub only | Dedicated sync server |
| `naisys_hub.js --supervisor` | Hub + Supervisor | Central management |
| `naisys_supervisor.js` | Supervisor only | UI pointing at any DB |

## Design Principles

1. **Standalone First** - Runners work fully without Hub/Supervisor
2. **Optional Hub** - Hub enables cross-machine features when configured
3. **No Coordination for IDs** - ULIDs for globally unique, sortable IDs
4. **Centralized Data** - Hub receives all logs/costs for unified querying
5. **Process Flexibility** - Components run together or separately for memory efficiency
6. **Direct Ownership** - Every syncable row has `host_id` marking its owner (no joins needed)

## Related Documents

- [Revised LLMail Plan](./revised-llmail-plan.md) - Simplified mail schema for multi-machine sync

---

## Phase 1: ULID Migration & Schema Updates

Convert all IDs from INTEGER AUTOINCREMENT to ULID strings. Add `host_id` and `updated_at` to all syncable tables.

### Schema Changes (`packages/database/prisma/schema.prisma`)

```prisma
# Tables requiring ID changes:
- users.id: Int → String (ULID)
- context_log.id: Int → String (ULID)
- costs.id: Int → String (ULID)

# run_session keeps composite key but references updated user_id

# Add host_id to ALL syncable tables (direct ownership, no joins needed):
- hosts: id is the host_id (self-referential)
- users: host_id (which host owns this agent)
- user_notifications: host_id (same as user's host)
- mail_messages: host_id (sender's host)
- mail_recipients: host_id (sender's host, same as message)
- mail_status: host_id (recipient's host)
- run_session: host_id (which host ran this session)
- costs: host_id (which host incurred this cost)
- context_log: host_id (which host generated this log)

# Add updated_at for sync (all syncable tables):
- hosts: updated_at DateTime @updatedAt
- users: updated_at DateTime @updatedAt
- user_notifications: updated_at DateTime @updatedAt
- mail_messages: updated_at DateTime @updatedAt
- mail_recipients: updated_at DateTime @updatedAt
- mail_status: updated_at DateTime @updatedAt
- run_session: updated_at DateTime @updatedAt
- costs: updated_at DateTime @updatedAt
- context_log: updated_at DateTime @updatedAt

# Add deleted_at for soft deletes:
- users: add deleted_at DateTime? (deactivated agents)

Note: Only active operations filter by deleted_at (starting agents, sending mail). Historical queries still return deleted records.

# Sync query for ALL tables is now uniform:
WHERE host_id = :localHostId AND updated_at > :since

Note: For context_log, use monotonic ULID generation to preserve strict ordering within a session. Track the previous insert's ID and if the timestamp portion matches, increment the random portion by 1. The `ulid` library's `monotonicFactory()` handles this.
```

### Code Changes

| File | Change |
|------|--------|
| `packages/database/src/index.ts` | Add `ulid` dependency, export ULID generator |
| `apps/naisys/src/services/dbService.ts` | Generate ULIDs on insert, set host_id on all inserts |
| `apps/naisys/src/agentRegistrar.ts` | Use ULID for new users |
| `apps/naisys/src/features/llmail.ts` | Use new mail schema (see revised-llmail-plan.md) |
| `apps/naisys/src/services/runService.ts` | Update ID handling, set host_id |
| `apps/supervisor/server/src/services/*.ts` | Handle string IDs |
| `apps/supervisor/shared/src/*-types.ts` | Update type definitions for string IDs |

### Dependencies

```bash
npm install ulid --workspace=@naisys/database
```

---

## Phase 2: Hosts Table & Agent Ownership

Create a hosts table to track runners as first-class entities.

### Schema Addition

```prisma
model hosts {
  id            String    @id      // ULID
  name          String    @unique  // NAISYS_HOSTNAME
  updated_at    DateTime  @updatedAt
  users         users[]            // Agents on this host
}

model users {
  // ... existing fields
  host_id       String?
  host          hosts?    @relation(fields: [host_id], references: [id])
  updated_at DateTime  @updatedAt
  deleted_at    DateTime?          // Soft delete for deactivated agents
}
```

Note: Only active operations need to filter `WHERE deleted_at IS NULL` (e.g., starting agents, sending mail, listing active agents). Historical queries (logs, costs, old messages) should still return deleted records.

### Runner Configuration

```bash
# apps/naisys/.env
NAISYS_HOSTNAME=server-east-1  # Required - identifies this runner's host
HUB_URLS=https://hub1.example.com,https://hub2.example.com  # Optional - comma-separated list
```

Note: Multiple Hub URLs supported for high availability. Runner maintains WebSocket connection to each.

### Behavior

- On startup, runner reads `NAISYS_HOSTNAME` from .env
- Runner creates its own hosts record if it doesn't exist
- Runner only starts agents where `users.host_id` matches its own host record
- When creating new agents, `host_id` is set to runner's host ID

### Code Changes

| File | Change |
|------|--------|
| `apps/naisys/src/config.ts` | Add `NAISYS_HOSTNAME` config |
| `apps/naisys/src/agentRegistrar.ts` | Filter agents by hostname, set hostname on create |
| `apps/naisys/src/agentManager.ts` | Only load agents matching hostname |

---

## Phase 3: Hub Sync via WebSocket

Runner opens a persistent WebSocket connection to Hub. Hub controls sync rate by pulling data from runners.

### Architecture

```
                         ┌────────┐
              ┌─────────►│ Hub-1  │◄─────────┐
              │          └────────┘          │
┌─────────┐   │                              │   ┌─────────┐
│ Runner  │◄──┼──────────────────────────────┼──►│ Runner  │
│ (host1) │◄──┼──────────────────────────────┼──►│ (host2) │
└─────────┘   │                              │   └─────────┘
              │          ┌────────┐          │
              └─────────►│ Hub-2  │◄─────────┘
                         └────────┘

              Supervisor connects to Hub DB (or Runner DB in single-runner mode)
```

- Runners connect to all configured Hubs
- Each Hub independently pulls and forwards
- No coordination between Hubs needed
- Supervisor reads from Hub DB (multi-runner) or Runner DB (single-runner)

### Sync Protocol

**Hub sends sync request:**
```json
{
  "type": "sync_request",
  "schema_version": 5,
  "since": "2024-01-15T10:30:00Z"
}
```

Hub tracks a single `since` timestamp per runner - the MAX timestamp from the last sync response.

**Runner responds with new/updated rows:**
```json
{
  "type": "sync_response",
  "host_id": "01HX...",
  "has_more": true,
  "tables": {
    "users": [ { "id": "01HY...", "username": "alice", ... } ],
    "context_log": [ { "id": "01HY...", "message": "...", ... } ],
    ...
  }
}
```

**Pagination:** Each response returns max N rows per table (e.g., 1000). If `has_more: true`, Hub sends another sync_request using the last received IDs. Continues until `has_more: false`.

**Runner responds with schema mismatch error:**
```json
{
  "type": "sync_error",
  "error": "schema_version_mismatch",
  "expected": 5,
  "actual": 4,
  "message": "Runner schema version 4 does not match Hub version 5. Please update runner."
}
```

Note: Uses existing `schema_version` table to check compatibility.

### Sync Strategy by Table

Runners only sync records they **own** (where `host_id` matches local host). All tables use the same simple query pattern.

| Table | Sync Query |
|-------|------------|
| `hosts` | `WHERE id = :localHostId AND updated_at > :since` |
| `users` | `WHERE host_id = :localHostId AND updated_at > :since` |
| `user_notifications` | `WHERE host_id = :localHostId AND updated_at > :since` |
| `mail_messages` | `WHERE host_id = :localHostId AND updated_at > :since` |
| `mail_recipients` | `WHERE host_id = :localHostId AND updated_at > :since` |
| `mail_status` | `WHERE host_id = :localHostId AND updated_at > :since` |
| `context_log` | `WHERE host_id = :localHostId AND updated_at > :since` |
| `costs` | `WHERE host_id = :localHostId AND updated_at > :since` |
| `run_session` | `WHERE host_id = :localHostId AND updated_at > :since` |

**Why this prevents forwarding loops:** When runner B receives forwarded data from runner A, the `host_id` on those rows is A's host_id. When hub later pulls from runner B, the query filters by `host_id = B`, so the forwarded records are excluded. No joins needed.

### Runner Behavior

```
Standalone Mode (HUB_URLS not set):
  - All operations local
  - Mail only to local agents
  - Full functionality

Multi-Machine Mode (HUB_URLS set):
  - Open WebSocket to each configured Hub
  - Send catch_up message to each with last received IDs
  - Respond to sync_request from each Hub
  - Receive forwarded data from each Hub
  - Upsert forwarded rows (idempotent - duplicates are no-ops)
  - Reconnect with backoff if any connection drops
```

### Catch-Up on Connect

When runner connects (or reconnects), it tells Hub when it last synced:

**Runner sends:**
```json
{
  "type": "catch_up",
  "host_id": "01HX...",
  "schema_version": 5,
  "lastSyncedFromHub": "2024-01-15T10:30:00Z"
}
```

Runner stores a single timestamp: when it last received data from this hub.

**Hub responds:**
```json
{
  "type": "catch_up_response",
  "has_more": true,
  "tables": {
    "users": [ { "id": "01HY...", "username": "bob", "host_id": "01HZ...", ... } ],
    "mail_messages": [ ... ]
  }
}
```

1. Validates schema_version matches
2. Marks client as "catching up" (excluded from sync polling)
3. Queries all forwardable rows (from all hosts except the connecting runner) where hub's own `updated_at > lastSyncedFromHub`
4. Sends matching rows to the runner via ack callback
5. If `has_more: true`, runner requests more with updated timestamp
6. When `has_more: false`, marks client as ready for normal sync polling

**Important: No sync polling during catch-up.** The hub maintains a `catchingUp` flag per client. While true, the client is excluded from `selectNextClient()`. This prevents race conditions where the client receives data from both catch_up responses and sync_request forwards simultaneously. Only after catch-up completes (`has_more: false`) does normal sync polling begin.

**Key insight:** Hub uses its own `updated_at` (set on upsert) for catch-up queries, not the originating row's timestamp. This handles the "stale joiner" problem:
- Runner A syncs, disconnects at hub time X
- Runner B connects with old data (timestamps < X)
- Hub stores B's data with hub's current `updated_at`
- Runner A reconnects, asks for everything since X
- Runner A gets B's data because hub's `updated_at` > X

**Important: Catch-up always queries by `updated_at`, not ULID.** Even for append-only tables (mail_messages, mail_recipients, context_log) that use ULID-based queries for runner→hub sync, catch-up must use `updated_at`. This is because:
- The ULID is generated by the originating runner (client timestamp)
- The hub sets its own `updated_at` when storing records
- A stale joiner might bring old records with old ULIDs
- Catch-up needs records based on hub's `updated_at`, not original ULID

**Benefits:**
- Single timestamp per hub (not per-originating-host)
- Simple catch-up query
- Handles all edge cases including late-joining runners with old data
- No race conditions between catch-up and sync polling

### Sync State Persistence

Hub and runners persist sync state:

```prisma
model hub_sync_state {
  id               String   @id       // Hub: remote runner's host_id. Runner: hub URL hash
  since_timestamp  String              // ISO timestamp of last synced data
  updated_at       DateTime @updatedAt
}
```

**Hub side:**
- Keyed by runner's host_id
- Stores "last timestamp I pulled FROM runner X"
- Updated after each successful sync pull
- On startup, loads existing state to resume sync from where it left off

**Runner side:**
- Keyed by hub URL (hashed to fit in id field)
- Stores "last timestamp I received forwarded data from this hub"
- Single entry per hub (not per-originating-host)
- On catch_up, sends this timestamp as `lastSyncedFromHub`

Other fields (`lastSyncTime`, `inFlight`, `syncError`) are transient and don't need persistence.

### Hub Behavior

- Persists `since` timestamp per runner in `hub_sync_state` table
- Controls sync frequency (e.g., every 5 seconds, or on-demand)
- Can throttle during high load
- Stores all synced data in its own database
- Forwards relevant rows to other runners (see Phase 4)

### New Files

| File | Purpose |
|------|---------|
| `apps/naisys/src/hub/hubSyncClient.ts` | WebSocket client, responds to sync requests, receives forwarded data |
| `apps/hub/src/services/hubSyncServer.ts` | WebSocket server, manages sync state, forwards data |

---

## Phase 4: Bidirectional Sync & Data Forwarding

Hub pulls data from runners and forwards to all other runners. All runners become eventually consistent for shared tables (hosts, users, mail). Mail delivery happens implicitly through sync - no special mail routing code needed.

### Sync Direction

```
┌─────────┐                      ┌─────┐
│ Runner  │ ──── pull ────────►  │     │
│ (host1) │ ◄─── forward ──────  │ Hub │
└─────────┘                      │     │
┌─────────┐                      │     │
│ Runner  │ ──── pull ────────►  │     │
│ (host2) │ ◄─── forward ──────  │     │
└─────────┘                      └─────┘
```

### Forwarding Rules

All shared tables are forwarded to **all runners** (except the origin). This makes runners eventually consistent and enables agent resurrection on any runner with full mail history.

| Table | Forward To | Reason |
|-------|------------|--------|
| `hosts` | All runners (except origin) | Know all runners in system |
| `users` | All runners (except origin) | Global user directory |
| `user_notifications` | All runners (except origin) | Online status for all agents |
| `mail_messages` | All runners (except origin) | Full mail history everywhere |
| `mail_recipients` | All runners (except origin) | Who messages were sent to |
| `mail_status` | All runners (except origin) | Read/archive status |
| `context_log` | None | Hub/Supervisor-only (viewing) |
| `costs` | None | Hub/Supervisor-only (viewing) |
| `run_session` | None | Hub/Supervisor-only (viewing) |

**Benefits of forwarding all mail to all runners:**
- Any runner can resurrect a user with full mail history
- Simpler logic - no routing decisions needed
- All runners have complete view of all agents and mail
- If a runner goes down permanently, another can take over its users

### Mail Flow Example

```
Alice (host-1) sends mail to Bob (host-2):

1. Alice's agent writes mail_messages row (host_id = host-1) + mail_recipients rows
2. Hub pulls sync from host-1, receives new mail_messages and mail_recipients
   (included because host_id = host-1)
3. Hub stores rows in its database (hub's updated_at = now)
4. Hub queues rows in memory for ALL other runners (host-2, host-3, etc.)
5. On next sync_request to host-2, hub includes queued forwards
6. host-2 upserts rows to its local DB (preserving original host_id = host-1)
7. Bob's agent sees mail locally (normal llmail list/read)
8. Bob reads mail, creates mail_status row (host_id = host-2)
9. Hub pulls mail_status from host-2, forwards to host-1

Note: When hub later pulls from host-2, the mail_messages/recipients are NOT included
because their host_id = host-1, not host-2. Only Bob's mail_status is synced.
```

### Forwarding via Sync Request (Piggybacked)

Forwards are included in sync_request messages rather than sent separately. This batches forwards naturally and reduces message volume.

**Extended sync_request (Hub → Runner):**
```json
{
  "type": "sync_request",
  "schema_version": 5,
  "since": "2024-01-15T10:30:00Z",
  "forwards": {
    "users": [ { "id": "01HY...", "username": "charlie", "host_id": "01HZ...", ... } ],
    "mail_messages": [ { "id": "01HY...", "from_user_id": "01HX...", "subject": "...", "host_id": "01HZ...", ... } ]
  }
}
```

Note: `forwards` field is optional - omitted when queue is empty.

### Hub In-Memory Forward Queues

Hub maintains per-runner queues for pending forwards. These are ephemeral and tied to connection lifecycle.

**Per-client state:**
```typescript
interface ClientSyncState {
  // Existing pull state
  since: string;
  inFlight: boolean;
  lastSyncTime: number;
  syncError: { type: string; message: string } | null;

  // Catch-up state - client excluded from sync polling until catch-up completes
  catchingUp: boolean;

  // Forward queue (managed by HubForwardService, not in this interface)
}
```

**Queue lifecycle:**
```
Connect    → create empty queue, set catchingUp = true
Catch-up   → hub sends missed data, runner upserts (no sync polling yet)
Catch done → set catchingUp = false, client eligible for sync polling
Sync in    → filter to shared tables, append to OTHER runners' queues
Sync out   → include queue in sync_request, clear queue
Disconnect → delete state entirely (queue included)
Reconnect  → catch_up from DB rebuilds state, then fresh queue
```

### Hub Forwarding Logic

When hub receives sync data from runner A:
1. Store all rows in hub database (hub's updated_at = now, preserving original host_id)
2. Filter to shared tables only (hosts, users, user_notifications, mail_*)
3. For each OTHER connected runner (B, C, D...):
   - Append rows to their `outgoingForwards` queue

When hub sends sync_request to runner B:
1. Include contents of runner B's `outgoingForwards` in the request
2. Clear the queue after sending

### Runner Handles Forwards

When runner receives sync_request with forwards:
1. Upsert forwarded rows into local database (preserving original host_id)
2. Update local `hub_sync_state` with current timestamp
3. Then respond with own sync data as usual
4. Local agents see the forwarded data on next query
5. These rows won't be synced back because host_id points to a different host

### Offline Handling

If target runner is disconnected:
- Hub continues to receive and store data from other runners
- Queue doesn't exist for disconnected runner (no memory pressure)
- When runner reconnects, it sends `catch_up` with lastReceived timestamps
- Hub queries DB to rebuild what runner missed, sends via catch_up response
- Normal queue-based forwarding resumes after catch_up completes

### Benefits

- **No special mail routing code** - Runner just writes to DB normally
- **Local reads** - Each runner has local copy of relevant threads, fast queries
- **Consistent model** - Same sync mechanism for all data types
- **Automatic catch-up** - Reconnecting runners get all missed data
- **Hub is rebuildable** - If Hub DB is wiped, runners repopulate it on reconnect
- **High availability** - Multiple Hubs supported, no coordination needed, upserts handle deduplication

---

## Conflict Resolution

### Username Conflicts

**Strategy: First-Sync-Wins**

```
host-1 creates "alice", syncs to Hub → OK
host-2 creates "alice" (offline), syncs later → ERROR

host-2 gets: "Username 'alice' already exists. Please rename."
```

### Implementation

- Hub enforces unique usernames globally
- Sync endpoint returns conflict errors
- Runner surfaces error to user

---

## Hub Database Scaling

### Current: SQLite (Default)

- Works for small deployments (1-5 runners, <50 agents)
- Simple setup, no external dependencies

### Future: PostgreSQL (At Scale)

When write volume from multiple runners causes SQLite contention:

```bash
# apps/hub/.env (or combined process .env)
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:pass@host:5432/naisys_hub
```

**Implementation Notes:**
- Hub's Prisma schema supports both SQLite and PostgreSQL
- Add `provider` field to datasource or use environment-based switching
- Migration path: export SQLite → import PostgreSQL

**When to switch:**
- Multiple runners pushing logs/costs continuously
- Noticeable write latency or lock contention
- Estimated threshold: ~100 runners or ~10K log writes/hour

---

## File Summary

### New Packages

| Path | Purpose |
|------|---------|
| `apps/hub/` | New package for WebSocket sync hub |
| `apps/supervisor/` | Web UI for viewing agents, logs, mail, costs |

### New Files

| Path | Purpose |
|------|---------|
| `apps/naisys/src/hub/hubSyncClient.ts` | Responds to sync requests, filters by updated_by host |
| `apps/hub/src/services/hubSyncServer.ts` | Pulls from runners, stores data, forwards to all other runners |
| `apps/hub/src/services/hubServer.ts` | WebSocket server, manages connections |
| `apps/hub/src/naisysHub.ts` | Hub entry point |

### Modified Files

| Path | Changes |
|------|---------|
| `packages/database/prisma/schema.prisma` | ULID IDs, hosts table, host_id on ALL syncable tables, updated_at on all, new mail schema |
| `packages/database/src/index.ts` | ULID exports |
| `apps/naisys/src/services/dbService.ts` | ULID generation, set host_id on inserts, upsert for forwarded data |
| `apps/naisys/src/agentRegistrar.ts` | ULID for users, host_id filtering |
| `apps/naisys/src/agentManager.ts` | Filter agents by host_id |
| `apps/naisys/src/features/llmail.ts` | New mail schema (mail_messages, mail_recipients, mail_status), set host_id |
| `apps/naisys/src/naisys.ts` | Hub WebSocket init, create/update host record on startup, --hub/--supervisor flags |
| `apps/naisys/src/config.ts` | NAISYS_HOSTNAME, HUB_URLS config |
| `apps/supervisor/server/src/index.ts` | Points to Hub or Runner DB |
| `apps/supervisor/client/src/pages/*` | Multi-host UI (filter by host) |

---

## Configuration

### Runner Config

```bash
# apps/naisys/.env
NAISYS_HOSTNAME=server-east-1              # Required - which host this runner represents
HUB_URLS=https://hub1.example.com,https://hub2.example.com  # Optional - comma-separated
HUB_ACCESS_KEY=secret                         # Required if HUB_URLS set
```

### Hub Config

```bash
# apps/hub/.env (or combined process .env)
HUB_ACCESS_KEY=secret                         # Runners authenticate with this
DATABASE_PROVIDER=sqlite                   # or "postgresql" at scale
DATABASE_URL=file:./hub.db                 # or PostgreSQL connection string
```

### Supervisor Config

```bash
# apps/supervisor/.env (or combined process .env)
DATABASE_URL=file:./hub.db                 # Points to Hub DB (multi-runner)
# OR
DATABASE_URL=file:../naisys/naisys.db      # Points to Runner DB (single-runner)
```

---

## Migration Path

1. **Phase 1 (ULID + updated_at)** - Breaking change, requires DB migration
2. **Phase 2 (Hosts)** - Add new hosts table and associate with users
3. **Phase 3 (Hub Sync)** - New Hub package + runner sync client
4. **Phase 4 (Forwarding)** - Requires Phase 3

Can ship Phases 1-2 first (single-machine with ULIDs + hosts), then 3-4 for multi-machine.

---

## Verification

### Phase 1 (ULID + host_id + updated_at)
- [x] Existing tests pass with ULID IDs
- [x] New agents created with ULID
- [x] New mail schema implemented (mail_messages, mail_recipients, mail_status)
- [x] updated_at updates correctly on record changes
- [x] host_id set correctly on all inserts
- [x] Supervisor displays agents/logs correctly

### Phase 2 (Hosts Table)
- [x] Runner creates its own host record on startup
- [x] Runner only loads agents matching its host_id
- [x] New agents created with correct host_id
- [ ] Soft-deleted users excluded from active queries
- [ ] Soft-deleted records still sync (so all nodes know about deletion)

### Phase 3-4 (WebSocket Sync + Forwarding)
- [x] Runner connects to Hub via WebSocket
- [x] Runner connects to multiple Hubs when configured
- [x] Runner sends catch_up with single lastSyncedFromHub timestamp on connect
- [x] Schema version mismatch returns error, blocks sync
- [x] Runner responds to sync requests with new/updated data
- [x] Runner only syncs records where host_id = local host (prevents loops, no joins)
- [x] Large sync responses paginated (has_more flag)
- [x] Hub correctly tracks since timestamp per runner (pull state)
- [x] Hub persists sync state (`since` timestamp per runner) to database for restart recovery
- [x] Runner persists sync state (single timestamp per hub) for catch-up on reconnect
- [x] Hub uses its own updated_at for catch-up queries (handles stale joiners)
- [x] Hub catch-up always queries by updated_at, not ULID (even for append-only tables)
- [x] Hub excludes client from sync polling while catching up (catchingUp flag)
- [x] Hub maintains in-memory forward queues per connected runner
- [x] Hub queues shared tables (hosts, users, mail_*) for other runners on sync receive
- [x] Hub includes queued forwards in sync_request messages (piggybacked)
- [x] Hub clears forward queue after sending sync_request
- [x] Forward queue deleted on runner disconnect (no memory pressure)
- [x] Hub excludes origin host when queuing forwards (don't queue for source)
- [x] Runner handles forwards field in sync_request (upserts before responding)
- [x] Runner upserts forwarded data to local DB (dedupes across Hubs)
- [x] Cross-machine mail works (write locally → sync → forward → upsert)
- [x] Reconnecting runner catches up on missed data via catch_up
- [x] All runners eventually consistent for shared tables
- [x] Fresh Hub DB repopulates when runners connect (paginated)
- [x] One Hub down, system continues via others
- [x] Supervisor shows all agents from all hosts

### Process Composition
- [x] `naisys.js` runs standalone
- [x] `naisys.js --supervisor` runs runner + supervisor (single-runner mode)
- [x] `naisys.js --hub --supervisor` runs all three together
- [x] `naisys_hub.js` runs hub standalone
- [x] `naisys_hub.js --supervisor` runs hub + supervisor
- [x] `naisys_supervisor.js monitor=hub/naisys` runs supervisor standalone
