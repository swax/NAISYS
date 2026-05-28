# @naisys/erp-client

[← Back to ERP](../README.md) | [← Back to main README](../../../README.md)

React + Vite frontend for the NAISYS ERP. Internal to the monorepo — at build time it's bundled into [`@naisys/erp`](../README.md) and served by the Fastify server.

## Running

For day-to-day development the ERP server proxies to Vite. Start both from the monorepo root (or run server + client separately):

```bash
npm run dev --workspace=@naisys/erp-client
```

Visit the URL Vite prints; API calls proxy to the ERP server.

## Structure

- **`pages/`** — top-level routes (orders, operations, items, dispatch, inventory, work centers, admin)
- **`components/`** — reusable UI pieces
- **`lib/`** — typed API client wrappers, HATEOAS helpers, hooks
- **`App.tsx`** / **`main.tsx`** — router and root setup

## Design notes

- **Mantine** for components and forms; **`react-router`** v7 for routing
- All button/action visibility comes from HATEOAS actions returned by the server — see [doc 012](../../../docs/012-hateoas.md). UI never invents permission logic
- Zod schemas from [`@naisys/erp-shared`](../shared/README.md) are reused for client-side validation
- Shared UI primitives (action buttons, diff viewers, markdown, etc.) come from [`@naisys/common-browser`](../../../packages/common-browser/README.md)

## License

MIT
