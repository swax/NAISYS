# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 41,470 / 63,227 statements (65.59%)**

| Workspace                    | Covered |  Total |       % |
| ---------------------------- | ------: | -----: | ------: |
| apps/erp/client              |     967 |  3,747 |  25.81% |
| apps/erp/server              |  11,963 | 15,667 |  76.36% |
| apps/erp/shared              |   2,051 |  2,053 |  99.90% |
| apps/hub                     |   3,362 |  4,140 |  81.21% |
| apps/naisys                  |   9,570 | 17,764 |  53.87% |
| apps/supervisor/client       |   1,135 |  4,100 |  27.68% |
| apps/supervisor/server       |   7,533 |  9,957 |  75.66% |
| apps/supervisor/shared       |   1,351 |  1,353 |  99.85% |
| packages/common              |   1,312 |  1,577 |  83.20% |
| packages/common-node         |     513 |    965 |  53.16% |
| packages/hub-database        |     174 |    259 |  67.18% |
| packages/hub-protocol        |   1,096 |  1,096 | 100.00% |
| packages/supervisor-database |     443 |    549 |  80.69% |
