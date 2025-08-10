# Craftastic API Reference

This document describes the HTTP and WebSocket interfaces for the Craftastic orchestrator. All REST endpoints live under the `/api` prefix unless noted. JSON is used for all request and response bodies.

## Authentication

Craftastic uses JWT bearer tokens. Most routes require a valid token in the `Authorization: Bearer <token>` header. Public routes are limited to the authentication workflow.

### User Accounts

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create a new user account. |
| `POST` | `/api/auth/login` | Authenticate and receive access/refresh tokens. |
| `POST` | `/api/auth/refresh` | Exchange a refresh token for a new access token. |
| `POST` | `/api/auth/logout` | Revoke a refresh token. |
| `POST` | `/api/auth/logout-all` | Revoke all refresh tokens for the current user. |
| `GET` | `/api/auth/me` | Return information about the authenticated user. |
| `POST` | `/api/auth/verify-email` | Confirm email ownership via verification token. |
| `POST` | `/api/auth/request-password-reset` | Initiate a password reset email. |
| `POST` | `/api/auth/reset-password` | Reset password using a reset token. |
| `POST` | `/api/auth/change-password` | Change the current password. |

### GitHub OAuth Device Flow

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/github/initiate` | Start the device flow; returns user code and verification URI. |
| `POST` | `/api/auth/github/poll` | Poll for OAuth completion using the device code. |
| `DELETE` | `/api/auth/github/disconnect` | Revoke stored GitHub credentials. |
| `GET` | `/api/auth/github/status` | Check whether a user has connected a GitHub account. |
| `GET` | `/api/auth/github/repos` | List repositories accessible to the authenticated user. |

## Environments

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/environments` | Create a new environment and start its container. |
| `GET` | `/api/environments/user/:userId` | List environments and sessions for a user. |
| `GET` | `/api/environments/:environmentId` | Retrieve a single environment. |
| `GET` | `/api/environments/check-name/:userId/:name` | Validate environment name availability. |
| `DELETE` | `/api/environments/:environmentId` | Destroy an environment and its container. |

## Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions/check-name/:environmentId/:name` | Verify session name availability. |
| `POST` | `/api/sessions` | Create a session; may create a git worktree. |
| `GET` | `/api/sessions/environment/:environmentId` | List sessions for an environment. |
| `GET` | `/api/sessions/:sessionId` | Retrieve session details. |
| `PATCH` | `/api/sessions/:sessionId` | Update session status. |
| `GET` | `/api/sessions/check-branch/:environmentId/:branch` | Verify branch availability for new session. |
| `GET` | `/api/sessions/:sessionId/status` | Check real-time session status. |
| `DELETE` | `/api/sessions/:sessionId` | Delete a session and clean up its worktree. |

## Terminal WebSocket

`GET /api/terminal/ws/:sessionId`

Connect with a WebSocket client to stream terminal input/output for a session. Required query parameters:

- `environmentId` – owning environment
- `token` – JWT access token

Messages use JSON with `{ "type": "input", "data": "..." }` for input and `{ "type": "output", "data": "..." }` for output. A `{ "type": "resize", "cols": n, "rows": m }` message adjusts the terminal size.

## Git Operations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/git/status/:sessionId` | Git status for the session's worktree. |
| `GET` | `/api/git/diff/:sessionId` | Show diff for files in the worktree. |
| `POST` | `/api/git/commit/:sessionId` | Commit staged or specified files. |
| `POST` | `/api/git/push/:sessionId` | Push commits to the remote repository. |
| `GET` | `/api/git/log/:sessionId` | List commit history. |
| `GET` | `/api/git/repo/:environmentId` | Get repository information for an environment. |

## Containers

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/containers/create` | Create a standalone container (legacy). |
| `DELETE` | `/api/containers/:containerId` | Remove a container and mark environment stopped. |
| `GET` | `/api/containers/list` | List containers, optionally filtered by user ID. |

## Deployment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/deployment/deploy` | Trigger a Coolify deployment for an app ID. |
| `GET` | `/api/deployment/status/:deploymentId` | Get deployment status. |
| `GET` | `/api/deployment/list/:sessionId` | List deployments for an environment. |

## Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/user/:userId` | List agents for a user. |
| `GET` | `/api/agents/:agentId` | Retrieve a single agent. |
| `POST` | `/api/agents` | Create an agent with optional credential. |
| `PATCH` | `/api/agents/:agentId` | Update agent name or credential. |
| `DELETE` | `/api/agents/:agentId` | Remove an agent. |
| `GET` | `/api/agents/:agentId/credentials` | Retrieve decrypted credentials (internal use). |

## Cleanup

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/cleanup/sessions` | Manually run session cleanup. |
| `POST` | `/api/cleanup/container/:containerId` | Remove orphaned tmux sessions in a container. |
| `POST` | `/api/cleanup/environment/:environmentId` | Clean up all sessions for an environment. |

## Git Worktree Management

Each session associated with a repository branch uses its own git worktree. Worktrees are stored under `~/.craftastic/worktrees/<environment>/<branch>` and are created on session start. If a worktree for the requested branch already exists it is reused; otherwise a new one is created and the session record is updated with its path and branch【F:services/orchestrator/src/services/worktree.ts†L23-L56】. When a session ends, the worktree is removed if no other active session is using the branch【F:services/orchestrator/src/services/worktree.ts†L85-L118】.

## WebSocket Authentication

WebSocket connections require a valid JWT passed as a `token` query parameter. The server verifies the token before establishing the terminal session, closing the connection if authentication fails.
