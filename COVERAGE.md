# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 41,591 / 63,357 statements (65.65%)**

| Workspace                    | Covered |  Total |       % |
| ---------------------------- | ------: | -----: | ------: |
| apps/erp/client              |     967 |  3,751 |  25.78% |
| apps/erp/server              |  11,953 | 15,646 |  76.40% |
| apps/erp/shared              |   2,050 |  2,052 |  99.90% |
| apps/hub                     |   3,389 |  4,173 |  81.21% |
| apps/naisys                  |   9,572 | 17,768 |  53.87% |
| apps/supervisor/client       |   1,137 |  4,143 |  27.44% |
| apps/supervisor/server       |   7,519 |  9,923 |  75.77% |
| apps/supervisor/shared       |   1,358 |  1,360 |  99.85% |
| packages/common              |   1,329 |  1,594 |  83.38% |
| packages/common-node         |     598 |  1,055 |  56.68% |
| packages/hub-database        |     165 |    221 |  74.66% |
| packages/hub-protocol        |   1,103 |  1,103 | 100.00% |
| packages/supervisor-database |     451 |    568 |  79.40% |
