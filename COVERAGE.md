# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server), selected workspace Vitest coverage maps,
plus the supervisor + erp client React code via vite-plugin-istanbul.
Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 48,914 / 76,141 statements (64.24%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,766 | 25.68% |
| apps/erp/server | 12,054 | 15,802 | 76.28% |
| apps/erp/shared | 2,056 | 2,058 | 99.90% |
| apps/hub | 4,540 | 6,090 | 74.55% |
| apps/naisys | 11,078 | 20,129 | 55.04% |
| apps/supervisor/client | 1,882 | 6,609 | 28.48% |
| apps/supervisor/server | 9,358 | 13,370 | 69.99% |
| apps/supervisor/shared | 1,860 | 1,882 | 98.83% |
| packages/common | 2,088 | 2,540 | 82.20% |
| packages/common-node | 1,015 | 1,601 | 63.40% |
| packages/hub-database | 224 | 309 | 72.49% |
| packages/hub-protocol | 1,306 | 1,306 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
