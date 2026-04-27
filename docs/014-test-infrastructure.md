# Test Infrastructure

[← Back to main README](../README.md)

Notes on how the e2e and coverage tooling is wired together, the
non-obvious failure modes we hit, and the unfinished refactors that
would speed it up further. Mostly rooted in `apps/erp/server` because
that's the workspace with both vitest unit tests and a Playwright suite
hitting a managed webServer — the other workspaces are simpler.

This doc covers:

- How `npm run coverage:full` collects merged coverage across processes
- Two foot-guns that silently dropped coverage (SIGKILL, npm/tsx wrapping)
- Why login flake hits Playwright once a project grows past ~5 spec files
- The shared UI login helper and a Mantine selector pitfall
- The committed `COVERAGE.md` snapshot as a baseline-free diff workflow
- Open follow-ups worth picking up

## Coverage capture: who has to flush

`scripts/run-coverage.mjs` sets `NODE_V8_COVERAGE` to a shared raw dir,
runs `turbo test`, then runs `c8 report --all` over the accumulated
profiles. **Every Node process that exits while `NODE_V8_COVERAGE` is
set writes one `coverage-PID-*.json` into that dir** — vitest workers,
spawned hub/naisys/erp child processes, and the Playwright-managed erp
server all contribute. The flush only happens on graceful exit; SIGKILL
loses the profile.

Two ways the flush silently fails for the erp server, both of which
were active in the original config:

**1. Wrapper processes eat the signal.** `npm run dev` runs `tsx watch
src/erpServer.ts`. That spawns three processes: npm → tsx watch → the
inner node running fastify. Playwright's SIGTERM lands on the npm
wrapper; npm doesn't reliably forward to its child, so the inner node
gets SIGKILL'd by the eventual parent-death and writes nothing. Same
problem with `npx tsx ...` (npx is one extra hop). The fix is to load
tsx as an ESM import hook inside a single node process —
`node --import tsx src/erpServer.ts` — so node and fastify are the same
PID and there's nothing in the way of the signal. (`node dist/erpServer.js`
also works after a build, but pinning to the built output adds a
build dependency to `npm test`; tsx-via-import has neither concern.)

**2. Playwright's webServer always spawns through a shell.** Even with
`command: "node ..."`, the actual parent of the node process is `sh`.
Signal goes to the shell. Prefix with `exec` so the shell `exec`s into
node and the spawning PID _is_ the node process.

**3. Playwright kills the webServer with SIGKILL by default.** Even with
the cleanest possible process tree, the server's own
`process.on("SIGTERM", …)` handler never fires because Playwright doesn't
send SIGTERM unless you tell it to. The fix is `gracefulShutdown:
{ signal: "SIGTERM", timeout: 5000 }`.

**4. Reusing a stale server hides the instrumentation.** Playwright's
`webServer.reuseExistingServer` defaults to "yes if not CI". If anything
is already listening on the port — a leftover dev server, an aborted
prior run — Playwright will skip launching its own and use whatever is
there, which was almost certainly started without `NODE_V8_COVERAGE`. So
even with a perfectly configured launch, coverage can silently be zero
again. Guard against this in coverage runs specifically:
`reuseExistingServer: !process.env.CI && !process.env.NODE_V8_COVERAGE`.
The dev convenience of reusing a running server during plain
`npm test` is preserved; coverage runs always launch fresh.

Final webServer block in `apps/erp/server/playwright.config.ts`:

```ts
{
  command: "exec node --import tsx src/erpServer.ts",
  port: 3302,
  env: { /* ... NODE_V8_COVERAGE conditionally forwarded ... */ },
  reuseExistingServer:
    !process.env.CI && !process.env.NODE_V8_COVERAGE,
  gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
}
```

The combined effect on `apps/erp/server` was 35.17 % → 70.33 %
statement coverage. That delta wasn't new tests — it was tests that had
been running all along but whose coverage was being dropped on the
floor at server shutdown.

**How to spot this regression class.** If a workspace's coverage
percentage looks suspiciously close to "what gets imported at startup"
(everywhere ~30–40 %, route handler functions reporting 0 hits,
identical numbers between unrelated test runs), grep the raw v8 dump
for known-exercised handler functions — if their `count` is 0 across
every file in `coverage/raw/`, the flush is being skipped. The
debugging path: `lsof -ti:<port>` during a run to find the server PID,
then look for `coverage-<PID>-*.json` in the raw dir after shutdown.

## Auth rate-limit flake

