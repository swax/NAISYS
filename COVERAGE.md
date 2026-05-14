# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 46,185 / 71,751 statements (64.37%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,754 | 25.76% |
| apps/erp/server | 11,961 | 15,657 | 76.39% |
| apps/erp/shared | 2,050 | 2,052 | 99.90% |
| apps/hub | 3,929 | 5,138 | 76.47% |
| apps/naisys | 10,996 | 20,055 | 54.83% |
| apps/supervisor/client | 1,617 | 5,706 | 28.34% |
| apps/supervisor/server | 8,712 | 12,118 | 71.89% |
| apps/supervisor/shared | 1,641 | 1,659 | 98.92% |
| packages/common | 1,542 | 1,834 | 84.08% |
| packages/common-node | 851 | 1,610 | 52.86% |
| packages/hub-database | 165 | 221 | 74.66% |
| packages/hub-protocol | 1,268 | 1,268 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
