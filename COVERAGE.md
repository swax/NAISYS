# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 42,300 / 64,128 statements (65.96%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,751 | 25.78% |
| apps/erp/server | 11,954 | 15,658 | 76.34% |
| apps/erp/shared | 2,050 | 2,052 | 99.90% |
| apps/hub | 3,371 | 4,242 | 79.47% |
| apps/naisys | 10,056 | 18,185 | 55.30% |
| apps/supervisor/client | 1,141 | 4,203 | 27.15% |
| apps/supervisor/server | 7,680 | 10,065 | 76.30% |
| apps/supervisor/shared | 1,368 | 1,370 | 99.85% |
| packages/common | 1,356 | 1,621 | 83.65% |
| packages/common-node | 621 | 1,072 | 57.93% |
| packages/hub-database | 165 | 221 | 74.66% |
| packages/hub-protocol | 1,120 | 1,120 | 100.00% |
| packages/supervisor-database | 451 | 568 | 79.40% |
