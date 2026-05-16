# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 47,216 / 73,841 statements (63.94%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,754 | 25.76% |
| apps/erp/server | 11,996 | 15,692 | 76.45% |
| apps/erp/shared | 2,053 | 2,055 | 99.90% |
| apps/hub | 3,918 | 5,111 | 76.66% |
| apps/naisys | 10,999 | 20,067 | 54.81% |
| apps/supervisor/client | 1,822 | 6,397 | 28.48% |
| apps/supervisor/server | 9,110 | 13,098 | 69.55% |
| apps/supervisor/shared | 1,813 | 1,835 | 98.80% |
| packages/common | 1,724 | 2,017 | 85.47% |
| packages/common-node | 849 | 1,601 | 53.03% |
| packages/hub-database | 212 | 268 | 79.10% |
| packages/hub-protocol | 1,267 | 1,267 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
