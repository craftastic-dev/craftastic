# Craftastic Orchestrator - Claude Assistant Guide

## Project Overview

**Craftastic Orchestrator** is a development environment orchestration service that manages containerized development environments with Git repository integration. It provides developers with isolated, consistent development environments accessible through a web interface with terminal sessions.

### Core Architecture

The system follows an **Environment/Session** model:
- **Environments**: Git repository-based development containers (like isolated workspaces)
- **Sessions**: Terminal sessions (tmux) within environments for interactive development

## Technology Stack

### Backend (Node.js/TypeScript)
- **Framework**: Fastify with TypeScript
- **Database**: PostgreSQL with Kysely (type-safe SQL query builder)
- **Containerization**: Docker via Dockerode
- **Terminal**: node-pty + xterm.js + tmux
- **Authentication**: JWT (@fastify/jwt)
- **WebSockets**: @fastify/websocket
- **Validation**: Zod schemas

### Frontend (React/TypeScript)
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router DOM
- **State Management**: TanStack Query (React Query)
- **UI Framework**: shadcn/ui components + Tailwind CSS v4
- **Icons**: Lucide React

### Database Schema
```sql
-- Core tables with foreign key relationships
environments (id, user_id, name, repository_url, branch, container_id, status, created_at, updated_at)
sessions (id, environment_id, name, tmux_session_name, working_directory, status, created_at, updated_at, last_activity)
deployments (id, environment_id, app_id, status, created_at, metadata)
```

## Project Structure

```
/services/orchestrator
├── src/
│   ├── config.ts                    # Environment configuration with Zod validation
│   ├── index.ts                     # Fastify server setup and route registration
│   ├── lib/
│   │   ├── database.ts              # Database connection setup
│   │   ├── database-types.ts        # Kysely type definitions
│   │   ├── kysely.ts               # Kysely query builder setup
│   │   ├── migrator.ts             # Database migration runner
│   │   ├── environment-service.ts   # Environment business logic
│   │   └── vite-dev.ts             # Vite development server integration
│   ├── migrations/                  # Database migrations (Kysely-based)
│   │   ├── 001_initial_schema.ts
│   │   └── 002_migrate_legacy_data.ts
│   ├── routes/                      # API route handlers
│   │   ├── environments.ts         # Environment CRUD operations
│   │   ├── sessions.ts             # Session management
│   │   ├── terminal.ts             # WebSocket terminal connections
│   │   ├── git.ts                  # Git operations (commit, push, status)
│   │   ├── deployment.ts           # Coolify integration
│   │   └── containers.ts           # Legacy container routes
│   ├── scripts/                     # Database migration scripts
│   │   ├── migrate.ts
│   │   ├── rollback.ts
│   │   └── create-migration.ts
│   └── services/
│       ├── docker.ts               # Docker container management
│       └── terminal.ts             # Terminal session management
└── frontend/
    └── src/
        ├── api/client.ts           # API client with TypeScript interfaces
        ├── components/
        │   ├── ui/                 # shadcn/ui components (button, card, scroll-area)
        │   ├── GitPanel.tsx        # Git operations interface
        │   └── SessionList.tsx     # Environment session management
        ├── pages/
        │   ├── Dashboard.tsx       # Environment overview and creation
        │   ├── Environment.tsx     # Single environment view
        │   └── Terminal.tsx        # Terminal interface with xterm.js
        └── lib/utils.ts            # Utility functions (cn, etc.)
```

## Key Development Commands

### Backend Development
```bash
npm run dev              # Start development server with hot reload. Do not run this automatically, we prefer to run it manually.
npm run build            # Build TypeScript to JavaScript
npm run start            # Start production server
npm run lint             # Run ESLint
npm run typecheck        # TypeScript type checking
```

### Database Migrations
```bash
npm run migrate          # Run pending migrations
npm run migrate:rollback # Rollback last migration
npm run migrate:create   # Create new migration file
```

### Frontend Development
The frontend is integrated with the backend development server via Vite proxy in development mode.

## API Endpoints

### Environment Management
- `POST /api/environments` - Create new environment
- `GET /api/environments/user/:userId` - List user environments (with sessions)
- `GET /api/environments/:environmentId` - Get specific environment
- `DELETE /api/environments/:environmentId` - Delete environment

