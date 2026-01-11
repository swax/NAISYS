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
4. **Agent Mobility** - Agents can move between machines
5. **Centralized Data** - Hub receives all logs/costs for unified querying
6. **Process Flexibility** - Components run together or separately for memory efficiency

---

## Phase 1: ULID Migration & Schema Updates

Convert all IDs from INTEGER AUTOINCREMENT to ULID strings. Add `updated_at` to tables that support updates.

### Schema Changes (`packages/database/prisma/schema.prisma`)

```prisma
# Tables requiring ID changes:
- users.id: Int → String (ULID)
- mail_threads.id: Int → String (ULID)
- mail_thread_messages.id: Int → String (ULID)
- mail_thread_members.id: Int → String (ULID)
- context_log.id: Int → String (ULID)
- costs.id: Int → String (ULID)

# run_session keeps composite key but references updated user_id

# Add updated_at for sync (tables that can be updated):
- hosts: add updated_at DateTime @updatedAt (new table, see Phase 2)
- users: add updated_at DateTime @updatedAt
- mail_threads: add updated_at DateTime @updatedAt
- mail_thread_members: add updated_at DateTime @updatedAt
- run_session: add updated_at DateTime @updatedAt
- costs: add updated_at DateTime @updatedAt (aggregated per session/source/model)

# Add deleted_at for soft deletes:
- users: add deleted_at DateTime? (deactivated agents)

Note: Only active operations filter by deleted_at (starting agents, sending mail). Historical queries still return deleted records.

# Append-only tables (no updated_at needed, sync by ULID):
- context_log
- mail_thread_messages

Note: For context_log, use monotonic ULID generation to preserve strict ordering within a session. Track the previous insert's ID and if the timestamp portion matches, increment the random portion by 1. The `ulid` library's `monotonicFactory()` handles this, or implement manually: compare first 10 chars (timestamp), if equal, increment the ULID as a base32 number.
```

### Code Changes

| File | Change |
|------|--------|
| `packages/database/src/index.ts` | Add `ulid` dependency, export ULID generator |
| `apps/naisys/src/services/dbService.ts` | Generate ULIDs on insert |
| `apps/naisys/src/agentRegistrar.ts` | Use ULID for new users |
| `apps/naisys/src/features/llmail.ts` | Use ULID for threads/messages |
| `apps/naisys/src/services/runService.ts` | Update ID handling |
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
- Agent mobility: update `users.host_id` to move an agent to a different host

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

| Table | Sync Query |
|-------|------------|
| `hosts` | `WHERE updated_at > :since` |
| `users` | `WHERE updated_at > :since` |
| `user_notifications` | `WHERE updated_at > :since` |
| `mail_threads` | `WHERE updated_at > :since` |
| `mail_thread_members` | `WHERE updated_at > :since` |
| `mail_thread_messages` | `WHERE ulid_timestamp(id) > :since` (append-only) |
| `context_log` | `WHERE ulid_timestamp(id) > :since` (append-only) |
| `costs` | `WHERE updated_at > :since` |
| `run_session` | `WHERE updated_at > :since` |

Note: ULIDs are lexicographically sortable by time. To avoid table scans, convert the `since` timestamp to a ULID prefix (e.g., `ulid.encodeTime(sinceMs, 10) + '0'.repeat(16)`) and compare directly: `WHERE id > :since_ulid`. This uses the primary key index efficiently.

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

When runner connects (or reconnects), it tells Hub what forwarded data it already has:

**Runner sends:**
```json
{
  "type": "catch_up",
  "host_id": "01HX...",
  "schema_version": 5,
  "lastReceived": "2024-01-15T10:30:00Z"
}
```

Runner tracks this as the MAX timestamp from all forwarded data it has received.

**Hub responds:**
1. Validates schema_version matches
2. Looks up which agents have this host_id
3. Looks up which threads those agents are members of
4. Forwards any rows with timestamp > lastReceived for relevant tables
5. Begins normal sync polling

**Benefits:**
- Runner is source of truth for what it has
- Hub doesn't need to persist per-runner forward state
- Works correctly even if Hub restarts
- Single timestamp simplifies state tracking on both sides

