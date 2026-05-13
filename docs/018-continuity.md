# Continuity

When an agent restarts — whether from a clean stop, a crash, or a fresh process start — `continuity` controls how much of its prior context comes back with it. The setting lives on each agent's config and takes three values:

| Value     | Behavior                                                                          |
| --------- | --------------------------------------------------------------------------------- |
| `fresh`   | No prior context. New process starts blank.                                       |
| `summary` | Carries forward the agent's most recent compact summary.                          |
| `full`    | Replays the agent's post-compact log entries (or all history if never compacted). |

Three session subcommands shape what the agent itself can do: `ns-session compact` (produces a summary that becomes the next-run seed), `ns-session complete` (in summary mode also produces a summary before exit so the next run resumes from a clean snapshot; in full mode just exits, since the post-compact tail is the point), and `ns-session clear` (hidden from non-debug help; writes a marker compact row so the next session starts with an explicit "Previous Session Cleared" summary instead of prior history).

## Why this shape

The first version of continuity stored the summary as a plain text column on `users`. It worked, but it couldn't tell whether the saved summary was _current_ — after a crash mid-run, the next start could happily re-seed from a snapshot that was hours behind the agent's actual last activity and silently drop everything in between.

Two ideas drove the redesign:

1. **The compact log entry is the natural boundary.** Every `ns-session compact` already writes a `type: "compact"` log row. It carries the summary text, the run/session it closed, and a stable id. Pointing the user at that row by id (`users.compact_log_id`) gives a cursor for free: everything in `context_log` with an id past the cursor is unsummarized "tail" activity, and the cursor row itself is the seed.

2. **Replay should not pollute the log.** Earlier versions re-logged every replayed entry through `contextManager.append`, so a run with `continuity=full` would echo the prior run's entries into its own `context_log` rows. Logs became near-duplicate across runs. Switching replay to a silent path (`skipLog` on `append`/`appendImage`/`appendAudio`) keeps `context_log` a single chronological record, and "since the last compact" becomes the natural unit of replay — bounded by how often the agent compacts.

The compact cursor + silent replay together unify the modes. There's no separate code path for "fetch summary," "load entries," or "detect stale" — every mode reads from the same cursor and decides what to ship based on what's past it.

## The compact cursor

`users.compact_log_id` is a nullable FK into `context_log`. The hub log handler updates it whenever a `type: "compact"` row from a parent agent (`subagent_id = 0`) is written:

```
compact log row arrives → users.compact_log_id = log.id
```

The subagent guard matters — a subagent's compact summary is its own, not its parent's, and without the guard a chatty subagent could clobber the parent's cursor.