### Session Management
- `POST /api/sessions` - Create new session in environment
- `GET /api/sessions/environment/:environmentId` - List environment sessions
- `GET /api/sessions/:sessionId` - Get specific session
- `PATCH /api/sessions/:sessionId` - Update session status
- `DELETE /api/sessions/:sessionId` - Delete session

### Terminal & Git
- `GET /api/terminal/ws/:sessionId` - WebSocket terminal connection
- `POST /api/git/commit` - Git commit in environment
- `POST /api/git/push` - Git push from environment
- `GET /api/git/status/:environmentId` - Git status

## Code Conventions

### TypeScript Standards
- **Strict Mode**: All TypeScript strict checks enabled
- **Type Safety**: Kysely provides compile-time SQL type safety
- **Interface Definitions**: Shared interfaces between frontend/backend
- **Zod Validation**: Runtime schema validation for API inputs

### Database Patterns
- **Kysely Queries**: All database operations use type-safe Kysely queries
- **Migration-First**: Schema changes via versioned migration files
- **Foreign Keys**: Proper relationships with CASCADE deletes
- **Type Generation**: Database types auto-generated from schema

### Frontend Patterns
- **Component Library**: shadcn/ui for consistent UI components
- **State Management**: TanStack Query for server state, local state for UI
- **Type Safety**: Full TypeScript coverage with proper API typing
- **CSS**: Tailwind v4 with component-scoped styles

### Error Handling
- **API Responses**: Consistent error format with HTTP status codes
- **Database Errors**: Proper transaction handling and rollbacks
- **Frontend**: Error boundaries and user-friendly error messages

## Environment Variables

Required configuration in `.env`:
```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/craftastic

# Security
JWT_SECRET=your-jwt-secret
# Used to encrypt sensitive data in the database (GitHub tokens, agent credentials, etc.)
# Can be a 32-character string or 64-character hex string
SERVER_ENCRYPTION_KEY=dev-encryption-key-32-chars-long!

# GitHub OAuth
GITHUB_CLIENT_ID=Ov23liz42T3AzHtmASDC

# Docker (optional)
DOCKER_HOST=/var/run/docker.sock
SANDBOX_IMAGE=craftastic-sandbox:latest
SANDBOX_MEMORY_LIMIT=512m
SANDBOX_CPU_LIMIT=0.5

# Deployment (optional)
COOLIFY_API_URL=https://your-coolify.instance
COOLIFY_API_TOKEN=your-token

# Development
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=*
```

## Architecture Decisions

### Database Strategy
- **Kysely over ORMs**: Chosen for type safety without ORM complexity
- **Migration System**: Custom Kysely-based migrations for schema evolution
- **PostgreSQL**: Robust ACID compliance for development environment state

### Container Strategy (Container-Native Worktrees)
- **Docker Integration**: Direct Dockerode usage for container lifecycle
- **tmux Sessions**: Persistent terminal sessions within containers
- **Container-Native Git**: Worktrees created INSIDE containers using absolute container paths
- **Bare Repository Mounting**: **Read-write** bare repo mounted at `/data/repos/{env_id}` (required for worktree metadata)
- **Worktree Location**: Always at `/workspace` inside each container
- **Path Resolution**: All git operations use container-absolute paths (no host path conflicts)
- **Mount Requirements**: Bare repositories MUST be mounted read-write for git worktree functionality
- **Error Handling**: Comprehensive validation and recovery for mount issues, permission problems, and disk space
- **Sandbox Security**: Limited container capabilities and resource constraints
- **Terminal Configuration**: Custom sandbox.Dockerfile with tmux-256color support and terminal fixes

#### Critical Mount Requirements
- **Bare Repository Mount**: Must be read-write at `/data/repos/{env_id}`
  - Required for git worktree metadata storage in `{bare_repo}/worktrees/` directory
  - Git writes tracking information when creating/removing worktrees
  - Read-only mounts will cause "Read-only file system" errors
- **Worktree Creation**: Always at `/workspace` inside container using container-absolute paths
- **Security**: Container runs as non-root user with limited capabilities for security
- **Validation**: Automatic verification of mount permissions and worktree creation success

