# Voice Agent

Real-time voice chat with a running agent, started from either the chat thread or the
runs page. You talk to a **voice agent**, and it operates the console agent on your
behalf — issuing chat and (in console mode) shell commands, watching the agent's run log,
and narrating progress back to you in real time instead of making you wait for the agent
to finish a cycle and reply. The session lives in a persistent floating control that
follows you around the app.

## Modes

Voice sessions are minted in one of two modes, which scope what the voice agent can do
and what it narrates:

- **`chat` mode** — entry point on the chat thread. The session speaks _as the page's
  chat user_. Only `talk_to_agent` is exposed; shell tools are hidden in both the system
  message and the realtime session config. Narration filters log entries to the same set
  the chat user already sees (skips `console` and `startPrompt` sources).
- **`console` mode** — entry point on the runs page. The session speaks _as the admin
  operator_, regardless of who is viewing the page. This is the more verbose mode: all
  three tools are available, and narration carries the full run-log view (including
  `console` and `startPrompt`) so the voice agent has the same context as someone
  watching the run log live.

The mode is baked in at mint time and stored on the server-side voice session record;
`/voice/tool` rejects any tool the session's mode never had access to, even if the
browser bypassed the locked realtime session config.

## Goal

Today, talking to an agent in the supervisor means typing a chat message and waiting for
the agent to finish a work cycle and chat back. The voice agent collapses that loop: you
speak, it acts, and it tells you what the agent is doing _as it happens_ — sourced from
the agent's raw run log, not its eventual summary.

## Architecture at a glance

The voice agent is OpenAI `gpt-realtime`, and the realtime session runs **in the browser**
over WebRTC — the browser holds a peer connection directly to OpenAI. The supervisor is
the **action backend**: it mints the ephemeral session token, executes the tool calls the
voice agent makes (permission-gated, server-side), and records cost. Audio never touches
the supervisor or the Hub.

Crucially, the realtime model is **not** inside the NAISYS agent process. It lives at the
human's end; the agent stays text-native behind the command-injection API it already
exposes. Putting a second continuous agent loop inside the NAISYS agent would mean two
brains fighting over what to do, and would force the Hub to relay raw audio.

**Why WebRTC over a server-relayed WebSocket:** the supervisor commonly runs on a small
droplet, and many operators may hold voice sessions at once. WebRTC keeps all audio
browser↔OpenAI direct, so the supervisor carries zero media regardless of session count —
it only mints tokens, executes tools, and writes cost rows. The trade-off is a wider
conversation-plane trust surface (the browser holds an ephemeral token and can modify the
session), but the **action plane stays locked**: every tool call is re-authorized
server-side by `VoiceToolBridge`, so the voice agent can never do anything the logged-in
user couldn't do by hand.

```
  Browser — floating voice control  ◄═══ WebRTC: audio + data channel ═══►  OpenAI gpt-realtime
     │   owns RTCPeerConnection, data channel, run-log subscription,
     │   log filtering, and response.create gating
     │
     │   HTTP        —  /voice/token mint, /voice/tool, /voice/cost
     │   Socket.IO   —  bob's logs:* room (down)
     ▼
  Supervisor — action backend (thin: no audio, no session held here)
     │   mint ephemeral token · VoiceToolBridge (3 tools, permission-gated)
     │   · write cost rows from pushed usage · relay bob's logs:* room
     │
     │   Hub relay (unchanged)  —  AGENT_RUN_COMMAND (down),  LOG_PUSH (up)
     ▼
  NAISYS agent "bob" — unchanged
```

**The single-channel principle:** the voice agent learns everything bob does by watching
**bob's run log**. Chat replies, command output, bob's own LLM reasoning — it all lands
there. Mail is a subset of the run log (inbound chat is appended to context, and context
appends are logged — `contextManager.append` → `logService.write`).

## The floating control

The voice session is owned by a **persistent floating control**, mounted at the app root
(not inside `ChatThread`), so it survives route changes — you can click around the app
while the conversation continues. Lower-right corner, showing:

- "You are **X** talking to **Y**" — X is the agent perspective the session started from,
  Y is the target agent being operated.
- Links to jump to Y's chat or run log.
- A hang-up button.

The mic button has two entry points, both rendered to the right of the send button:

- `ChatThread.tsx` — opens a **chat-mode** session, seeded with the page's `{agent}` as
  X and the `{participant}` as Y. Enabled only in a 1:1 chat with a NAISYS agent; in
  human-only or multi-agent threads it stays visible but disabled, with a tooltip
  explaining why (Phase 1 operates exactly one agent).
