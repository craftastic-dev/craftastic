# Craftastic Orchestrator

A development environment orchestration service that manages containerized development environments with Git repository integration. Provides developers with isolated, consistent development environments accessible through a web interface with terminal sessions.

## Architecture

The system follows an **Environment/Session** model:
- **Environments**: Git repository-based development containers (isolated workspaces)
- **Sessions**: Terminal sessions (tmux) within environments for interactive development

## Tech Stack

- **Backend**: Fastify, TypeScript, Kysely (PostgreSQL), Docker, JWT
- **Frontend**: React 19, TypeScript, Vite, shadcn/ui, Tailwind CSS v4
- **Database**: PostgreSQL with type-safe Kysely migrations
- **Terminal**: xterm.js + node-pty + tmux

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- PostgreSQL (via Docker Compose)

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Database Services

From the project root directory:

```bash
cd /Users/niallohiggins/proj/craftastic
docker-compose up -d postgres
```

This starts PostgreSQL on `localhost:5432` with:
- Database: `craftastic`
- Username: `craftastic` 
- Password: `craftastic`

### 3. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

The default `.env` configuration works with the Docker Compose setup:

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://craftastic:craftastic@localhost:5432/craftastic
JWT_SECRET=dev-secret-key-change-in-production
# ... other settings
```

### 4. Database Setup

Run migrations to set up the database schema:

```bash
npm run migrate
```

### 5. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Development Commands

### Backend Development
```bash
npm run dev              # Start development server with hot reload
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

## Database Management

### Running Migrations

To apply all pending migrations:
```bash
npm run migrate
```

### Rolling Back Migrations

To rollback the last migration:
```bash
npm run migrate:rollback
```

### Creating New Migrations

To create a new migration file:
```bash
npm run migrate:create
```

This will prompt you for a migration name and create a new file in `src/migrations/` with the format:
```
001_migration_name.ts
```

### Migration File Structure

Each migration file exports `up` and `down` functions:

```typescript
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Schema changes to apply
  await db.schema
    .createTable('new_table')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Schema changes to rollback
  await db.schema.dropTable('new_table').execute();
}
```

## Docker Services

### PostgreSQL Database

Start just the database:
```bash
cd /Users/niallohiggins/proj/craftastic
docker-compose up -d postgres
```

Stop the database:
```bash
docker-compose down postgres
```

View database logs:
```bash
docker-compose logs -f postgres
```

### Full Stack with Docker

To run the entire application with Docker:
```bash
cd /Users/niallohiggins/proj/craftastic
docker-compose up -d
```

This starts both PostgreSQL and the orchestrator service.

## API Endpoints

### Environment Management
- `POST /api/environments` - Create new environment
- `GET /api/environments/user/:userId` - List user environments
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

## Project Structure

```
/src
├── config.ts                    # Environment configuration with Zod validation
├── index.ts                     # Fastify server setup and route registration
├── lib/
│   ├── database.ts              # Database connection setup
│   ├── database-types.ts        # Kysely type definitions
│   ├── kysely.ts               # Kysely query builder setup
│   ├── migrator.ts             # Database migration runner
│   └── vite-dev.ts             # Vite development server integration
├── migrations/                  # Database migrations (Kysely-based)
├── routes/                      # API route handlers
├── scripts/                     # Database migration scripts
└── services/                    # Business logic services

/frontend
├── src/
│   ├── api/client.ts           # API client with TypeScript interfaces
│   ├── components/             # React components (shadcn/ui)
│   ├── pages/                  # Page components
│   └── lib/utils.ts            # Utility functions
```

## Development Notes

- Frontend is integrated with backend development server via Vite proxy
- All database operations use type-safe Kysely queries
- Database schema changes must be done via migrations
- UI components use shadcn/ui with Tailwind CSS v4
- Real-time terminal sessions use WebSocket connections

## Troubleshooting

### Database Connection Issues
1. Ensure PostgreSQL is running: `docker-compose ps`
2. Check connection string in `.env` matches Docker Compose config
3. Verify database exists: `docker-compose exec postgres psql -U craftastic -d craftastic -c "\dt"`

### Migration Issues
1. Check migration status: `npm run migrate` (shows pending migrations)
2. For corrupted migrations, rollback and reapply: `npm run migrate:rollback && npm run migrate`
3. Verify database schema matches: Compare with `src/lib/database-types.ts`

### Frontend Issues
1. Clear browser cache and refresh
2. Check browser console for JavaScript errors
3. Verify API endpoints are responding: `curl http://localhost:3000/api/environments/user/test`

### Docker Issues
1. Ensure Docker daemon is running
2. Check container logs: `docker-compose logs orchestrator`
3. Verify volumes are mounted correctly for Docker socket access