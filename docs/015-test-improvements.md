# Test Helpers and Factoring

[<- Back to main README](../README.md)

Sister doc to [014-test-infrastructure](014-test-infrastructure.md), which covers
the e2e/coverage plumbing. This one is about how individual tests are written:
dependency-graph wiring, per-test boilerplate, domain setup, and places where
new tests are already reinventing helpers that should be shared.

This doc covers:

- ERP API and UI helpers for HATEOAS/status assertions and authenticated pages
- Testing real pure functions instead of copied production implementations
- OpenAPI route registration drift and enum-sync helper scope
- Feedback on the existing suggestions, including what to keep, revise, or defer

## Highest-Leverage Changes

In rough priority order:

1. Promote ERP login to a Playwright fixture and add ERP API assertion helpers.
2. Stop testing copied production functions in `costTracker.test.ts`.
3. Replace duplicated ERP OpenAPI route lists with production route registration.

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

## ERP API Test Client and Assertions

The Playwright API specs repeat base URLs, response parsing, status assertions,
HATEOAS assertions, conflict response checks, audit lookup checks, and domain
setup. Examples:

- `order-runs-api.spec.ts:23-45` creates an order and revision
- `order-runs-api.spec.ts:153-162`, `:193-212`, `:263-270`, and `:272-298`
  repeat conflict assertions
- `order-runs-api.spec.ts:121-135` and `:173-187` repeat audit entry checks
- `order-revisions-api.spec.ts:47-66` creates a revision and checks actions
- `order-revisions-api.spec.ts:117-135` and `:211-219` repeat conflict checks

Create `apps/erp/server/e2e/api/helpers/erp-api-client.ts`:

```ts
export async function expectJson<T>(res: APIResponse, status: number) {
  expect(res.status()).toBe(status);
  return (await res.json()) as T;
}

export async function expectConflict(res: APIResponse, message?: string) {
  const body = await expectJson<{ message: string; error: string }>(res, 409);
  expect(body.error).toBe("Conflict");
  if (message) expect(body.message).toContain(message);
  return body;
}

export function expectActions(
  body: { _actions?: { rel: string }[] },
  rels: string[],
) {
  expect(body._actions).toEqual(
    expect.arrayContaining(rels.map((rel) => expect.objectContaining({ rel }))),
  );
}
```

Domain setup helpers should be small and composable:

- `createOrder(api, overrides?)`
- `createRevision(api, orderKey, overrides?)`
- `createOrderWithRevision(api, overrides?)`
- `createOrderRun(api, orderKey, data)`
- `expectAuditEntry(api, { entityType, entityId, action, field, oldValue, newValue })`

This is a good place to standardize the API base URL too. `auth-helper.ts`
already has `const API = "http://localhost:3302/erp/api"`; export it or expose
an `erpApiPath(path)` helper so each spec stops redeclaring it.

## ERP UI Fixtures and Page Actions

[014](014-test-infrastructure.md#shared-ui-login-helper) already recommended
consolidating ERP UI login. The new
`apps/erp/server/e2e/ui/master-data-to-dispatch.spec.ts` imports
`getTestCredentials` but still POSTs to `/auth/login` inline. Existing UI specs
also repeat the same `beforeAll` login shape.

Next step: promote authentication to a Playwright fixture:

```ts
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ browser }, use, testInfo) => {
    const page = await browser.newPage();
    await loginAsTestUser(page.request, testInfo.workerIndex);
    await use(page);
    await page.close();
  },
});
```

Then UI tests can focus on workflow steps instead of setup.

The existing `createOrderWithRevision` helper is a good start, but it has an
interface drift issue: `order-lifecycle.spec.ts` passes `orderName`, while
`order-setup.ts` only declares `uniqueKey` and `orderDesc`. The e2e folder is
not included by `apps/erp/server/tsconfig.json`, so this kind of drift may not
be caught by `tsc`. Add type-check coverage for Playwright specs or a dedicated
`tsconfig.e2e.json`.

Good UI page-action helpers:

- `createOrderWithRevision(page, opts)`
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
