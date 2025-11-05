# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Running

- `npm run dev` - Start development servers (both client and server)
- `npm run build` - Build all packages (shared, client, server)
- `npm start` - Start production server
- `npm run format` - Format code with Prettier

### Individual Package Commands

- `npm run dev --workspace=server` - Start server only
- `npm run dev --workspace=client` - Start client only
- `npm run build --workspace=shared` - Build shared types
- `npm run type-check --workspace=client` - TypeScript check for client
- `npm run type-check --workspace=server` - TypeScript check for server

### Testing

No test framework is currently configured. When adding tests, check if the project uses Jest, Vitest, or another framework.

## Architecture Overview

### High-Level Structure

NAISYS Overlord is a management application that provides a monitoring interface for NAISYS agents. It operates above the NAISYS database to provide visibility into agent operations and enable communication with agents.

### Workspace Structure

- `shared/` - TypeScript types and utilities shared between client and server
- `client/` - React frontend using Vite, Mantine UI, and React Query
- `server/` - Fastify backend with TypeScript
- `packages/database/` - Shared database package using Prisma ORM

### Database Architecture (Dual Database System)

The application uses two separate databases managed through Prisma ORM:

1. **NAISYS Database** (Read-only)
   - Location: `{NAISYS_FOLDER}/database/naisys.sqlite`
   - Contains: Agent data, logs, mail/messaging system
   - Tables: `users`, `context_log`, `thread_messages`, `threads`, `thread_members`, `costs`, `dream_log`
   - Accessed via: Prisma Client from `packages/database`

2. **Overlord Database** (Read/Write)
   - Location: `{NAISYS_FOLDER}/database/overlord.db`
   - Contains: Session management, settings, read status tracking
   - Tables: `sessions`, `settings`
   - Accessed via: Prisma Client from `packages/database`

Database schema is defined in `packages/database/prisma/schema.prisma`.

### Core Services Layer

Located in `server/src/services/`, each service has a specific responsibility:

- **dataService.ts** - Main data aggregation orchestrator, combines data from all services
- **agentService.ts** - Agent/user management with online status detection
- **logService.ts** - System logging and activity tracking with pagination
- **mailService.ts** - Inter-agent messaging system with thread-based messaging
- **sessionService.ts** - Authentication and session management
- **readService.ts** - Tracks read/unread status for logs and mail per agent
- **settingsService.ts** - Application configuration management

### API Structure

Routes are organized in `server/src/routes/`:

- `/api/data` - Main data endpoint with pagination support
- `/api/access-key` - Access key validation and session creation
- `/api/session` - Session validation
- `/api/settings` - Application settings management
- `/api/read-status` - Update read status for agents

### Frontend Architecture

- **React** with TypeScript and **Mantine UI** components
- **React Query** for data fetching and caching
- **React Router** for navigation
- **Context API** for global state management (`NaisysDataContext`)
- Layout: AppShell with header, navbar (agent sidebar), footer (navigation), and main content

### Key Architectural Patterns

1. **Separation of Concerns**: Clear distinction between NAISYS system data (read-only) and overlord state (read/write)
2. **Service Layer Pattern**: Services abstract database operations from routes
3. **Parallel Data Fetching**: Services use `Promise.all()` for efficient concurrent data retrieval
4. **Read Status Tracking**: Sophisticated system for tracking unread notifications per agent
5. **Session Management**: Cookie-based sessions with automatic cleanup

### Environment Variables

- `NAISYS_FOLDER` - Path to NAISYS data folder (required)
- `NODE_ENV` - Environment mode (development/production)
- `PORT` - Server port (defaults to 3001)

### Important Code Patterns

- All database operations use Prisma Client with type-safe queries
- Services return typed data structures defined in `shared/src/`
- Read status updates are automatically triggered by data fetching operations
- Agent online status is determined by activity within last 5 seconds
- All API endpoints that modify data require session authentication

### Development Notes

- The application serves the React client from `/overlord/` prefix in production
- CORS is configured for development (http://localhost:5173)
- Database connections are managed by Prisma with connection pooling
- Session cleanup happens automatically when expired sessions are accessed