`/erp/api/auth/login` is rate-limited to **5 requests per minute per
IP**. Each Playwright spec file logs in once in `beforeAll`. The API
specs each do at least one login. Once you grow past five spec files
that login during a single test run, the parallel workers race the
limiter and one (or more) of them gets a 429 — flaky.

Two things make this worse than it sounds:

- **Retries are counter-productive.** Naively retrying on 429 burns the
  same per-IP budget; five retries within a minute can leave the limiter
  _more_ exhausted than the original burst.
- **`reuseExistingServer` makes the limiter window slide across runs.**
  The limiter state lives in the server process; consecutive coverage
  invocations against the same server inherit each other's spent budget.

Fix is a server-side env override consumed by the route config, set
high only in test:

```ts
// apps/erp/server/src/routes/auth.ts
config: {
  rateLimit: {
    max: Number(process.env.AUTH_LOGIN_RATE_LIMIT) || 5,
    timeWindow: "1 minute",
  },
},
```

```ts
// apps/erp/server/playwright.config.ts (webServer.env)
AUTH_LOGIN_RATE_LIMIT: "1000",
```

Production behavior is unchanged because the env var is unset there.

## Shared UI login helper

Three Playwright UI specs had a copy-pasted `beforeAll` that POSTed to
`/auth/login` inline. The duplicate code drifted (one had retry logic,
others didn't) and made it hard to apply a fix once. Consolidated into
`apps/erp/server/e2e/auth-helper.ts`:

```ts
export async function loginAsTestUser(
  request: APIRequestContext,
  workerIndex: number,
);
```

Both API and UI specs call it with their respective request contexts
(`api` via `playwright.request.newContext()`, UI via `page.request`).
New specs only need:

```ts
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await loginAsTestUser(page.request, test.info().workerIndex);
});
```

### Mantine selector pitfall

Mantine's `Autocomplete` renders **both** an input and a listbox sharing
the same accessible label. `page.getByLabel("Produces Item")` is a
strict-mode violation because two elements match. Use
`page.getByRole("textbox", { name: "Produces Item" })` instead. The
`Add Field` / `Add Operation` modals don't have this problem because
they use plain `TextInput`. Worth knowing for any new Autocomplete
control we add.

## Coverage progress as a committed snapshot

`scripts/run-coverage.mjs` writes `COVERAGE.md` at the repo root on
every run. It contains the per-workspace statement totals as a
markdown table — no timestamp, so an unchanged coverage run produces no
diff and no spurious commit.

The workflow this enables:

1. Make a change.
2. Run `npm run coverage:full`.
3. `git diff COVERAGE.md` shows exactly what your change moved.

That replaces the old `git stash → run → pop → run → diff` dance for
measuring coverage impact, since the previous `COVERAGE.md` line in git
_is_ the baseline. `git log -p COVERAGE.md` is the project's coverage
progress log.

`coverage/` (the c8 raw + html output) stays in `.gitignore`;
only the rolled-up summary file is checked in.

## Open follow-ups

- **Browser-side coverage.** The Chromium-side code in
  `apps/erp/client` and `apps/supervisor/client` is not measured today.
  Playwright's `page.coverage` API can capture per-page V8 profiles for
  the browser; merging those with the Node-side raw data into c8 would
  close the largest gap. Worth doing only if the client-side LOC is
  enough to move the meter.
- **Promote `loginAsTestUser` to a Playwright fixture.** A custom
  fixture that returns a pre-authenticated `page` would let specs drop
  their `beforeAll` entirely and inherit the auth setup. Minor
  ergonomic win; useful when a fourth or fifth UI spec lands.
- **Make the test-mode env vars one bag.** Right now
  `playwright.config.ts` enumerates `NAISYS_FOLDER`, `SUPERVISOR_AUTH`,
  `SERVER_PORT`, `AUTH_LOGIN_RATE_LIMIT`, and conditionally
  `NODE_V8_COVERAGE`. As more knobs accumulate (e.g. a `TEST_MODE=1`
  bypass for limiters), folding them into a single `testEnv` helper
  imported by both Playwright and any standalone harness would keep
  drift down.
- **Worker-aware login staggering.** Even with the rate limit lifted,
  if we ever revert that or run against a stricter staging env, a
  small `await sleep(workerIndex * 50)` before the first login removes
  the thundering-herd pattern almost for free.
- **Per-spec test data isolation.** Specs currently namespace records
  with `Date.now()`. That's fine for parallel workers but makes
  cross-run debugging ugly because every run's data lingers in the
  test sqlite. `globalSetup` already truncates all data tables — at
  the cost of one full wipe per playwright invocation. If we ever want
  selective teardown we'd need per-spec cleanup hooks.
