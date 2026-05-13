# Coverage

Statement coverage from `npm run coverage:full`. This file is
regenerated on every coverage run; commit it to log progress.

Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,
Playwright-managed erp server) plus the supervisor + erp client React
code via vite-plugin-istanbul. Unloaded files count as 0% for everything
except `apps/supervisor/client` and `apps/erp/client`, where only
modules loaded during a Playwright test contribute to the denominator.

**Total: 45,946 / 70,940 statements (64.77%)**

| Workspace | Covered | Total | % |
| --- | ---: | ---: | ---: |
| apps/erp/client | 967 | 3,754 | 25.76% |
| apps/erp/server | 11,961 | 15,657 | 76.39% |
| apps/erp/shared | 2,050 | 2,052 | 99.90% |
| apps/hub | 3,842 | 4,873 | 78.84% |
| apps/naisys | 10,924 | 20,040 | 54.51% |
| apps/supervisor/client | 1,731 | 5,538 | 31.26% |
| apps/supervisor/server | 8,693 | 12,099 | 71.85% |
| apps/supervisor/shared | 1,608 | 1,626 | 98.89% |
| packages/common | 1,516 | 1,808 | 83.85% |
| packages/common-node | 737 | 1,327 | 55.54% |
| packages/hub-database | 165 | 221 | 74.66% |
| packages/hub-protocol | 1,266 | 1,266 | 100.00% |
| packages/supervisor-database | 486 | 679 | 71.58% |
