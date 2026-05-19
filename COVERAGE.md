# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server), selected workspace Vitest coverage maps,
plus the supervisor + erp client React code via vite-plugin-istanbul.
Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 48,537 / 75,672 statements (64.14%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,764 | 25.69% |
| apps/erp/server | 12,032 | 15,802 | 76.14% |
| apps/erp/shared | 2,056 | 2,058 | 99.90% |
| apps/hub | 4,400 | 5,865 | 75.02% |
| apps/naisys | 11,099 | 20,147 | 55.09% |
| apps/supervisor/client | 1,895 | 6,654 | 28.48% |
| apps/supervisor/server | 9,357 | 13,363 | 70.02% |
| apps/supervisor/shared | 1,860 | 1,882 | 98.83% |
| packages/common | 1,840 | 2,242 | 82.07% |
| packages/common-node | 1,015 | 1,601 | 63.40% |
| packages/hub-database | 224 | 309 | 72.49% |
| packages/hub-protocol | 1,306 | 1,306 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