- `AgentRuns.tsx` — opens a **console-mode** session, seeded with `admin` as X and the
  page's `{agent}` as Y. This is the more verbose mode — full toolset, full run-log
  narration — intended for an operator who is already looking at the live log. Not
  gated on `shellModel`: the run-command tools dispatch through the host's NAISYS
  shell wrapper, which every running agent has regardless of whether it also has an
  LLM driving its own loop (e.g. the admin agent itself, which runs with
  `shellModel: "none"`).

Silently hiding either taught operators wrong things about when voice is available.

The session machinery lives in a `VoiceSession` class held by a `VoiceSessionContext`
provider at the app root. Each call is one instance with its own `AbortController`. The
class owns the `RTCPeerConnection`, the data channel, the mic, narration timing, VAD
gating, tool-call forwarding, cost push, and transport-failure handling — i.e. everything
a server-side `RunLogWatcher` would have done in a WebSocket design. Hanging up or
starting a replacement session aborts the old instance, which cleanly cancels in-flight
network calls and prevents stale event handlers from leaking into the next session's
state. Transport failures (ICE disconnect after a short grace, DTLS failure, data channel
error/close) flip the control to a visible Error state with a reason rather than sitting
on a stale "Live" badge while audio has stopped flowing.

One session per browser in phase 1 (retargeting is a follow-up).

## The core loop

1. Admin is on `/supervisor/agents/{agent}/chat/{participant}` (e.g. `.../admin/chat/bob`)
   and presses the mic button.
2. The supervisor mints an ephemeral `gpt-realtime` token with the locked session config
   (operator-assistant instructions, the three tools, light context about the target
   agent). The browser establishes the WebRTC connection and the floating control appears.
3. Admin speaks. The realtime model decides whether to answer directly or call a tool.
4. Tool calls arrive at the browser over the data channel; the control forwards them to
   the supervisor's `VoiceToolBridge`, which executes them against bob and returns the
   result.
5. The control's `logs:*` subscription streams bob's run log; it filters and injects
   entries into the session, and decides when to give the model a turn.
6. The voice agent narrates progress back to admin (see "When the voice agent speaks").

The voice agent is the _operator's assistant pointed at bob_ — not "bob with a voice" —
so it needs no persona transplant.

## The three tools

All three are built on existing mechanisms; tool calls are forwarded from the browser to
the supervisor's `VoiceToolBridge` for execution. **Chat-mode sessions only see Tool 1**
— Tools 2 and 3 are dropped from both the realtime session config and the system message,
and `/voice/tool` rejects them server-side as defence in depth. **Console mode** sees all
three.

| Tool                     | Mechanism                                                                                                                     | bob's LLM sees output?                                      | Use                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **1. talk to agent**     | Supervisor `sendChatMessage(fromId, [toId], msg)` — the existing chat API                                                     | Yes (normal inbound chat)                                   | Delegate work / converse with bob's LLM. e.g. "go find why the build is slow"               |
| **2. run debug command** | `AGENT_RUN_COMMAND` with a bare command → runs as a `debugCommand` in bob's debug mode                                        | **No** — output goes to the run log only, not bob's context | Voice agent runs diagnostics without disturbing bob's context. e.g. `git log --oneline -20` |
| **3. run `!` command**   | `AGENT_RUN_COMMAND` with `!<command>` → `ns-cmd` (alias `!`, `isDebug`) runs it and bridges input + output into bob's context | **Yes**                                                     | Hand bob a result to work with. e.g. `!npm test`                                            |

Notes:

- **Tool 1 is `ns-chat`, not `@`.** `@`/`ns-talk` hardcodes `Message from {ADMIN_USERNAME}`
  and can't carry a real sender. `ns-chat` (via `sendChatMessage`) carries a real `fromId`,
  renders as a normal bubble in `ChatThread`, and reaches bob through the normal mail path.
  `fromId` is the hub user id of the `{agent}` in the page URL — the chat route already
  takes `fromId` from the request and resolves it against `hubDb.users`. The route is gated
  by the `agent_communication` permission. Responsiveness depends on bob's `wakeOnMessage`
  (default on): `ns-chat` wakes bob but does not force an immediate turn the way `@` would.
- **Tool 2 vs 3** is exactly the NAISYS debug-mode distinction: a bare debug command's
  output is logged but not added to the agent's LLM context, while `ns-cmd`/`!` explicitly
  bridges input + output into context. Tool 2 lets the voice agent _see_ something (via
  the run log) without bob seeing it; tool 3 _deposits_ something into bob's working memory.
