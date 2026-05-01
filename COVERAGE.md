# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 43,092 / 65,172 statements (66.12%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,751 | 25.78% |
| apps/erp/server | 11,961 | 15,657 | 76.39% |
| apps/erp/shared | 2,050 | 2,052 | 99.90% |
| apps/hub | 3,440 | 4,255 | 80.85% |
| apps/naisys | 10,062 | 18,231 | 55.19% |
| apps/supervisor/client | 1,513 | 4,587 | 32.98% |
| apps/supervisor/server | 7,928 | 10,496 | 75.53% |
| apps/supervisor/shared | 1,414 | 1,416 | 99.86% |
| packages/common | 1,365 | 1,633 | 83.59% |
| packages/common-node | 620 | 1,073 | 57.78% |
| packages/hub-database | 165 | 221 | 74.66% |
| packages/hub-protocol | 1,121 | 1,121 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
