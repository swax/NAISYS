# @naisys/common-browser

[← Back to packages](../README.md) | [← Back to main README](../../README.md)

Shared React/Mantine components and browser utilities used by the supervisor and ERP client apps. Internal to the monorepo (not published to npm).

## Components

- **`ActionButton`** — HATEOAS-aware button that hides or disables itself based on the action's `enabled` / `reason` state
- **`AttachmentList`** — file attachment list with preview/download
- **`CompactMarkdown`** — markdown renderer with tighter spacing for chat/mail UIs
- **`InlineWordDiff`** — inline word-level diff renderer
- **`SecretField`** — masked input for sensitive variables, with show/hide and copy
- **`ServerLogViewer`** — pino log viewer with filtering
- **`TextDiffViewer`** — side-by-side / unified text diff
- **`VersionBadge`** — app/DB version pill with update-available state

## Utilities

- **`zodResolver`** — Mantine-form-compatible resolver for Zod v4 schemas

## Peer dependencies

Consuming apps must provide `@mantine/core`, `@mantine/notifications`, `@tabler/icons-react`, `react`, `react-markdown`, and `remark-gfm`.

## License

MIT
