# Test Helpers and Factoring

[<- Back to main README](../README.md)

Sister doc to [014-test-infrastructure](014-test-infrastructure.md), which covers
the e2e/coverage plumbing. This one is about how individual tests are written:
dependency-graph wiring, per-test boilerplate, domain setup, and places where
new tests are already reinventing helpers that should be shared.

This doc covers:

- Testing real pure functions instead of copied production implementations
- OpenAPI route registration drift and enum-sync helper scope
- Remaining ERP UI page-action helpers
- Feedback on the existing suggestions, including what to keep, revise, or defer

## Highest-Leverage Changes

In rough priority order:

1. Stop testing copied production functions in `costTracker.test.ts`.
2. Replace duplicated ERP OpenAPI route lists with production route registration.

## Test Real Pure Functions

`apps/naisys/src/__tests__/llm/costTracker.test.ts` currently copies production
logic into the test:

- `calculatePeriodBoundaries` is copied at `costTracker.test.ts:5-36`
- `calculateModelCacheSavings` is copied at `costTracker.test.ts:175-204`

That pattern is brittle. A copied implementation can pass forever while the real
implementation changes. The cache-savings test is already at risk because the
test copy reads snake_case fields like `cache_write_tokens`,
`cache_read_tokens`, and `modelData.total`, while production
`apps/naisys/src/llm/costDisplayService.ts` reads camelCase fields like
`cacheWriteTokens`, `cacheReadTokens`, `inputTokens`, and `outputTokens`, then
calculates total cost from those token counts. That is exactly the kind of
divergence copied test logic hides.

Fix:

- Add an optional `now = new Date()` parameter to
  `packages/common/src/costUtils.ts:calculatePeriodBoundaries`, then test the
  exported function directly.
- Move/export `calculateModelCacheSavings` from
  `apps/naisys/src/llm/costDisplayService.ts` into a small pure helper module,
  or export it as an internal testable helper if the project accepts that
  pattern.
- Convert the many period-boundary examples into `test.each` cases so adding a
  new boundary costs one row, not a full test body.

## ERP UI Page Actions

The fixture and API/domain helpers are in place
(`e2e/fixtures.ts`, `e2e/api/helpers/erp-api-client.ts`,
`e2e/api/helpers/order-fixtures.ts`). Remaining UI work: extract page-action
helpers so spec bodies focus on workflow, not Playwright primitives.

Good UI page-action helpers:

- `approveRevision(page)`
- `cutOrderRun(page, opts?)`
- `expectRunStatus(page, status)`
- `startOrderRun(page)`
- `closeOrderRun(page)`
- `addOperation(page, opts)`
- `addStep(page, opts)`
- `addStepField(page, opts)`

Be conservative with generic helpers like `createMasterDataEntity`. They are
tempting, but a helper with `{ route, key, description, extraFields }` can become
an untyped mini-framework. Prefer named page actions until at least two specs
need the same shape.

The e2e folder is still not included by `apps/erp/server/tsconfig.json`, so
interface drift in helpers may not be caught by `tsc`. Adding a dedicated
`tsconfig.e2e.json` would close that gap.

## OpenAPI Spec Generation

The current ERP OpenAPI test hand-maintains a route list in
`apps/erp/server/src/tests/openapi-spec.test.ts:80-144`. Production route
registration lives in `apps/erp/server/src/erpRoutes.ts:36-122`.

The existing suggestion to avoid dynamic route discovery is right: reflecting
over whatever Fastify happened to register can make the test tautological. But
the current manual list duplicates production wiring and can drift. It already
appears to omit the second `stepFieldAttachmentRoutes` registration that
production has for `/sets/:setIndex/...`.

Better target:

- Keep a minimal test app helper that registers cookie, multipart, swagger, and
  Zod compilers.
- Register production `erpRoutes`, not `erpPlugin` and not a copied route list.
  `erpPlugin` does DB/migration/server work; `erpRoutes` is the schema route
  graph.
- Add a few explicit path assertions for critical routes if you still want the
  test to prove important routes exist.

Supervisor already does the simpler version by registering `apiRoutes` directly.
ERP should follow that pattern.

## Mock Factory Overrides

`createMockPromptBuilder` takes positional config; most other `createMock*`
factories take no overrides. Tests then mutate mocks after construction, such as
`commandLoop.esc.test.ts:48-50`.

Override-accepting factories are useful:

```ts
export function createMockOutputService(
  overrides: Partial<OutputService> = {},
): OutputService {
  return {
    notice: vi.fn(),
    write: vi.fn(),
    comment: vi.fn(),
    // ...
    ...overrides,
  };
}
```

Do this incrementally. Changing all factories mechanically is low risk but
creates noisy churn. Start with the factories used by the new builders:

- `createMockPromptBuilder`
- `createMockOutputService`
- `createMockContextManager`
- `createMockAgentConfig`
- `createMockGlobalConfig`
- `createMockInputMode`
- `createMockCommandLoopState`

Once the pattern is established, convert the rest opportunistically.

## Duplicated Enum Sync

The same helper appears in:

- `apps/erp/server/src/tests/enum-sync.test.ts`
- `apps/supervisor/server/src/tests/hub-enum-sync.test.ts`

Extracting `assertEnumSync` is fine, but not worth creating a whole
`packages/test-utils` package by itself. Options in order:

1. Leave the duplication until there are more shared test utilities.
2. Add `@naisys/common/testing` only if there is already appetite for a shared
   testing entrypoint.
3. Create `packages/test-utils` once multiple test helpers need cross-workspace
   sharing.

The helper is small and stable, so this is low priority.

## Desktop `vi.mock("child_process")` Boilerplate

Three desktop tests repeat the same hoist/mock shape:

- `x11Desktop.test.ts`
- `waylandDesktop.test.ts`
- `windowsDesktop.test.ts`

Do not blindly wrap this in an imported `mockExecFileSync()` helper. Vitest
hoists `vi.mock` calls, and imported helper functions that call `vi.mock` can
behave differently than top-level mocks. Validate before abstracting.

Safer options:

- Keep the top-level hoist/mock in each file; it is explicit and cheap.
- Extract only post-mock utilities, such as `getExecFileSyncCalls()` or
  `expectKeyDownSequence(execFileSync, expected)`.
- If repetition grows, consider a Vitest manual mock for `child_process`.

This is a polish item, not a priority.

## Alternatives Considered

- **Broad ERP domain factories:** defer. API setup helpers like
  `createOrderWithRevision` are already repeated enough to extract, but broad
  object factories for every ERP entity should wait until multiple specs need
  the same shape.
- **Dynamic OpenAPI route discovery:** avoid. Reflecting whatever Fastify
  registered can make the test tautological; registering production `erpRoutes`
  keeps the test tied to real route wiring without copying the route list.
- **Cross-workspace e2e process harness:** avoid. NAISYS subprocess tests and
  ERP Playwright webServer tests have different lifecycles.
- **Imported `vi.mock("child_process")` helper:** avoid. Vitest statically
  hoists top-level `vi.mock` calls with its transformer; calling `vi.mock` from
  an imported helper does not get hoisted the same way.
- **New shared test-utils package for `assertEnumSync`:** defer. The helper is
  valid but too small to justify a new package by itself.
