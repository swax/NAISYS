# Architecture

[← Back to main README](../README.md)

A high-level picture of how NAISYS fits together. See each package's README for feature-level detail.

## The four packages

Each package ships an npm binary and a programmatic export. The exports are what let one package boot another inside the same process.

| Package | Binary | Entry point | Programmatic export |
|---|---|---|---|
| `naisys` | `naisys` | `apps/naisys/src/naisys.ts` | — (top-level process) |
| `@naisys/hub` | `naisys-hub` | `apps/hub/src/naisysHub.ts` | `startHub()` |
| `@naisys/supervisor` | `naisys-supervisor` | `apps/supervisor/server/src/supervisorServer.ts` | `supervisorPlugin` (Fastify plugin) |
| `@naisys/erp` | `naisys-erp` | `apps/erp/server/src/erpServer.ts` | `erpPlugin` (Fastify plugin) |

- **`naisys`** — the **runner**. Proxies a real shell to an LLM, provides `ns-*` commands (mail, web, images, desktop control), enforces cost and context limits.
- **`@naisys/hub`** — the **server**. Fastify + Socket.IO. Owns persistence (mail, context logs, cost, variables) so runners stay stateless.
- **`@naisys/supervisor`** — the **web UI**. Monitors runners and agents, configures models and users, manages permissions.
- **`@naisys/erp`** — optional **task system** for agents. HATEOAS-driven REST designed for LLMs to self-discover.

## Starting each other in the same process

The flags `--integrated-hub`, `--supervisor`, and `--erp` chain one package into the next, ending with every package running in a single Node process on a single port:

1. The runner parses flags (`commander`, in `naisys.ts`). If `--integrated-hub` is set, it **dynamically imports** `@naisys/hub` and calls `startHub(...)`. The `await import(moduleName)` is deliberate — it avoids a compile-time dependency so the packages can build in parallel, and skips pulling the hub module tree into memory for plain Local runs.
2. The hub is a Fastify server. If `--supervisor` was passed through, the hub dynamically imports `@naisys/supervisor` and registers `supervisorPlugin` — the supervisor serves its HTTP routes as a Fastify plugin on the hub's port.
3. If `--erp` was also set, the supervisor registers `erpPlugin` the same way. ERP is a transitive dependency of supervisor, not of the runner.

```
naisys --integrated-hub --supervisor --erp
  └─ await import("@naisys/hub") → startHub()
       └─ await import("@naisys/supervisor") → fastify.register(supervisorPlugin)
             └─ await import("@naisys/erp") → fastify.register(erpPlugin)
```

Everything runs on one port; the runner then connects back to the in-process hub at `http://localhost:<port>/hub` as if it were remote.

## Runtime topology

```
             ┌──────────────┐
             │  Supervisor  │   (browser)
             └──────┬───────┘
                    │ WebSocket + REST
                    ▼
   ┌────────┐   ┌───────┐   ┌────────┐
   │ Runner │──▶│  Hub  │◀──│ Runner │   (other machines)
   └────────┘   └───┬───┘   └────────┘
                    │
                    ▼
                Prisma DB
```

The hub is the only piece that holds state. Runners and supervisors connect in as clients. Any runner can be restarted or moved between machines without losing mail, logs, or cost history. See [doc 005](005-multi-machine-redux.md) for the multi-machine model and [doc 010](010-hub-security.md) for the auth/security model.

## Inside the runner

A single runner process can host many agents concurrently.

### Agent manager

`apps/naisys/src/agent/agentManager.ts` owns a `runningAgents: AgentRuntime[]` list and is the single entry point for start/stop/peek. Only one agent is "active" in the TTY at a time. Inactive agents still run in the background — each has its own `OutputService` that buffers console writes (capped to 10 lines). `setActiveConsoleAgent()` swaps the active agent, flushes the buffered lines, and wires stdin to the new one.

### Agent runtime

Each agent has its own `AgentRuntime` — a bag of services scoped to that agent — built by `createAgentRuntime()` in `apps/naisys/src/agent/agentRuntime.ts`. Everything per-agent hangs off this object:

- `llmService`, `costTracker`, `tools`, `systemMessage` — LLM interaction
- `shellWrapper`, `workspaces` — shell and file context
- `mailService`, `chatService`, `mailQueryService` — inter-agent messaging
- `commandLoop`, `commandHandler`, `commandRegistry`, `commandProtection` — main loop and `ns-*` dispatch
- `desktopService`, `computerService`, `lookService`, `listenService`, `genimg`, `subagentService` — feature services
- `logService`, `output` — logging and buffered console

### Factory-function DI

Services are built by factory functions, not classes with constructors. A typical signature:

```ts
export function createLLMService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  costTracker: CostTracker,
  tools: CommandTools,
  modelService: ModelService,
  computerService?: ComputerService,
) { ... }
```

Two techniques keep the graph acyclic:

1. **Closures over getters.** Config is passed in as a function (`globalConfig()` / `agentConfig()`), not a value. Services read the current value on every call, so config can be reloaded without rebuilding services.
2. **Interface-based late binding.** Services that need the agent manager (mail, subagent) depend on the `IAgentManager` interface at `apps/naisys/src/agent/agentManagerInterface.ts`, not the concrete class. The manager is the last thing constructed — it closes over the already-built services — and those services call back into it through the interface.

Top-level wiring lives in `apps/naisys/src/naisys.ts`: services are constructed in dependency order and passed forward, with interfaces substituted wherever a cycle would otherwise form.

## Two deployment shapes

- **Integrated** — `naisys --integrated-hub --supervisor --erp` runs every package in a single Node process. This is the "Server" mode in the README.
- **Distributed** — a standalone hub with runners on multiple machines, each connecting via `--hub=https://...`. Agents can run on any host or be pinned to specific ones — useful when a host has unique resources (GPU, desktop, Windows).

## Cross-cutting choices

- Monorepo under `apps/`, Turbo-repo builds
- Prisma ORM across the stack; snake_case DB, camelCase code
- Zod schemas shared between client and server; OpenAPI derived from Zod
- All packages publish under the `@naisys` scope on a single version (surfaced on the supervisor admin page)
- Node >= 22 required
