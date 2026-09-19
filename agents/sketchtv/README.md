# Manual SketchTV runs

`manager-prompt.md` is Nick's persistent agent prompt. Its `SKETCHTV_WORK_SCOPE`
variable is saved by the operator in Supervisor, not inferred from recent chat.
Use `qa-policy.md` in Sam's persistent prompt after the shared tech instructions.
Prompts and variables are resolved into the system message each fresh run and
remain outside compacted conversation history. Save these through Supervisor so
config revisions and normal host configuration notifications are preserved.

Example scope for an already-created test:

```
Only NEW-SKETCH run 81. No new orders or recurring schedules. Leave all other
runs alone. Read its current ERP state before acting. Indexing must not be
retried before 2026-09-20T08:00:00Z; this is eligibility, not a confirmed Google
quota reset. Leave the sketch NeedsReview. Use textual cast research and source
thumbnail media only; no portrait identification, training, recognition or new
actor portraits. On completion/cancellation, stop; do not replace the run.
```

Update the scope explicitly for a later authorized test before starting it.
Do not clear it automatically on completion: a later acknowledgement must not
restore permission to process backlog. To authorize creation, first save a scope
allowing exactly one new run, then bind it to the resulting run number before
dispatching technicians. Creating a new run is not part of installing this policy.

These are persistent operating instructions, not a shell or credential sandbox.
QA uses public reads and keeps ERP reporting permissions. The SketchTV
review-status endpoint separately skips unchanged status/note requests so an
accidental repeated request does not modify attribution, timestamps or audit
history. It still permits authorized real edits and is not a read-only API key.
