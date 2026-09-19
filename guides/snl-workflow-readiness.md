# Automated sketch workflow readiness

The September 18–19 readiness update is intentionally separate from starting a
new sketch run. Server workflow revision **NEW-SKETCH 35** is a draft cloned from
34; existing order runs are unchanged. Activate it only after the server supports
the endpoints below. No new order or indexing request was started by this update.

## StarMapr on ZBOOK-WSL

The updated checkout is `/home/swax/StarMapr`. Source is backed up beneath
`/home/swax/.local/state/starmapr-config-backups/`. Credentials, existing models
and photos are unchanged by this source update.

- Reuse a model only when its versioned quality report is valid. Automatically
  retrain legacy/stale models on demand; archive previous training/testing data
  and preserve the promoted model until replacement succeeds.
- Preserve the AWS response cache and request ledger across training retries.
- Preflight Node, ffmpeg, yt-dlp and AWS permission before training. Establish a
  decodable video download first. Metadata-only cache folders do not count.
- Pass all on-screen actors in one invocation. Split the video's total AWS cap
  across those actors deterministically. Record exhausted budgets as abstentions.
- Publish bounded `STARMAPR_PROGRESS` events and full private subprocess logs.
  API job status includes the last real phase event; a waiting heartbeat alone
  does not prove useful progress.
- Consume only current accepted result-manifest entries. Omit uncertain portraits
  and confirmed voice-only appearances. Do not upload arbitrary training photos
  to general person galleries to fill an image-count quota.

Current temporary AWS login is read from the existing Windows profile/cache.
Refresh from Windows when necessary with `aws login --profile default --region
us-east-1`. No new IAM principal or permanent credential was created.

## SketchTV source identity

The implementation is in the isolated `codex/snl-workflow-readiness` worktree at
`C:/git/naisys/.test-naisys/scdb-readiness`.

- API discovery advertises `GET /api/sketches/by-source?url=<encoded URL>`.
- Normalize YouTube watch/shorts/embed/live/youtu.be variants and Vimeo URLs.
  Query real source URLs, independently of title/full-text search.
- Both sketch-create endpoints repeat the check. Same-source API creates take
  PostgreSQL transaction advisory locks and check/write in the same transaction.
  Duplicate creation returns 409 with existing IDs/slugs.
- Intentional compilation/shared-video entries can explicitly set
  `allow_shared_source`; NEW-SKETCH agents must not use it to bypass duplicates.
- Run the check at selection and immediately before publication. Following an
  uncertain POST response, look up the exact source before retrying.

Unsupported platforms are explicitly rejected by exact lookup, not reported as
zero matches. The new automated workflow selects supported sources. This guard
covers the two API create routes, not arbitrary direct database/CMS edits, and
does not claim to detect a reupload with a different video ID; title/research
checks remain necessary. Current lookup scans source arrays for legacy URL
compatibility; a normalized indexed source table is a possible later scaling step.

## ERP external retry timing

The additive migration adds `operation_runs.retry_not_before` and its index.
`POST .../ops/{seqNo}/fail` accepts an optional timezone-aware `retryNotBefore`
and requires a blocker note when supplied. The failure remains durable.

- Normal dispatch excludes future retries; `includeDeferred=true` makes them
  inspectable with `canWork=false`. `canWork=true` always excludes future retries.
- Reopen is disabled in HATEOAS and rejected server-side until the time passes.
- After eligibility, a manager must explicitly reopen it; the timestamp clears.
  This is not a background worker scheduler or an automatic agent wakeup.
- The operation UI shows the retry time. Indexing requested and indexed are
  distinct from automation completed and the site's NeedsReview state.

For quota limits with no exact reset supplied, choose a conservative future
check and identify it as an estimate. Do not turn a stopped manager into a claim
that a retry has been scheduled. Technicians report the blocker; Nick owns the
fail/reopen transitions. Release desktop resources before sending the final
report and completing the agent session.

## Verification and rollout

Validated locally: 44 StarMapr synthetic regression tests, blank-image AWS HTTP
200, 73 ERP tests (including a real version-46 startup migration), a local ERP API integration test for storage/dispatch/
early-reopen rejection/elapsed retry, ERP server build/client type check, and
SketchTV compilation plus 12 source-identity tests. No real-photo identification,
actor training, or celebrity benchmark was executed by this work.

Before another live order: release/deploy the ERP code and SketchTV source API,
verify API discovery exposes the new capabilities, then approve revision 35.
Keep recurring scheduling disabled. Start a new test only when requested.

### One-time server conversion from npm to Git

The live server currently runs the npm install from `/home/naisys`; hash targets
are ignored by npm installations. The updater supports a full commit hash only
after the runner is launched from the NAISYS Git checkout.

`release/deploy-git-server.sh FULL_COMMIT_HASH`, run as the existing `naisys`
account, builds `/home/naisys/naisys-git` before stopping the current PM2 server.
It keeps the same working directory and `/var/naisys` data, backs up SQLite
databases and private PM2 launch configuration, then switches just that server.
The existing npm installation is retained for rollback. This script is specific
to upgrading the existing ERP schema 46 to 47. The schema-version bump is required
for startup to apply the additive retry migration.

After conversion, Supervisor Admin should show a Git version. Future updates can
use `/FULL_COMMIT_HASH`, or `>=3.0.4/FULL_COMMIT_HASH` to retain the existing npm
floor for other hosts. The target applies to all eligible connected Git hosts;
inspect the host list before changing it. A target does not convert npm hosts.

The existing StarMapr user-run benchmark takes independently labeled held-out
positive/negative examples and rejects exact training-image leakage:

```sh
cd /home/swax/StarMapr
uv run --extra aws python 90_benchmark_validation.py /path/to/held-out-manifest.json --aws
```

Passing software tests is not a measurement of real-world identity accuracy.
The benchmark is separate from an unattended production workflow; no mandatory
manual face-review stage has been added.
