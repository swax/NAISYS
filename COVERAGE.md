# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 40,301 / 61,644 statements (65.38%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,747 | 25.81% |
| apps/erp/server | 11,964 | 15,689 | 76.26% |
| apps/erp/shared | 2,051 | 2,053 | 99.90% |
| apps/hub | 3,362 | 4,140 | 81.21% |
| apps/naisys | 9,570 | 17,764 | 53.87% |
| apps/supervisor/client | 1,115 | 3,996 | 27.90% |
| apps/supervisor/server | 6,614 | 8,809 | 75.08% |
| apps/supervisor/shared | 1,245 | 1,247 | 99.84% |
| packages/common | 1,352 | 1,577 | 85.73% |
| packages/common-node | 506 | 950 | 53.26% |
| packages/hub-database | 174 | 259 | 67.18% |
| packages/hub-protocol | 1,096 | 1,096 | 100.00% |
| packages/supervisor-database | 285 | 317 | 89.91% |