### Hub Behavior

- Tracks a single `since` timestamp per runner (from last sync response)
- Controls sync frequency (e.g., every 5 seconds, or on-demand)
- Can throttle during high load
- Stores all synced data in its own database
- Forwards relevant rows to other runners (see Phase 4)

### New Files

| File | Purpose |
|------|---------|
| `apps/naisys/src/services/hubSync.ts` | WebSocket client, responds to sync requests, receives forwarded data |
| `apps/hub/src/services/syncService.ts` | WebSocket server, manages sync state, forwards data |
| `apps/hub/src/services/syncState.ts` | Tracks lastId/lastModified per runner per table |

---

## Phase 4: Bidirectional Sync & Data Forwarding

Hub pulls data from runners and forwards relevant rows to other runners. Mail delivery happens implicitly through sync - no special mail routing code needed.

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

| Table | Forward To | Reason |
|-------|------------|--------|
| `hosts` | All runners | Know all runners in system |
| `users` | All runners | Global user directory |
| `user_notifications` | All runners | Online status for all agents |
| `mail_threads` | Runners with members in thread | Thread metadata |
| `mail_thread_members` | Runners with members in thread | Membership changes |
| `mail_thread_messages` | Runners with members in thread | Mail content |
| `context_log` | None | Hub/Supervisor-only (viewing) |
| `costs` | None | Hub/Supervisor-only (viewing) |
| `run_session` | None | Hub/Supervisor-only (viewing) |

### Thread Join Handling

When a user is added to an existing thread:
1. Generate an AI summary of the thread history
2. Insert summary as first message visible to the new participant
3. Forward the `mail_thread_member` and summary message to the new participant's runner

This avoids syncing potentially large thread histories while giving new participants full context.

### Mail Flow Example

```
Alice (host-1) sends mail to Bob (host-2):

1. Alice's agent writes mail_thread_message to local DB (normal llmail operation)
2. Hub pulls sync from host-1, receives new mail_thread_message
3. Hub stores mail_thread_message in its database
4. Hub looks up mail_thread_members → Bob is a member
5. Hub looks up Bob's host_id → host-2
6. Hub forwards mail_thread_message to host-2 via WebSocket
7. host-2 writes mail_thread_message to its local DB
8. Bob's agent sees mail locally (normal llmail read)
```

### Forward Message (Hub → Runner)

```json
{
  "type": "forward",
  "has_more": true,
  "tables": {
    "users": [ { "id": "01HY...", "username": "charlie", "host_id": "01HZ...", ... } ],
    "mail_thread_messages": [ { "id": "01HY...", "thread_id": "01HX...", "message": "...", ... } ]
  }
}
```

**Pagination:** Each forward returns max N rows per table. If `has_more: true`, runner should expect more forward messages. Used for large catch-ups after reconnect.

### Runner Handles Forward

When runner receives forwarded data:
1. Upsert rows into local database (insert or update by primary key)
2. Local agents see the data on next query

### Offline Handling

If target runner is disconnected:
- Hub continues to receive and store data from other runners
- When runner reconnects, it sends `catch_up` with lastReceived IDs (see Phase 3)
- Hub forwards all missed rows based on what runner reports it has
- No separate pending queue needed - runner-reported state drives catch-up

### Benefits

- **No special mail routing code** - Runner just writes to DB normally
- **Local reads** - Each runner has local copy of relevant threads, fast queries
- **Consistent model** - Same sync mechanism for all data types
- **Automatic catch-up** - Reconnecting runners get all missed data
- **Hub is rebuildable** - If Hub DB is wiped, runners repopulate it on reconnect
- **High availability** - Multiple Hubs supported, no coordination needed, upserts handle deduplication

---

## Phase 5: Agent Mobility

Allow agents to move between machines.

### Move Flow

```
Move alice from host-1 to host-2:

1. Update alice's config: set host_id = "host-2"
2. Restart runners (or they detect change on next sync)
3. host-1 stops running alice (host_id mismatch)
4. host-2 starts running alice (host_id match)
5. Mail automatically routes to host-2 (Hub has updated user)
6. History available in Supervisor (all logs/costs synced to Hub)
```

