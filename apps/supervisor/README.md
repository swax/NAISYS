# NAISYS Supervisor

[← Back to main README](../../README.md)

A management application for NAISYS agents that provides a monitoring interface and communication capabilities. NAISYS Supervisor sits above the NAISYS database to provide visibility into how agents are working and enables communication with the agents.

## Overview

NAISYS Supervisor is a full-stack TypeScript application that consists of:

- **Frontend**: React application with Mantine UI components
- **Backend**: Fastify server with SQLite databases
- **Shared**: Common types and utilities

The application provides a web interface to monitor NAISYS agents, view their logs, manage mail/messaging, and control agent operations.

## Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- NPM or compatible package manager
- Access to a NAISYS database

### Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm run install:all
   ```

3. Set up environment variables:

   ```bash
   export NAISYS_FOLDER=/path/to/naisys/data
   ```

4. Start development servers:
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:5173` (development) or `http://localhost:3001/supervisor/` (production).

## Architecture

### Database Architecture

The application uses a dual database system managed through Prisma ORM:

- **NAISYS Database** (Read-only): Contains agent data, logs, and messaging
- **Supervisor Database** (Read/Write): Manages sessions, settings, and read status

Database schema is defined in `packages/database/prisma/schema.prisma`.

### Core Features

- **Agent Monitoring**: View agent status, activity, and hierarchical relationships
- **Log Viewing**: Browse system logs with pagination and filtering
- **Mail System**: Inter-agent messaging with thread-based conversations
- **Session Management**: Authentication and access control
- **Read Status Tracking**: Track unread notifications per agent

## Development

### Available Scripts

- `npm run dev` - Start development servers
- `npm run build` - Build all packages
- `npm start` - Start production server
- `npm run format` - Format code with Prettier

### Project Structure

```
├── client/          # React frontend
├── server/          # Fastify backend
└── shared/          # Shared TypeScript types
```

### Environment Variables

- `NAISYS_FOLDER` - Path to NAISYS data folder (required)
- `NODE_ENV` - Environment mode (development/production)
- `PORT` - Server port (defaults to 3001)

## API Endpoints

- `GET /api/data` - Main data endpoint with pagination
- `POST /api/access-key` - Access key validation
- `GET /api/session` - Session validation
- `POST /api/settings` - Settings management
- `POST /api/read-status` - Update read status

## License

MIT
