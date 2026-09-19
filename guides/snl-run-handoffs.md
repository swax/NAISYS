# SNL run handoffs and QA

These rules address the observed run-80 failures. They do not authorize a new
order, approve a sketch, or enable recurring order creation. Existing runs keep
their approved revision. Keep run 80's no-portrait scope: use source thumbnails
and textual cast research only.

## Shell and files

- Submit complete commands. NAISYS now parses Bash/PowerShell before execution;
  a rejected command has not started and needs correction, not `ns-wait`.
- Shell waits report PID, elapsed time and last output. A silent command is not
  necessarily making progress or stuck. Check child processes and artifact
  size/mtime before another long wait; cancel only a confirmed stuck command.
- `ns-chat` and `ns-mail` arguments are literal. Names such as `A$AP Rocky` stay
  intact; `$HOME` and `$(...)` are not expanded in messages or attachment paths.
- In actual Bash commands, quote literal paths with single quotes. For complex
  payloads, write JSON with a quoted heredoc and use `curl --data-binary @file`.
  Do not interpolate names/titles into shell code or inline Python. Pass them
  as arguments or read structured files. Use source IDs for generated filenames.
- Handoff absolute artifact paths, host name, source ID, byte size and validation
  evidence. A relative cache folder is relative to StarMapr, not the next agent's
  home directory. Reuse a decodable cache; do not download it again just to prove
  receipt. Missing access on another host is a handoff issue, not a cache miss.

## Small, useful handoffs

- Read a schema once per session, or on a relevant API version/validation change.
  Request only the operation and referenced inputs needed for the current step.
- After `ns-chat recent`, use the returned `ns-chat since <id>` cursor. Incremental
  results are oldest first, at most 20 per page; advance until caught up. Preserve
  the same optional user filter. Use `ns-session wait` for incoming events instead
  of repeatedly reading the same full conversation.
- Transition notes are summaries, at most 2,000 characters. Store full research,
  API evidence and manifests in ERP comments/attachments; link them in the note.
  Validate JSON and note lengths locally before posting. Prefer the canonical
  `/api` discovery URL and use `curl -L` when following documented redirects.
- Read existing state before changing it. In particular, verify NeedsReview
  without writing it again, and check the exact source after an uncertain create
  response before retrying publication.

## Editorial content and QA

SketchTV `teaser`, `synopsis`, and `notes` are **public editorial text**. Keep test
constraints, host paths, tool/manifests, run IDs, retries and audit evidence in
ERP. The API rejects known workflow markers rather than silently deleting text.
This guard is not a complete classifier of internal prose; the publication and
QA stages must also review all public text for relevance to visitors.

Report each QA capability separately with PASS, FAIL, or NOT RUN and evidence:

| Check                         | Evidence                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Source/title duplicate checks | Exact-source lookup and title/show lookup                                     |
| API record and NeedsReview    | Read-back response; no approval or redundant write                            |
| Public text                   | Title, cast from text research, synopsis/notes free of internal evidence      |
| Thumbnail asset               | HTTP response, dimensions/decodability; no person identification              |
| Public page text              | Rendered text/API comparison                                                  |
| Visual layout                 | A working browser; a text fallback cannot pass this check                     |
| Interactive playback          | Actual browser interaction; a source link alone is insufficient               |
| Indexing                      | Requested, provider rejected/deferred, or confirmed indexed; distinguish them |

If Chromium cannot launch, record the precise startup error and mark visual and
playback checks NOT RUN. A metadata/text QA pass is partial coverage, not a full
browser QA pass. Do not relabel an infrastructure failure as a content failure.

## Deferred external retries

ERP schema 48 stores the manager who deferred an operation. In the hosted
supervisor, a durable notifier checks every 30 seconds and at startup. Once
`retryNotBefore` arrives, it queues one chat per deferral to that manager through
the hub. A lost acknowledgement/restart reuses the delivery key. Reopened or
cancelled work is excluded. The UI/API reports when the chat was queued.

The hub's existing unread-message wake mechanism starts an enabled manager when
a host and spend budget are available. `AUTO_START_AGENTS_ON_MESSAGE` must be
enabled. This respects host availability, agent enablement and spend suspension;
queued is not a guarantee of immediate execution. Standalone ERP without the
supervisor notification integration enforces retry times but does not wake agents.

The manager re-reads current ERP state, checks the blocker and agent availability,
then explicitly reopens and dispatches the existing operation. A reminder never
reopens it or creates an order. If the external quota persists, reopen/fail with
a new conservative deadline and a clear reason. Recurring order creation stays
disabled. Run 80's first eligible retry is **2026-09-20 08:00 UTC / 01:00 Pacific**.