### Frontend Architecture
- **Component-First**: Reusable shadcn/ui components
- **Server State**: TanStack Query for API data management
- **Real-time**: WebSocket integration for terminal sessions

## Development Methodology: Hoare Logic and Formal Verification

When making any code changes to Craftastic, ALWAYS follow this methodology to ensure correctness and maintainability:

### 1. Hoare Logic Specification
- **Define preconditions {P}** and **postconditions {Q}** for each function
- **Express invariants** that must hold throughout execution
- **Document state transitions** formally using set theory and logic
- Use formal notation: `{P} function_name(params) {Q}`

### 2. Comprehensive Case Analysis
- **Enumerate ALL possible cases** (success and failure paths)
- **Document error cases** with specific handling strategies  
- **Include edge cases** and recovery mechanisms
- **Consider concurrency** and race conditions
- Label cases systematically (E1, E2, etc. for errors)

### 3. Code Documentation Standards
- **Document Hoare triples** directly in code comments above functions
- **List all handled cases** with their resolutions
- **Include invariants** and state model definitions
- **Cross-reference** error cases with test cases

### 4. Comprehensive Test Coverage
- **Write tests for EVERY case** identified in analysis
- **Include regression tests** for all bugs fixed
- **Test both success and failure paths** thoroughly
- **Use descriptive test names** that reference case numbers
- **Mock external dependencies** properly

### 5. Verification and Validation
- **Run all tests** before committing any code
- **Verify postconditions** are met in practice
- **Ensure invariants** are preserved across operations
- **Test edge cases** manually when automated testing is insufficient

### Example Code Documentation Format:
```typescript
/**
 * FUNCTION_NAME - Brief description
 * ================================
 * 
 * Hoare Triple:
 * {P: precondition ∧ additional_constraint}
 * function_name(parameters)
 * {Q: postcondition ∧ invariant_preserved}
 * 
 * Case Analysis:
 * 1. Normal case → Action taken
 * 2. Edge case A → Specific handling
 * 3. Error case E1 → Recovery strategy
 * 4. Error case E2 → Alternative approach
 * 
 * Invariants:
 * - I1: Critical invariant that must hold
 * - I2: Additional system constraint
 * 
 * Error Cases:
 * - E1: Specific error condition → Resolution
 * - E2: Another error → How we handle it
 */
function exampleFunction(params) { ... }
```

### Integration with Development Workflow
Every code change must include:
1. **Formal specification** (Hoare triple)
2. **Complete case analysis** (documented in code)
3. **Comprehensive tests** (covering all cases)
4. **Verification** (tests passing + manual validation)

## Development Workflow

1. **Create Migration**: Use `npm run migrate:create` for schema changes
2. **Update Types**: Modify `services/orchestrator/src/lib/database-types.ts` to match schema
3. **Implement Routes**: Add API endpoints in `services/orchestrator/src/routes/`
4. **Type Safety**: Update frontend types in `services/orchestrator/frontend/src/api/client.ts`
5. **UI Components**: Build UI with shadcn/ui components
6. **Test Integration**: Verify full stack functionality

## Important Notes

- **Database Migrations**: Always test migrations with rollback scenarios
- **Type Safety**: Kysely provides compile-time SQL validation
- **Container Security**: Sandbox containers have restricted capabilities
- **Real-time Updates**: Terminal sessions use WebSocket connections
- **Error Handling**: Proper error boundaries and user feedback throughout
- **Terminal Compatibility**: The sandbox.Dockerfile configures tmux and xterm.js for proper rendering in browser terminals
  - Uses tmux-256color terminfo for better color support
  - Configures terminal-overrides to handle Unicode width issues with fonts
  - Enables BCE capability for proper scrolling
  - xterm.js configured with canvas renderer and Unicode 11 support

## Debugging

### Backend Issues
- Check logs via `console.log` (Fastify logger in development)
- Database issues: Verify connection and migration status
- Docker errors: Check container status and logs

### Frontend Issues  
- React DevTools for component state
- Network tab for API request/response debugging
- Console for JavaScript errors

### Terminal/WebSocket Issues
- Verify WebSocket connection in Network tab
- Check tmux session status in container
- Terminal resize events for display issues