# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 42,213 / 64,025 statements (65.93%)**

| Workspace                    | Covered |  Total |       % |
| ---------------------------- | ------: | -----: | ------: |
| apps/erp/client              |     967 |  3,751 |  25.78% |
| apps/erp/server              |  11,950 | 15,643 |  76.39% |
| apps/erp/shared              |   2,050 |  2,052 |  99.90% |
| apps/hub                     |   3,416 |  4,222 |  80.91% |
| apps/naisys                  |   9,977 | 18,154 |  54.96% |
| apps/supervisor/client       |   1,139 |  4,199 |  27.13% |
| apps/supervisor/server       |   7,655 | 10,046 |  76.20% |
| apps/supervisor/shared       |   1,370 |  1,372 |  99.85% |
| packages/common              |   1,349 |  1,614 |  83.58% |
| packages/common-node         |     596 |  1,055 |  56.49% |
| packages/hub-database        |     165 |    221 |  74.66% |
| packages/hub-protocol        |   1,128 |  1,128 | 100.00% |
| packages/supervisor-database |     451 |    568 |  79.40% |
