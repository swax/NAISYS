# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server), selected workspace Vitest coverage maps,
plus the supervisor + erp client React code via vite-plugin-istanbul.
Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 48,776 / 75,981 statements (64.19%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,764 | 25.69% |
| apps/erp/server | 12,054 | 15,804 | 76.27% |
| apps/erp/shared | 2,056 | 2,058 | 99.90% |
| apps/hub | 4,540 | 6,090 | 74.55% |
| apps/naisys | 11,076 | 20,129 | 55.03% |
| apps/supervisor/client | 1,891 | 6,630 | 28.52% |
| apps/supervisor/server | 9,359 | 13,370 | 70.00% |
| apps/supervisor/shared | 1,860 | 1,882 | 98.83% |
| packages/common | 1,942 | 2,359 | 82.32% |
| packages/common-node | 1,015 | 1,601 | 63.40% |
| packages/hub-database | 224 | 309 | 72.49% |
| packages/hub-protocol | 1,306 | 1,306 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
