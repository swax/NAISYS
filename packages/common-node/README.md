# @naisys/common-node

[← Back to packages](../README.md) | [← Back to main README](../../README.md)

Node-only utilities shared across NAISYS server-side packages. Anything that touches the filesystem, spawns child processes, or depends on Node built-ins lives here rather than in `@naisys/common`, so the browser-facing packages stay clean.

## What's inside

- **`auth/`** — bearer-token parsing, token hashing, persistent API key storage, session cookies
- **`codex/`** — Codex access-token management, HTTP client, usage tracking
- **`env/`** — `.env` loading, environment-variable expansion, git info detection
- **`hub/`** — host access-key utilities, hub attachment storage, log file service
- **`loaders/`** — agent config loader, custom-model loader, Prisma migration helper, interactive `--setup` wizard

## Usage

```typescript
import { ensureDotEnv, hashToken, runSetupWizard } from "@naisys/common-node";
```

Consumed by `naisys`, `@naisys/hub`, `@naisys/supervisor`, and `@naisys/erp`.

## License

MIT
