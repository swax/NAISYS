# @naisys/supervisor-shared

[← Back to Supervisor](../README.md) | [← Back to main README](../../../README.md)

Shared types and Zod validation schemas used by both the supervisor server and client. Internal to the monorepo (not published to npm).

Both ends of every supervisor endpoint compile-check against these types, so request/response shapes can't silently drift between the React client and the Fastify server.

## What's inside

- **`admin/`** — admin info, auth, user CRUD, variable management
- **`agents/`** — agent config + status types, startup-attachment shapes
- **`api-types.ts`** — common request/response envelope types
- **`comms/`** — chat, mail, voice message types
- **`error-types.ts`** — standard error envelope
- **`model-types.ts`** — LLM/image model metadata
- **`observability/`** — costs, dashboard, logs, runs, status
- **`pagination-types.ts`** — forward + backward pagination link shapes

## Usage

```typescript
import { type AgentResponse, agentConfigSchema } from "@naisys/supervisor-shared";
```

See [doc 012 — HATEOAS](../../../docs/012-hateoas.md) for the API-design conventions these types follow.

## License

MIT