### Implementation

- Simply update `users.host_id` field in database
- Can be done via direct DB update, API call, or admin UI in Supervisor
- No export/import needed - agent config stays in shared schema
- Historical data already in Hub from sync

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
| `apps/naisys/src/services/hubSync.ts` | WebSocket client, responds to sync, handles forwarded data |
| `apps/hub/src/services/syncService.ts` | WebSocket server, pulls from runners, forwards to runners |
| `apps/hub/src/services/syncState.ts` | Tracks `since` timestamp per runner |
| `apps/hub/src/services/forwardingService.ts` | Determines which runners need which rows |
| `apps/hub/src/index.ts` | Hub entry point |

### Modified Files

| Path | Changes |
|------|---------|
| `packages/database/prisma/schema.prisma` | ULID IDs, hosts table, host_id FK on users, updated_at on updatable tables |
| `packages/database/src/index.ts` | ULID exports |
| `apps/naisys/src/services/dbService.ts` | ULID generation, upsert for forwarded data |
| `apps/naisys/src/agentRegistrar.ts` | ULID for users, host_id filtering |
| `apps/naisys/src/agentManager.ts` | Filter agents by host_id |
| `apps/naisys/src/features/llmail.ts` | No changes needed (writes locally, sync handles routing) |
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
HUB_API_KEY=secret                         # Required if HUB_URLS set
```

### Hub Config

```bash
# apps/hub/.env (or combined process .env)
HUB_API_KEY=secret                         # Runners authenticate with this
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
5. **Phase 5 (Mobility)** - Requires Phases 2-4

Can ship Phases 1-2 first (single-machine with ULIDs + hosts), then 3-5 for multi-machine.

---

## Verification

### Phase 1 (ULID + updated_at)
- [x] Existing tests pass with ULID IDs
- [x] New agents created with ULID
- [x] Mail works with ULID thread/message IDs
- [x] updated_at updates correctly on record changes
- [x] Supervisor displays agents/logs correctly

### Phase 2 (Hosts Table)
- [x] Runner creates its own host record on startup
- [x] Runner only loads agents matching its host_id
- [x] New agents created with correct host_id
- [ ] Soft-deleted users excluded from active queries
- [ ] Soft-deleted records still sync (so all nodes know about deletion)

### Phase 3-4 (WebSocket Sync + Forwarding)
- [ ] Runner connects to Hub via WebSocket
- [ ] Runner connects to multiple Hubs when configured
- [ ] Runner sends catch_up with lastReceived IDs on connect
- [ ] Schema version mismatch returns error, blocks sync
- [ ] Runner responds to sync requests with new/updated data
- [ ] Large sync responses paginated (has_more flag)
- [ ] Large forwards paginated (has_more flag)
- [ ] Hub correctly tracks lastId/lastModified per runner (pull state)
- [ ] Hub forwards hosts table to all runners
- [ ] Hub forwards users/user_notifications to all runners
- [ ] Hub forwards mail thread data only to runners with members
- [ ] Runner upserts forwarded data to local DB (dedupes across Hubs)
- [ ] Cross-machine mail works (write locally → sync → forward → upsert)
- [ ] Reconnecting runner catches up on missed data via catch_up
- [ ] Fresh Hub DB repopulates when runners connect (paginated)
- [ ] One Hub down, system continues via others
- [ ] Supervisor shows all agents from all hosts

### Phase 5 (Mobility)
- [ ] Changing host_id moves agent to new runner
- [ ] Mail routes to new host after move
- [ ] Historical data visible in Supervisor
- [ ] New thread member receives AI summary of thread history

### Process Composition
- [ ] `naisys.js` runs standalone
- [ ] `naisys.js --supervisor` runs runner + supervisor (single-runner mode)
- [ ] `naisys.js --hub --supervisor` runs all three together
- [ ] `naisys_hub.js` runs hub standalone
- [ ] `naisys_hub.js --supervisor` runs hub + supervisor
- [ ] `naisys_supervisor.js` runs supervisor standalone
