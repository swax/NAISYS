# Auto-Start Agents on Pending Mail - Planning Document

## Overview

This document outlines a significant architectural change to simplify agent lifecycle management by automatically starting agents when they receive mail, rather than requiring explicit `ns-agent start` commands.

## Current State

### Agent Startup Flow
1. Lead agent runs `ns-agent start <username> "<task description>"`
2. Subagent service validates the agent exists and isn't already running
3. AgentManager creates AgentRuntime and starts command loop
4. Startup message is sent via `llmail.sendMessage()` to the new agent

### Cross-Machine Architecture
- Agents are registered per-host via `AgentRegistrar` (scans YAML files)
- Each host runs its own `AgentManager` with local agents only
- `HubSyncClient` syncs data (including mail) to/from central hub
- Mail messages include `host_id` of sender
- Recipients tracked in `mail_recipients` table with status in `mail_status`

### Current Commands
- `ns-agent list` - Shows subagents of current agent with status
- `ns-agent start <username> "<description>"` - Starts a subagent
- `ns-agent stop <id>` - Stops a running subagent
- `ns-agent switch <id>` - Switches console focus (debug mode)
- `ns-mail users` - Lists all users in the system
- `ns-mail wait <seconds>` - Waits for new mail

### Wake on Message
- Agents can be configured with `wakeOnMessage: true`
- `promptBuilder.ts:getInput()` polls `llmail.getUnreadThreads()` every 5 seconds
- If unread mail found, aborts the current pause/wait
- Only works for already-running agents

---

## Proposed Changes

### 1. Auto-Start Agents on Pending Mail

**Concept**: The AgentManager monitors for unread mail addressed to local agents and automatically starts those agents.

**Implementation Location**: `AgentManager` class in `apps/naisys/src/agent/agentManager.ts`

**New Behavior**:
1. AgentManager runs a polling loop (configurable interval, e.g., 5-10 seconds)
2. Query for unread mail where recipient is a local agent (by `host_id`) that isn't running
3. For each such agent, automatically start it
4. Agent wakes up, sees unread mail, processes it
5. Agent can complete via `ns-session complete <username> "<result>"` or continue running

**Key Considerations**:
- Shutdown behavior is unified: agents call `ns-session complete <username> "<result>"` to send result to specified user
- No limit on concurrent agents - allows natural agent-to-agent communication without bottlenecks
- LLM usage is throttled by existing `SPEND_LIMIT_DOLLARS` env var (spend limit per hour)
- 5 second polling interval serves as natural rate limiting for startup checks

**Configuration**:
- `.env` var `START_AGENT_ON_MAIL` (default: `true`) - global toggle for the feature
- `LlmModel.startOnMailDisabled` in `llModels.ts` - set to `true` for mock/none models to prevent auto-start

**Why No Agent Limit**:
- Prioritizing which agent to start when multiple have pending messages is complex and error-prone
- Agents often need to communicate with each other - limiting concurrency creates artificial bottlenecks
- The `SPEND_LIMIT_DOLLARS` env var already provides cost control by throttling LLM API calls per hour
- Let all agents run; the spend limit naturally gates overall system activity

### 2. New `ns-users` Command

**Purpose**: Unified view of all users/agents in the organization hierarchy

**Location**: New file `apps/naisys/src/features/users.ts` or integrate into existing service

**Output Format**:
```
Username      | Title                  | Host     | Lead     | Status
---------------------------------------------------------------------------
alice         | Project Manager        | server-1 | (none)   | Running
  bob         | Senior Developer       | server-1 | alice    | Available
    charlie   | Junior Developer       | server-2 | bob      | Running
    dave      | QA Engineer            | server-2 | bob      | Offline
  eve         | Designer               | server-1 | alice    | Running
```

**Features**:
- Tree-style hierarchy based on `lead_username`
- Shows hostname for multi-host environments
- Status: Running, Available (not running, host online), Offline (host offline)

**Status Determination**:
- Check `user_notifications.last_active` (updated every 2s by running agents)
- Running: last_active > now - 10 seconds
- Available: agent not active but host is online
- Offline: `hosts.last_active` < now - 10 seconds (host unreachable)

### 3. Simplified `ns-agent` Command

**New Subcommands**:

| Command | Description | Scope |
|---------|-------------|-------|
| `ns-agent help` | Show help | - |
| `ns-agent start <username> "<task description>"` | Manually start an agent |
| `ns-agent stop <id>` | Force stop an agent | Local + Remote |
| `ns-agent switch <id>` | Switch console focus | Local only (debug) |
| `ns-agent log <id> [lines]` | View recent log output | Local + Remote |

