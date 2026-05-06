# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 44,501 / 68,070 statements (65.38%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,751 | 25.78% |
| apps/erp/server | 11,961 | 15,657 | 76.39% |
| apps/erp/shared | 2,050 | 2,052 | 99.90% |
| apps/hub | 3,766 | 4,683 | 80.42% |
| apps/naisys | 10,607 | 19,345 | 54.83% |
| apps/supervisor/client | 1,588 | 4,918 | 32.29% |
| apps/supervisor/server | 8,148 | 11,277 | 72.25% |
| apps/supervisor/shared | 1,497 | 1,499 | 99.87% |
| packages/common | 1,470 | 1,738 | 84.58% |
| packages/common-node | 621 | 1,075 | 57.77% |
| packages/hub-database | 165 | 221 | 74.66% |
| packages/hub-protocol | 1,175 | 1,175 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
