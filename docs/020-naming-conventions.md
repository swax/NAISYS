# Naming Conventions

A single rule covers nearly every file in the repo: **the file name matches
the case of its primary export.** A file that exports a React component is
PascalCase; a file that exports a function or namespace is camelCase; a file
that has no single primary export (a bag of types/schemas) is kebab-case.

## Rules

### Files

| Style          | When                                                       | Example                                                                        |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **camelCase**  | File exports a function, namespace, or value               | `agentService.ts` exports `agentService`, `routeHelpers.ts` exports helper fns |
| **PascalCase** | File exports a React component or class                    | `AgentDetail.tsx` exports `<AgentDetail>`                                      |
| **kebab-case** | Type-only file with multiple exports; suffix with `-types` | `agent-types.ts`, `cost-types.ts`                                              |

### Folders

Always **kebab-case**, regardless of contents: `services/`, `routes/agents/`,
`client/src/lib/`. Folders don't export anything, so they get the ecosystem
default. Single-word folders are trivially conformant.

### Exceptions

Tool-required filenames are not subject to the case rule:

- `index.ts` / `index.tsx`
- `*.test.ts` / `*.test.tsx` (mirror the file under test: `agentService.test.ts`)
- `*.config.ts` (`vite.config.ts`, `tsconfig.json`, etc.)
- `*.d.ts` declaration files (`vite-env.d.ts`)
- `main.tsx` (Vite entry point)

Tool-required folders are also exempt:

- `__tests__/` (Jest/Vitest convention)
- `prisma/migrations/<timestamp>_<name>/` (Prisma-generated, snake_case)

Vendor adapter files where the name encodes a compound vendor + capability
(`anthropic-computer-use.ts`, `openai-compatible.ts`) are also acceptable as
kebab-case; the multi-word concept reads more clearly hyphenated than as
`anthropicComputerUse.ts`. Keep these isolated to `vendors/` folders.

## Why this rule

- **No decision overhead.** Look at the export, the case follows.
- **Greppable.** `import { agentService } from "./agentService.js"` — name
  matches name; no mental translation.
- **Self-evident exceptions.** Type files don't have one export, so they get
  the only case that makes sense for multi-word lowercase identifiers.

## Current compliance

As of 2026-05-15:

| Project           | Files | Violators | Notes                                                        |
| ----------------- | ----- | --------- | ------------------------------------------------------------ |
| `apps/supervisor` | 205   | 0         | Cleaned up alongside this doc                                |
| `apps/hub`        | 23    | 0         |                                                              |
| `packages/*`      | 78    | 0         |                                                              |
| `apps/naisys`     | 97    | 6         | Vendor adapter files (acceptable exception)                  |
| `apps/erp`        | 166   | 58        | Originally written in kebab-case; opportunistic cleanup only |

ERP is not being converted en masse — the cost outweighs the benefit. When an
ERP file is touched for unrelated reasons, rename it then.
