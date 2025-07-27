# Craftastic - Development Environment Orchestrator

A monorepo containing a development environment orchestration service that provides isolated Docker containers with web-based terminal access.

## Structure

```
craftastic/
├── services/
│   └── orchestrator/         # Main orchestration service
│       ├── src/             # TypeScript backend (Fastify)
│       └── frontend/        # React SPA
└── packages/                # Shared packages (for future use)
```

## Prerequisites

- Node.js 20+
- Docker
- npm 8+

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the development sandbox Docker image:
   ```bash
   docker build -f services/orchestrator/docker/sandbox.Dockerfile -t craftastic-sandbox:latest .
   ```
   This creates a feature-rich development environment with:
   - Git, tmux, and development tools
   - Neovim with LunarVim configuration
   - Claude Code CLI
   - Node.js 20 and other language runtimes

3. Start infrastructure services:
   ```bash
   docker-compose up -d postgres
   ```

4. Copy environment variables:
   ```bash
   cp services/orchestrator/.env.example services/orchestrator/.env
   ```

5. Run development servers:
   ```bash
   npm run dev
   ```

The orchestrator will be available at http://localhost:3000 with both API and frontend served from the same port.

## Production

Build and run with Docker Compose:

```bash
docker-compose up --build
```

## Features

- **Container Management**: Spin up isolated Docker containers for each development session
- **Web Terminal**: Real-time terminal access via WebSocket using xterm.js
- **Git Integration**: Built-in git operations (commit, push, status)
- **Deployment**: Integration ready for Coolify deployments
- **Persistent Storage**: PostgreSQL for session data
- **Development Environment**: Full-featured containers with Neovim/LunarVim, Claude Code CLI, and modern dev tools

## Development

This project uses:
- npm workspaces for monorepo management
- Turbo for build orchestration
- TypeScript throughout
- Fastify for the backend API
- React + Vite for the frontend