The cursor doubles as both the snapshot source (the row's `message` is the summary text) and a tail boundary (entries with `id > compact_log_id` are unsummarized). `ON DELETE SET NULL` keeps the FK honest — if the compact row is pruned, the cursor goes null and the agent treats itself as having no snapshot yet.

## Resume bundle

On `AGENT_START`, the hub assembles a `RestoreData` bundle keyed off the cursor and the user's continuity setting. The tail is shipped unfiltered:

| continuity | compact | tail      | Shipped                               |
| ---------- | ------- | --------- | ------------------------------------- |
| summary    | ✓       | empty     | `{ summary, cursor }`                 |
| summary    | ✓       | non-empty | `{ summary, entries, stale, cursor }` |
| summary    | ✗       | non-empty | `{ entries, stale }`                  |
| summary    | ✗       | empty     | nothing                               |
| full       | ✓       | empty     | `{ summary, cursor }`                 |
| full       | ✓       | non-empty | `{ summary, entries, cursor }`        |
| full       | ✗       | non-empty | `{ entries }`                         |
| full       | ✗       | empty     | nothing                               |
| fresh      | —       | —         | nothing                               |

Reading the shapes:

- **summary clean** — snapshot is current; the client's normal startup runs `ns-session restore` to inject the summary into context.
- **summary stale** — the agent kept working past the snapshot before stopping. Replay the tail; `stale=true` tells the client to retroactively compact at startup so the saved snapshot catches up.
- **summary first-time seed** — no compact has ever run, but there's activity to replay. The first retroactive compact creates the cursor; from then on the agent is on the normal path.
- **full with snapshot** — always carries summary plus any tail. Same shape whether the post-compact session crashed before or after running its restore echo.
- **full with no compact** — brand-new agent whose first session didn't make it to a compact. Replay everything.
- **fresh / nothing** — empty bundle; agent starts with config-defined initial commands only.

## The single-summary invariant

Silent replay decouples replay from the log, but it raises a question: where does the summary live in the agent's reconstructed context? Two possible sources:

1. The `summary` field in the bundle (prepended by the client at the head of replay).
2. The post-compact `ns-session restore` echo logged by the prior session (a Console entry whose `message` is exactly the compact's summary text).

Without coordination they can either overlap (after a normal compact, both are present and the agent gets the summary twice) or both be missing (in the rare gap where the compact mirrored but the post-restart restore echo never logged, the summary is lost).

The invariant: **the summary appears in the agent's replayed context exactly once.** The implementation is reactive on the host rather than transformative on the hub. The hub always ships `summary` (when a compact exists) and ships the tail unfiltered, so the post-compact restore echo travels back in its natural chronological position. On replay, the host scans the tail for a console-source entry whose `message` equals `summary`; if found, the echo provides the summary in context and no prepend is needed.

If the echo is _absent_, the host falls back to prepending `[Restored summary]\n…` at the head of replay so context still has the summary, but the fallback is treated as a bug signal, not normal operation. By the time a healthy buffer flush window has passed (a few seconds after the post-compact `ns-session restore` runs), the echo is logged. Hitting the fallback in production means something off happened: the log buffer dropped, the hub write failed, the restore didn't actually run, or a regression in the restore-logging path. The fallback logs loudly via `errorAndLog` so it surfaces for investigation.

This keeps the agent's replayed log order faithful to the original session in the common case, and only synthesizes a top-of-context summary when the original would otherwise be missing it.

## Stale recovery

When `stale=true` is set on the bundle, the client replays the tail and then fires `ns-session compact` as its only initial command. The retroactive compact merges the prior summary + replayed tail into a fresh summary, which logs a new compact row, which the hub mirrors to `compact_log_id`. The next run starts on the clean path.

The retro-compact is gated on the preemptive-compact token threshold — paying for an LLM compact when the replayed context is tiny isn't worth it. Below the threshold the agent runs with stale summary + tail in context and waits for its own natural compact to refresh the cursor. The cost: small-tail crashes can leave the snapshot one tail behind until the agent triggers its own compact. That's a deliberate trade-off, not a bug.

## Image and audio rehydration

A replayed `context_log` entry can reference an attachment by `attachment_id`. For images and audio specifically, the bundle includes the attachment's `publicId` + `filename` so the client can fetch the bytes from the hub and inject them back into context via `appendImage`/`appendAudio`.

Filtering happens hub-side: only entries whose source is Console and whose filename is image or audio get attachment metadata along for the ride. Other attachment types (PDFs, mail attachments, etc.) replay text-only — `contextManager` doesn't have a path to inject them into LLM context, and forcing one would shape the LLM message API around file types the agent typically handles via shell commands anyway.

Replay does not re-log or re-upload. The bundle carries enough metadata for the host to download bytes and inject them, and since silent replay never writes a new log row, there's no duplicate attachment record to worry about either.

If the current `shellModel` rejects image context (e.g. user changed model since the prior run and the new one doesn't support vision), `appendImage` returns a block reason and replay falls back to the original placeholder text — so the agent at least sees `[Image: filename]` markers in context.

## Concurrent download caps

Both startup attachment staging and resume-replay attachment fetch route through the shared `mapWithConcurrency(items, 4, fn)` helper in `@naisys/common`. Without a cap, an image-heavy resume could open dozens of sockets at once and stress both the hub and the host's file descriptors. With a cap, the slowest image bounds total time without serializing the rest.

Startup gets a side-effect win — it used to be a strictly sequential `for…of await`, so 20 config files meant 20 round-trips; now it's parallel up to the cap.

## Crash safety: tmp file sweep

`hubAttachmentService.downloadToFile` streams to `${targetPath}.tmp.<pid>.<ts>` and atomically renames on success; error paths (non-200, write error, rename failure) unlink the tmp file. The gap is process crash mid-stream — SIGKILL or panic between write and rename leaves a partial tmp behind.

`sweepStaleTmpFiles(rootDir)` walks the staging root recursively and removes any matching file older than one hour. It runs once before staging starts, so each new agent run cleans up whatever the previous one left behind. The age cap protects against deleting a tmp file that another concurrent process is actively writing.

## Clear

`ns-session clear` is hidden from `ns-session help` outside debug mode, but the handler itself is unconditionally callable — an agent that asks for it gets it. It writes a `type: "compact"` row with the fixed text "Previous Session Cleared", which flows through compact's normal path: the hub mirrors it into `compact_log_id`, the session restarts via `NextCommandAction.CompactSession`, and the restart queues `ns-session restore` so the echo lands in the tail.

On the next `AGENT_START`, the cursor points at the "Previous Session Cleared" row, so continuity = summary / full both ship that string as the agent's restored context. The result: clear advances the cursor past prior history without nulling it, giving the next session a deliberate clean-slate marker while preserving the audit log.

## Schema

Migration `20260511000000_add_user_compact_log_id` adds a single nullable column:

```sql
ALTER TABLE "users" ADD COLUMN "compact_log_id" INTEGER
  REFERENCES "context_log"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
```

No backfill needed — null means "no compact yet," which is the correct state for agents that haven't compacted. The Prisma relation `users.compact_log` and inverse `context_log.cursor_for` are wired so future tooling (e.g. supervisor UI listing "users currently anchored to this compact") doesn't need an extra raw query.

## Files of interest

| Area                                              | File                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Hub: cursor mirror                                | `apps/hub/src/handlers/hubLogService.ts`                                                            |
| Hub: bundle assembly                              | `apps/hub/src/handlers/hubAgentService.ts`                                                          |
| Wire format: `RestoreData`, `ResumeEntry`         | `packages/hub-protocol/src/schemas/agents.ts`                                                       |
| Host: bundle preload, silent replay, echo scan    | `apps/naisys/src/features/session.ts`                                                               |
| Host: `skipLog` on append/appendImage/appendAudio | `apps/naisys/src/llm/contextManager.ts`                                                             |
| Host: replay trigger + resume notice              | `apps/naisys/src/command/commandLoop.ts`                                                            |
| Host: shared hub-attachment client                | `apps/naisys/src/services/hubAttachmentService.ts`                                                  |
| Concurrency helper                                | `packages/common/src/mapWithConcurrency.ts`                                                         |
| Schema + migration                                | `packages/hub-database/prisma/schema.prisma`, `…/migrations/20260511000000_add_user_compact_log_id/` |
| `ns-session clear` (hidden in non-debug help)     | `apps/naisys/src/features/session.ts`, `apps/naisys/src/command/commandDefs.ts`                     |
| Supervisor: fresh → non-fresh boundary write      | `apps/supervisor/server/src/services/agentConfigService.ts`                                         |
| Continuity JSON parser (shared)                   | `packages/common/src/agentConfigFile.ts`                                                            |

## Crossing out of `fresh`

Switching `continuity` from `fresh` (or unset) to `summary`/`full` would otherwise leave `compact_log_id` null on the next start, and the bundle would ship every parent-agent log entry the user has ever produced. For an agent that ran in `fresh` for a while, that's a large bundle of unrelated past sessions — and in `summary` mode the stale-path retro-compact would burn an LLM call merging them into one summary that has no narrative.

The supervisor's `updateAgentConfigById` (`apps/supervisor/server/src/services/agentConfigService.ts`) intercepts this transition: when old continuity is fresh/undefined and new is summary or full, it writes a `type: "compact"` marker row anchored to the user's latest session with message "Continuity enabled — prior history not carried forward.", then points `compact_log_id` at it. Done before the config update so a concurrent `AGENT_START` can't see the new mode with a null cursor. The next start reads `{ summary: "Continuity enabled — …", cursor }` — empty tail, no replay, no retro-compact.

Brand-new users with no prior `context_log` entries skip the write. Ping-pong toggles (fresh → summary → fresh → summary with no activity between) also skip — the existing cursor already points at the latest row.

## Bounding `continuity=full` tail growth

When `compact_log_id` is null, the bundle ships every parent-agent entry the user has — so a `continuity=full` agent that never compacts would grow this bundle without bound. In practice the agent's own context-pressure compact is the natural ceiling: as the tail approaches the model's context window the agent triggers `ns-session compact` itself, the cursor advances, and the next run's bundle drops back to a tight `{ summary, ... }` shape. `autoCompact` shortens that ceiling further. The "switching out of fresh" hook above also covers the long-running fresh agent that flips into full.

