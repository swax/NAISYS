# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 45,402 / 69,940 statements (64.92%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,754 | 25.76% |
| apps/erp/server | 11,961 | 15,657 | 76.39% |
| apps/erp/shared | 2,050 | 2,052 | 99.90% |
| apps/hub | 3,801 | 4,723 | 80.48% |
| apps/naisys | 10,761 | 19,655 | 54.75% |
| apps/supervisor/client | 1,703 | 5,466 | 31.16% |
| apps/supervisor/server | 8,614 | 12,099 | 71.20% |
| apps/supervisor/shared | 1,602 | 1,620 | 98.89% |
| packages/common | 1,480 | 1,748 | 84.67% |
| packages/common-node | 621 | 1,075 | 57.77% |
| packages/hub-database | 165 | 221 | 74.66% |
| packages/hub-protocol | 1,191 | 1,191 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
