# @naisys/hub-protocol

[← Back to packages](../README.md) | [← Back to main README](../../README.md)

Shared message types, event names, and Zod schemas for communication between NAISYS runners (clients), the hub server, and the supervisor over WebSocket + REST.

This package is the single source of truth for the wire protocol — both ends of every hub connection compile-check against the same definitions.

## What's inside

- **`events.ts` / `eventMap.ts`** — typed Socket.IO event names and their payload shapes
- **`schemas/agents/`** — agent state, heartbeat, session messages
- **`schemas/comms/`** — costs, logs, and mail message envelopes
- **`schemas/identity/`** — Codex auth and user identity payloads
- **`schemas/infra/`** — config snapshots, connect errors, host registration, model metadata

All schemas are Zod-based and exported alongside their inferred TypeScript types.

## Usage

```typescript
import { type AgentHeartbeat, hubEvents } from "@naisys/hub-protocol";
```

Consumed by `naisys` (client side), `@naisys/hub` (server side), and `@naisys/supervisor` (also a client).

## License

MIT
