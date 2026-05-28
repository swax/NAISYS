# @naisys/common

[← Back to packages](../README.md) | [← Back to main README](../../README.md)

Shared utilities and constants used across the NAISYS monorepo. Pure TypeScript with no Node- or browser-specific dependencies, so it can be imported from runner, server, and client packages alike.

## What's inside

- **`agent/`** — agent config file shape, name conventions, status enum, schedule parsing, sub-agent ID helpers
- **`auth/`** — auth cache, Codex OAuth helpers, URL-safe key generation
- **`config/`** — global config loader, well-known variable names, hosted-service constants
- **`http/`** — HATEOAS link/action types and helpers, lenient JSON parsing, security headers, URL path matching
- **`models/`** — built-in model registry, cost calculations, model type definitions, realtime model list
- **`utils/`** — collection helpers, error handler, formatters (file size, tokens, version), `mapWithConcurrency`, MIME types, `sleep`, template-variable expansion

## Usage

```typescript
import { formatTokens, sleep, hateoas } from "@naisys/common";
```

Consumed by `naisys`, `@naisys/hub`, `@naisys/supervisor`, `@naisys/erp`, and the other `@naisys/*` packages.

## License

MIT
