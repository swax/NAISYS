# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 48,262 / 75,581 statements (63.85%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,764 | 25.69% |
| apps/erp/server | 12,050 | 15,802 | 76.26% |
| apps/erp/shared | 2,056 | 2,058 | 99.90% |
| apps/hub | 4,382 | 5,857 | 74.82% |
| apps/naisys | 11,099 | 20,136 | 55.12% |
| apps/supervisor/client | 1,892 | 6,652 | 28.44% |
| apps/supervisor/server | 9,252 | 13,294 | 69.60% |
| apps/supervisor/shared | 1,859 | 1,881 | 98.83% |
| packages/common | 1,840 | 2,242 | 82.07% |
| packages/common-node | 849 | 1,601 | 53.03% |
| packages/hub-database | 224 | 309 | 72.49% |
| packages/hub-protocol | 1,306 | 1,306 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
