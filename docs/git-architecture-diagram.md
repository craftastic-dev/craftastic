# Git Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Craftastic Git Integration                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────┐      ┌──────────────┐      ┌────────────────┐         │
│  │   Browser   │◀────▶│  Craftastic  │◀────▶│     GitHub     │         │
│  │             │      │   Backend    │      │   OAuth API    │         │
│  └─────────────┘      └──────────────┘      └────────────────┘         │
│         │                     │                                          │
│         │                     │                                          │
│         ▼                     ▼                                          │
│  ┌─────────────┐      ┌──────────────┐                                 │
│  │   Git UI    │      │  PostgreSQL  │                                 │
│  │   Panel     │      │              │                                 │
│  └─────────────┘      │  - users     │                                 │
│                       │  - tokens    │                                 │
│                       │  - repos     │                                 │
│                       └──────────────┘                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Worktree Architecture

```
Host Filesystem
/data/craftastic/
└── repos/
    └── {environment_id}/
        ├── .git/                    # Bare repository (shared)
        └── worktrees/
            ├── {session_1}/         # Worktree for session 1
            │   ├── src/
            │   ├── package.json
            │   └── ...
            ├── {session_2}/         # Worktree for session 2
            │   ├── src/
            │   ├── package.json
            │   └── ...
            └── {session_3}/         # Worktree for session 3
                ├── src/
                ├── package.json
                └── ...

Docker Containers
┌─────────────────────┐
│  Container 1        │
│  /workspace ◀───────┼─── Mount: /data/.../worktrees/{session_1}
│  Branch: main       │
└─────────────────────┘

┌─────────────────────┐
│  Container 2        │
│  /workspace ◀───────┼─── Mount: /data/.../worktrees/{session_2}
│  Branch: feature/x  │
└─────────────────────┘

┌─────────────────────┐
│  Container 3        │
│  /workspace ◀───────┼─── Mount: /data/.../worktrees/{session_3}
│  Branch: bugfix/y   │
└─────────────────────┘
```

## Session Lifecycle

```
1. Create Environment
   │
   ├─▶ Clone bare repo
   │   git clone --bare {repo_url} /data/craftastic/repos/{env_id}/.git
   │
   └─▶ Store in DB
       environments.repository_url = {repo_url}

2. Create Session
   │
   ├─▶ Create worktree
   │   git worktree add /data/.../worktrees/{session_id} {branch}
   │
   ├─▶ Create container
   │   docker run -v {worktree_path}:/workspace ...
   │
   └─▶ Pass credentials
       ENV GITHUB_TOKEN={encrypted_token}

3. Git Operations
   │
   ├─▶ From UI: API calls to backend
   │   POST /api/git/commit
   │   POST /api/git/push
   │
   └─▶ From Terminal: Direct git commands
       git add .
       git commit -m "..."
       git push

4. Delete Session
   │
   ├─▶ Stop container
   │   docker stop {container_id}
   │
   ├─▶ Remove worktree
   │   git worktree remove {worktree_path}
   │
   └─▶ Clean up DB
       DELETE FROM sessions WHERE id = {session_id}
```

## Git Panel UI Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Environment View                       │
├───────────────────────┬──────────────────────────────────┤
│                       │         Git Panel                │
│                       │  ┌────────────────────────────┐  │
│     Terminal          │  │ 📍 main (2 ahead)         │  │
│                       │  └────────────────────────────┘  │
│                       │                                  │
│   $ npm run dev       │  Modified Files:                │
│   Server started...   │  ▶ M  src/index.ts             │
│                       │  ▶ M  package.json             │
│                       │  ▶ ?  .env.local              │
│                       │                                  │
│                       │  ┌────────────────────────────┐  │
│                       │  │ 💬 Commit message...       │  │
│                       │  └────────────────────────────┘  │
│                       │                                  │
│                       │  [Commit] [Push] [Pull]        │
│                       │                                  │
└───────────────────────┴──────────────────────────────────┘
```

## Data Flow

```
User Action          Backend Processing          Git Operation
─────────────────    ─────────────────────      ────────────────
                                                 
Click "Commit"  ───▶  /api/git/commit      ───▶  git -C {path} commit
                      │                           │
                      ├─ Validate message         ├─ Set GIT_ASKPASS
                      ├─ Check worktree           ├─ Use stored token
                      └─ Execute command          └─ Return result
                                                 
View Status     ───▶  /api/git/status      ───▶  git -C {path} status
                      │                           │
                      ├─ Cache result             ├─ Parse output
                      └─ Return JSON              └─ Format for UI
                                                 
Push Changes    ───▶  /api/git/push        ───▶  git -C {path} push
                      │                           │
                      ├─ Check credentials        ├─ Use GitHub token
                      ├─ Set remote URL           ├─ Handle errors
                      └─ Stream progress          └─ Update UI
```