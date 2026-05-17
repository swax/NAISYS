# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 47,319 / 73,978 statements (63.96%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,764 | 25.69% |
| apps/erp/server | 11,996 | 15,692 | 76.45% |
| apps/erp/shared | 2,053 | 2,055 | 99.90% |
| apps/hub | 3,918 | 5,111 | 76.66% |
| apps/naisys | 11,053 | 20,053 | 55.12% |
| apps/supervisor/client | 1,875 | 6,542 | 28.66% |
| apps/supervisor/server | 9,110 | 13,098 | 69.55% |
| apps/supervisor/shared | 1,813 | 1,835 | 98.80% |
| packages/common | 1,721 | 2,014 | 85.45% |
| packages/common-node | 849 | 1,601 | 53.03% |
| packages/hub-database | 212 | 268 | 79.10% |
| packages/hub-protocol | 1,266 | 1,266 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