**Removed Commands**:
- `ns-agent list` - Replaced by `ns-users` (which shows all agents, not just subagents)

### 4. Remote Agent Control Protocol

**Purpose**: Enable `ns-agent stop` and `ns-agent log` to work on agents running on remote hosts.

**Architecture**: Use existing Hub infrastructure for message routing

**New Hub Events**:

#### Stop Agent Request
```typescript
// Runner → Hub → Target Runner
interface AgentStopRequest {
  targetHostId: string;
  targetAgentId: number;  // run_id from run_session
  requesterId: string;    // user_id of requester
  reason: string;
}

// Target Runner → Hub → Requester
interface AgentStopResponse {
  success: boolean;
  error?: string;
}
```

#### Log Request
```typescript
// Runner → Hub → Target Runner
interface AgentLogRequest {
  targetHostId: string;
  targetAgentId: number;
  lines: number;  // How many lines to return
}

// Target Runner → Hub → Requester
interface AgentLogResponse {
  success: boolean;
  lines: string[];
  error?: string;
}
```

**Implementation Components**:

1. **Hub Side** (`apps/hub/src/services/`):
   - New `hubRemoteControlService.ts`
   - Routes requests to target host
   - Validates permissions (only lead agents can stop their subagents)
   - Returns response to requester

2. **Runner Side** (`apps/naisys/src/hub/`):
   - New `hubRemoteControlClient.ts`
   - Registers handlers for `agent_stop_request` and `agent_log_request`
   - Executes local operations via `AgentManager`
   - Sends response back through hub

**Security Considerations**:
- Validate requester has permission (is lead agent or higher, admin, or same user)
- Rate limiting on remote operations
- Audit logging of remote stop commands

### 5. Mail Delivery Status Feedback

**Purpose**: When sending mail to an agent on an offline host, inform sender that delivery is pending.

**Implementation**:
```typescript
// In llmail.sendMessage()
async function sendMessage(userIdentifiers, subject, message) {
  // ... existing validation ...

  // After creating message, check host status
  const offlineHosts = await checkRecipientHostStatus(recipients);

  if (offlineHosts.length > 0) {
    return `Mail sent. Note: ${offlineHosts.join(', ')} currently offline - delivery pending.`;
  }

  return "Mail sent";
}
```

**Host Status Check**:
- Query `hosts.last_active` for each recipient's `host_id`
- Offline if `last_active < now - 20 seconds` (2x the 10s heartbeat interval)

---

## Technical Implementation Details

### Auto-Start Polling Loop

```typescript
// In AgentManager
private autoStartInterval: NodeJS.Timeout | null = null;

async startAutoStartMonitor(intervalMs: number = 5000) {
  if (!this.globalConfig.startAgentOnMail) {
    return; // Feature disabled globally
  }

  this.autoStartInterval = setInterval(async () => {
    await this.checkAndStartPendingAgents();
  }, intervalMs);
}

private async checkAndStartPendingAgents() {
  const pendingAgents = await this.dbService.usingDatabase(async (prisma) => {
    // Find local agents with unread mail that aren't running
    return prisma.users.findMany({
      where: {
        host_id: this.hostService.localHostId,
        deleted_at: null,
        // Has unread mail (no read status or read_at is null, and not archived)
        mail_recipients: {
          some: {
            message: {
              status: {
                none: {
                  user_id: { /* matched by join */ },
                  read_at: { not: null }
                }
              }
            }
          }
        }
      }
    });
  });

  // Filter by model's startOnMailDisabled and running status
  const eligibleAgents = pendingAgents
    .filter(agent => {
      const config = parseAgentConfig(agent.config);
      const model = this.llModels.get(config.llmModel);
      return !model.startOnMailDisabled;
    })
    .filter(agent => !this.runningAgents.find(a => a.agentUsername === agent.username));

  // Start all eligible agents - no concurrency limit
  // LLM usage is throttled by SPEND_LIMIT_DOLLARS env var
  for (const agent of eligibleAgents) {
    await this.startAgent(agent.agent_path);
  }
}
```

### Remote Control Message Flow

```
┌─────────────────┐     ┌─────────┐     ┌─────────────────┐
│  Requester      │     │   Hub   │     │  Target Host    │
│  (Server-1)     │     │         │     │  (Server-2)     │
└────────┬────────┘     └────┬────┘     └────────┬────────┘
         │                   │                   │
         │ agent_stop_request│                   │
         │──────────────────>│                   │
         │                   │ agent_stop_request│
         │                   │──────────────────>│
         │                   │                   │
         │                   │                   │ AgentManager.stopAgent()
         │                   │                   │
         │                   │ agent_stop_response
         │                   │<──────────────────│
         │ agent_stop_response                   │
         │<──────────────────│                   │
         │                   │                   │
```