- Tools 2 and 3 require bob to already be running with an active run session. If bob is
  stopped, the voice agent should use Tool 1 first; chat delivery can wake bob and delegate
  the request for its next cycle.
- Tools 2 and 3 are gated by the `remote_execution` permission.
- The NAISYS agent is unchanged — all three ride existing injection paths.

## Watching the run log

The voice agent's view of bob is **bob's run log**, which the floating control subscribes
to via the existing `logs:*` Socket.IO room (the same machinery the run-log viewer uses).
Watching bob's log — not the admin agent's — is the point: the admin agent's log only
shows the chat round-trips, which is exactly the latency we want to skip.

- **Granularity is command-completion, not token-by-token.** `shellWrapper.executeCommand()`
  buffers a command's output and returns it whole when the command finishes
  (`shellCommand.ts:50`). In practice this is still a steady stream — bob runs many
  commands per task — but a single long-running command leaves the voice agent quiet
  until it completes. Mitigations: NAISYS _suspends_ long commands and checkpoints partial
  output; `AGENT_PEEK` can poll bob's live output buffer mid-command for "what's bob doing
  right now."
- **Feed a filtered projection, not the firehose.** `LOG_PUSH` entries are structured
  (role / source / type). The control filters to the meaningful entries before injecting
  them into the session — don't pay realtime-audio token prices to narrate "LLM working…"
  spinners and token warnings.
- **Follow session rotation.** The run log is keyed by
  `(user_id, run_id, subagent_id, session_id)`; `session_id` rotates when bob compacts
  (`incrementSession`). The control must follow the active session across that boundary.
- **Follow the subagent tree.** If bob delegates to a subagent, the real work is in the
  subagent's log stream (different `subagent_id`). Follow it, or the voice agent only
  sees "bob is waiting on a subagent."
