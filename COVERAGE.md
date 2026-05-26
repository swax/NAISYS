# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server), selected workspace Vitest coverage maps,
plus the supervisor + erp client React code via vite-plugin-istanbul.
Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 49,459 / 77,087 statements (64.16%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 968 | 3,767 | 25.70% |
| apps/erp/server | 12,070 | 15,831 | 76.24% |
| apps/erp/shared | 2,056 | 2,058 | 99.90% |
| apps/hub | 4,427 | 5,932 | 74.63% |
| apps/naisys | 10,938 | 20,033 | 54.60% |
| apps/supervisor/client | 1,813 | 6,632 | 27.34% |
| apps/supervisor/server | 9,871 | 14,217 | 69.43% |
| apps/supervisor/shared | 1,989 | 2,009 | 99.00% |
| packages/common | 2,309 | 2,747 | 84.06% |
| packages/common-node | 1,024 | 1,589 | 64.44% |
| packages/hub-database | 224 | 309 | 72.49% |
| packages/hub-protocol | 1,284 | 1,284 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