---

## Configuration Changes

### Environment Variables
```bash
START_AGENT_ON_MAIL=true      # Enable auto-start on pending mail (default: true)
# SPEND_LIMIT_DOLLARS already exists - throttles LLM usage per hour (no agent concurrency limit)
```

### LlmModel Addition (`llModels.ts`)
```typescript
interface LlmModel {
  // ... existing fields ...
  startOnMailDisabled?: boolean;  // Set to true for mock/none models
}
```

### Hardcoded Settings
- Poll interval: 5000ms (5 seconds) - serves as natural rate limiting

---

## Decisions Made

1. **Task Description**: Pending mail serves as the task description - agent wakes up, sees mail, processes it.

2. **No Agent Limit**: All agents with pending mail are started - no concurrency cap. LLM usage is throttled by existing `SPEND_LIMIT_DOLLARS` env var. This avoids complex prioritization logic and allows natural agent-to-agent communication.

3. **Cooldown Behavior**: No cooldown needed - the 5s polling interval provides natural rate limiting for startup checks.

4. **Exempt Agents**: New `LlmModel.startOnMailDisabled` field in `llModels.ts`. Set to `true` for mock/none models to prevent unnecessary auto-starts.

5. **Backward Compatibility**: `ns-agent start` remains as a debug-only command.

---

## Future Considerations

- **Cluster-Wide Spend Limits**: Currently `SPEND_LIMIT_DOLLARS` is per-machine. Need to implement spend tracking/throttling across the entire cluster so total spend is controlled regardless of how many hosts are running agents.

- **Permission Model for Remote Control**: Who can stop/view logs of agents?
  - Lead agent only?
  - Any agent on same team?
  - Admin agents only?

---

## Task Checklist

### Phase 1: Add Infrastructure

#### Remote Control Protocol
- [ ] Define TypeScript interfaces for request/response messages
- [ ] Create `hubRemoteControlService.ts` on hub side
- [ ] Create `hubRemoteControlClient.ts` on runner side
- [ ] Implement `agent_stop` request handler (response via callback)
- [ ] Implement `agent_log` request handler (response via callback)
- [ ] Add permission validation
- [ ] Add timeout handling for requests
- [ ] Add error handling and logging

#### New `ns-users` Command
- [ ] Create `users.ts` feature file
- [ ] Query entire table and do hierarchy in memory
- [ ] Format output as tree with indentation
- [ ] Show host information for multi-host mode
- [ ] Show running/available/offline status based on `last_active`
- [ ] Register command in `commandRegistry`
- [ ] Add help text

#### Updated `ns-agent` Command
- [ ] Refactor `subagent.ts` for new command structure
- [ ] Update `ns-agent stop` to support remote agents
- [ ] Implement `ns-agent log` subcommand (local)
- [ ] Implement `ns-agent log` for remote agents
- [ ] Keep `ns-agent switch` for local debug mode only
- [ ] Update help text

#### Remove Old Commands

- [ ] Remove `ns-mail users` (replaced by `ns-users`)
- [ ] Remove `ns-agent list` (replaced by `ns-users`)

### Phase 2: Enable Auto-Start

#### Auto-Start Feature
- [ ] Add `START_AGENT_ON_MAIL` env var to global config (default: `true`)
- [ ] Add `startOnMailDisabled` to `LlmModel` interface in `llModels.ts`
- [ ] Set `startOnMailDisabled: true` for mock/none models
- [ ] Add auto-start polling loop to `AgentManager`
- [ ] Implement query for agents with pending unread mail (filter by model's `startOnMailDisabled`)
- [ ] Handle edge cases (startup failures)

#### Update `ns-session complete` Command
- [ ] Update syntax to `ns-session complete <username> "<result>"`
- [ ] Username specifies who receives the completion message
- [ ] Update help text in `session.ts`
- [ ] Remove dependency on `leadAgent` config for completion message target

#### Mail Delivery Feedback
- [ ] Add host status check to `llmail.sendMessage()`
- [ ] Return appropriate message when recipients' hosts are offline

#### Testing
- [ ] Write unit tests for auto-start logic
- [ ] Write integration tests for remote control
- [ ] Test multi-host scenarios
- [ ] Test edge cases (rapid mail, network partitions)

### Phase 3: Full Transition

- [ ] Remove `subagentMax` from agent config (no longer needed - no concurrency limit)
- [ ] Update existing agent configs if needed
- [ ] Update any scripts/tools that use old commands