- **Latch is event-driven, not polled.** The control takes one REST snapshot of bob's
  runs when the voice session opens, then subscribes to the existing `runs:${bob}`
  Socket.IO room (the same feed the runs page uses) and recomputes the active log
  target on `new-session` and `heartbeat-update` events. Compaction's incremented
  `session_id` arrives as a new-session event, subagent handoff as another, and a
  cold-start wake from `talk_to_agent` as the very first new-session of that boot —
  no separate post-message kick needed. **Heartbeat-update upserts** (rather than
  only bumping a known run's `lastActive`) so a missed new-session — socket
  reconnect, subscription timing race, brief server/browser gap — is recoverable
  within a few seconds without falling back to polling. The snapshot is bound to
  the `VoiceSession` instance, not a `useEffect` keyed on session status, so the
  normal connecting → live transition can't wipe the latch after socket events have
  already populated it.
- **Images travel with the digest.** When a log entry carries an image attachment
  (detected by mime type on `attachmentFilename`), `voiceLogBuffer` collects it
  alongside the coalesced text. At flush, the scheduler fetches each image
  auth-aware from `/supervisor/api/attachments/:id/:filename`, base64-encodes
  it, and emits a single `conversation.item.create` with the text digest plus
  `input_image` items (`image_url` data URLs). Guards: a per-digest cap
  (`MAX_IMAGES_PER_DIGEST = 4`) with the omitted count surfaced inline in the
  text; a `MAX_IMAGE_BYTES` skip for oversized files (no down-sampling); and
  **session-level dedup** by `attachmentId` so a recurring screenshot id isn't
  re-priced. Fetch failures degrade to text-only — image I/O never blocks
  narration. Realtime image-token usage flows through the existing cost path
  unchanged: `inputImageTokens` / `inputCachedImageTokens` are extracted from
  `response.done` and folded into the costs row's `input_tokens` /
  `cache_read_tokens` columns (the costs table has no image bucket;
  `computeRealtimeModelCost` already prices them at the per-model rate).
- **Two image sources, one pipeline.** The pipeline above expects images on
  `LogPushEntry.attachmentId`, which today only the **shell-produced image**
  path populates: `contextManager.appendImage` (driven by `ns-look` /
  `ns-desktop`) calls `logService.write({filepath})`, the hub uploads, and the
  resulting log entry carries the id. Inbound chat with image attachments
  takes a different code path — `formatUnreadChatLine` textifies attachments
  as ` [filename size]` and `contextManager.append` is called _without_
  `filepath`, so the image bytes never reach the run log. To close that gap
  in **chat mode**, the floating control adds a second subscription to the
  existing `chat-messages:${sortedParticipants}` socket room (the same feed
  `ChatThread` uses) and, on each `new-message` with image attachments,
  synthesizes `LogPushEntry`-shaped items via `voiceChatImages` and feeds
  them through `injectLogEntries`. The same buffer/cap/dedup/fetch path
  handles them — a screenshot attached to chat and the same id appearing
  later in bob's shell log produce one fetch, not two. **Console mode**
  intentionally does _not_ subscribe to chat (the operator is on the runs
  page, not in any particular chat thread); shell-produced images are the
  only source there.

## When the voice agent speaks

Two layers, both handled in the floating control:

- The **control** decides when to give the realtime model a turn (`response.create`).
- The **model** decides what to say within a turn.

Don't trigger a response on every log line — inject log activity as silent conversation
items, and only `response.create` at boundaries: a command/delegation finished (a fresh
prompt line in bob's log means bob is idle again), or bob emitted something addressed to
the operator. Because the voice agent narrates from raw work-in-progress, its instructions
should report progress without over-committing to intermediate states as final — bob's
raw log includes dead ends.

The control gates `response.create` with three signals layered together:

- **Trailing debounce** at the last log entry, plus a **max-wait ceiling** so a steady
  stream of log entries can't starve narration entirely (purely-trailing debounce never
  fires under continuous activity). The model is allowed to stay silent on a forced
  turn — its instructions explicitly permit silence on noise.
- **User intent wins.** The control watches the realtime stream's VAD events
  (`input_audio_buffer.speech_started` / `speech_stopped`). While the operator is
  speaking, log-driven narration is suppressed; a short post-speech grace holds the
  suppression until the user's VAD-created `response.created` arrives. Without that
  grace, a max-wait timer can fire in the gap between "user stopped" and "model got the
  turn", and the model answers the logs instead of the operator.
- **Realtime turns are completed only.** Tool calls execute only on `response.done` with
  `status === "completed"`. The realtime API also fires `response.done` for cancelled /
  failed / incomplete responses, where function-call arguments may be partial or
  mid-stream — running them would dispatch real actions (chat sends, shell commands) on
  the operator's behalf from an unfinished call. Cost recording is on a separate path
  (see below) and runs for every `response.done` regardless of status.

bob's eventual `ns-chat send` back to the operator is, by this point, just one more log
entry — usually the voice agent has already narrated the result from the raw log. It is a
useful "bob considers this done" signal, and it still populates the `ChatThread` text
record.

## Costs

`gpt-realtime` usage is logged to the existing `costs` table, attributed to the **admin
agent's session**.

- In hub mode every NAISYS host starts the admin agent (`getStartupUserIds()` →
  `[adminId]`); it runs with `shellModel: "none"` — a live but idle session — so a full
  `(user_id, run_id, subagent_id, session_id, host_id)` tuple already exists to attach
  costs to, and it normally carries no other cost. (The admin agent is per-host; attach to
  the relevant host's admin session — costs aggregate by `user_id` regardless.)
- Add a `voice` value to the `CostSource` enum (one migration).
- **Usage capture path.** Because the session is browser-held, `response.done` usage
  events arrive at the floating control. The control posts usage to the supervisor via
  `/voice/cost` per `response.done`, and the supervisor writes the `costs` row directly
  (it has direct `hubDb` access). Pushed per turn, not batched at hang-up, so an abrupt
  tab close only loses the last partial turn's cost rather than the whole session's.
- Row contents: admin-agent session coords, `source: "voice"`, `model: "gpt-realtime-2"`,
  audio + text usage folded into `input_tokens` / `output_tokens`.
- **Bump the admin agent's `spendLimitDollars`** (currently `1` — realtime audio would
  trip it within minutes and the Hub's cost-control would suspend the admin agent). This
  doubles as a real cost cap on voice usage. Switched to a rolling daily cap rather than
  a fixed all-time cap so it auto-resets each period instead of permanently suspending the
  admin user once exceeded. Budget is enforced at mint time **and** re-checked after every
  turn — over-cap responses tell the client to hang up immediately.
- **Action-plane authentication on the cost path.** Each minted session gets an opaque
  server-side `voiceSessionId` bound to the supervisor user + sender + target. Every
  `/voice/cost` and `/voice/tool` post must carry it. Without this, any authenticated
  `agent_communication` user could POST arbitrary cost rows and trip the admin cap, or
  re-target a stolen session id at a different agent. Per-bucket token clamps on the
  cost payload schema bound the worst-case single turn even from a session holder.
- **The cost payload is trusted within its clamps — the admin cap is the real ceiling.**
  The server prices the usage but does not (and cannot) cross-check the token counts
  against what OpenAI actually metered; a legitimate session holder can submit any
  numbers that fit the schema's per-bucket `.max()` clamps. Per-turn worst case is on
  the order of a few dollars, so a malicious or buggy client can accelerate hitting the
  admin spend cap but can't escape it. The admin `spendLimitDollars` is the real
  ceiling on voice spend — not the cost payload's integrity.
- **Mint, tool, and cost endpoints are rate-limited.** The mint endpoint is the tightest
  (10/min per IP) because each mint hits OpenAI's `client_secrets` endpoint and would
  drain OpenAI compute even without a connection ever forming (mints don't trip the
  spend cap until usage actually flows). `/voice/tool` and `/voice/cost` use a looser
  ceiling (120/min per IP) — well above real conversation pace — purely to catch a
  runaway client loop hammering either endpoint; they aren't a substitute for the
  per-bucket clamps or the admin cap, just defence-in-depth against bugs.
- **Cost recording fails closed.** Any non-success from `/voice/cost` (registry restart,
  expired session id, schema rejection, network outage) hangs the client up — the
  alternative is the model burning untracked tokens after the server has stopped
  accepting cost rows. The operator can re-mint to recover.

## Components to build

**Supervisor server** (stays thin — no audio, no session held here)

- Ephemeral token endpoint — mints a `gpt-realtime` session token with the locked session
  config (instructions, tools, voice).
- `VoiceToolBridge` — executes the three tools from browser-forwarded calls; enforces
  `agent_communication` (tool 1) and `remote_execution` (tools 2/3) permissions.
- Voice cost writer — receives usage at `/voice/cost`, `hubDb.costs.create` per
  `response.done`, re-checks the admin spend cap each turn.

**Supervisor client**

- **`VoiceSession` class** — encapsulates the `RTCPeerConnection`, data channel, mic,
  narration timing, VAD gating, tool-call forwarding, cost push, transport failure
  handling, and `AbortController`-based cancellation. One instance per call. No React.
- **`VoiceSessionContext` provider** — app-root provider that holds the active
  `VoiceSession`, exposes `session` state + `startSession` / `hangUp`, runs the `logs:*`
  subscription, and mounts the audio sink element.
- **Floating voice control** — small persistent component reading the provider. Shows
  "you are X talking to Y" with chat/run-log links and the hang-up button; surfaces the
  Error state on transport / cost / budget failures.
- `ChatThread.tsx` mic button — entry point that starts a session into the floating
  control. Disabled with an explanatory tooltip outside 1:1 chats with a NAISYS agent.
- Optionally persist voice turns as `kind=chat` messages so the conversation renders in
  the thread.

**Schema**

- `voice` added to the `CostSource` enum.

**Config**

- `gpt-realtime-2` model id and OpenAI key (supervisor-side, for token minting).
- Admin agent `spendLimitDollars` bump.

## Follow-ups / Phase 2

- **Word-by-word streaming.** Phase 1 narrates at command-completion granularity. Phase 2:
  finer-grained narration via `AGENT_PEEK` polling or incremental log streaming, so the
  voice agent can narrate _within_ a long-running command.
- **Per-user impersonation.** Phase 1: tool 1's `fromId` is the `{agent}` from the page
  URL, falling back to the admin agent if it cannot be resolved. Phase 2: if distinct
  human supervisor users should each chat under their own identity, verify every
  supervisor user maps to a usable `hubDb.users` id and wire that through.
- **Retargeting mid-conversation.** Phase 1 targets the one agent the session started on.
  Phase 2: let the voice agent switch targets ("now check on alex"), watching multiple
  run logs at once.
- **Voice transcript persistence.** Decide whether/how the spoken conversation is
  persisted (e.g. as `context_log` on the admin session, or as chat messages).
- **Session duration limits.** `gpt-realtime` sessions have a max length; a long voice
  conversation may need transparent re-establishment.
- **Multi-participant chats.** Phase 1's chat-mode session locks to a single 1:1
  thread. Phase 2: support group chats — subscribe to every participating agent's
  run log so the voice agent can narrate progress across all of them, not just the
  one target. Overlaps with retargeting (above) on the log-multiplexing side.
