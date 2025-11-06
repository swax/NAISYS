# NAISYS Monorepo

This repository is organized as a monorepo using npm workspaces, containing multiple related projects.

## Structure

```
NAISYS/
├── apps/
│   ├── naisys/          - Core NAISYS system
│   └── overlord/        - NAISYS Overlord management interface
│       ├── server/      - Fastify backend server
│       ├── client/      - React frontend
│       └── shared/      - Shared types and utilities
├── packages/            - Shared packages (future)
├── package.json         - Root workspace configuration
└── node_modules/        - Hoisted dependencies
```

## Workspaces

The monorepo contains the following workspaces:

### Apps
- **naisys** (`apps/naisys/`) - The core Node.js Autonomous Intelligence System
- **naisys-overlord** (`apps/overlord/`) - Management interface for NAISYS agents
  - **@naisys-overlord/server** - Backend API server
  - **@naisys-overlord/client** - Frontend web application
  - **@naisys-overlord/shared** - Shared TypeScript types

### Packages
- `packages/` directory is ready for future shared packages like:
  - `packages/shared` - Common utilities and types
  - `packages/database` - Shared database utilities

## Installation

From the root directory, install all workspace dependencies:

```bash
npm install
```

This will install dependencies for all workspaces and hoist common dependencies to the root.

## Building

### Build All Projects
```bash
npm run build
```

### Build Individual Projects

**NAISYS:**
```bash
npm run build --workspace=apps/naisys
```

**Overlord (all components):**
```bash
npm run build --workspace=@naisys-overlord/shared
npm run build --workspace=@naisys-overlord/client
npm run build --workspace=@naisys-overlord/server
```

## Running

### NAISYS
```bash
# Run an agent
npm run agent:assistant
npm run agent:nightwatch

# Or use workspace directly
npm run agent:assistant --workspace=apps/naisys
```

### Overlord
```bash
# Development mode (runs both client and server)
npm run overlord:dev

# Build for production
npm run overlord:build

# Start production server
npm run overlord:start
```

## Development

### Code Formatting
```bash
npm run prettier
```

### Linting
```bash
npm run eslint
```

### Testing
```bash
npm test
```

### Checking for Updates
```bash
npm run updates:check
npm run updates:apply
```

## Workspace Management

### Adding New Workspaces

1. Create the package directory under `apps/` or `packages/`
2. Add a `package.json` to the new package
3. Run `npm install` from the root to register the workspace
4. Dependencies will be hoisted to the root `node_modules/`

### Inter-workspace Dependencies

Workspaces can depend on each other:

```json
{
  "dependencies": {
    "@naisys-overlord/shared": "file:../shared"
  }
}
```

Or use the package name if published:

```json
{
  "dependencies": {
    "@naisys/shared": "workspace:*"
  }
}
```

## Important Notes

1. **Overlord Nested Workspaces**: The overlord app contains its own internal workspaces (server, client, shared). These are explicitly listed in the root `package.json` for proper dependency management.

2. **Installing Dependencies**: Always run `npm install` from the root directory. If you add new workspaces, explicitly install them:
   ```bash
   npm install --workspace=@naisys-overlord/shared
   ```

3. **Hoisting**: Common dependencies are hoisted to the root `node_modules/` to save disk space and improve install times.

4. **Building Order**: For overlord, build in this order: shared → client/server, as client and server depend on shared types.

## Troubleshooting

### Workspaces not recognized
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Build failures
```bash
# Ensure all workspace dependencies are installed
npm install --workspace=@naisys-overlord/shared
npm install --workspace=@naisys-overlord/client
npm install --workspace=@naisys-overlord/server
```

### View all workspaces
```bash
npm query ".workspace" | grep -E '"name":|"location":'
```
