# Craftastic Git Integration Architecture Plan

## Overview
This document outlines the architecture for integrating Git functionality into Craftastic, including GitHub authentication, git worktrees, and UI components for git operations.

## 1. GitHub Authentication Architecture

### 1.1 Authentication Flow
We'll implement GitHub OAuth App authentication with the following approach:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  Craftastic │────▶│   GitHub    │
│             │◀────│   Backend   │◀────│  OAuth API  │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 1.2 Implementation Strategy
- **OAuth App Registration**: Register Craftastic as a GitHub OAuth App
- **Dual Mode Support**: 
  - Local development: Use device flow or personal access tokens
  - Production: Standard OAuth web flow with callback URLs
- **Token Storage**: Encrypted storage in PostgreSQL
- **Scope Requirements**: `repo`, `read:user`, `user:email`, `write:pull_request`

### 1.3 Database Schema Updates
```sql
-- Add to users table
ALTER TABLE users ADD COLUMN github_access_token TEXT;
ALTER TABLE users ADD COLUMN github_refresh_token TEXT;
ALTER TABLE users ADD COLUMN github_username VARCHAR(255);
ALTER TABLE users ADD COLUMN github_token_expires_at TIMESTAMP;

-- Add github_repositories table for caching
CREATE TABLE github_repositories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  github_id BIGINT UNIQUE,
  name VARCHAR(255),
  full_name VARCHAR(255),
  private BOOLEAN,
  default_branch VARCHAR(255),
  clone_url TEXT,
  ssh_url TEXT,
  updated_at TIMESTAMP,
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Update environments table
ALTER TABLE environments ADD COLUMN github_repository_id INTEGER REFERENCES github_repositories(id);
ALTER TABLE environments ADD COLUMN use_ssh_clone BOOLEAN DEFAULT false;
ALTER TABLE environments ADD COLUMN git_clone_path TEXT; -- Store the actual clone location
```

### 1.4 API Endpoints
```typescript
// New auth endpoints
POST   /api/auth/github/initiate     // Start OAuth flow
GET    /api/auth/github/callback     // OAuth callback
POST   /api/auth/github/device       // Device flow for local dev
DELETE /api/auth/github/disconnect   // Revoke GitHub connection

// Repository management
GET    /api/github/repositories      // List user's repos
GET    /api/github/repository/:id    // Get specific repo details
POST   /api/github/repositories/sync // Force sync with GitHub
```

## 2. Git Worktree Architecture

### 2.1 Worktree Management Strategy
```
${CRAFTASTIC_DATA_DIR}/         # Default: ~/.craftastic
└── repos/
    └── {environment_id}/
        ├── .git/                    # Bare git repository
        └── worktrees/
            ├── {session_id_1}/      # Worktree for session 1
            ├── {session_id_2}/      # Worktree for session 2
            └── {session_id_n}/      # Worktree for session n
```

### 2.2 Session Lifecycle with Worktrees
1. **Environment Creation**:
   - Clone repository to base location
   - Create initial worktree for main branch
   - Store worktree paths in database

2. **Session Creation**:
   - Create new worktree: `git worktree add ../sessions/{session_id} {branch}`
   - Mount worktree into Docker container
   - Pass git credentials to container

3. **Session Deletion**:
   - Remove worktree: `git worktree remove ../sessions/{session_id}`
   - Clean up Docker container

### 2.3 Database Schema Updates
```sql
-- Update sessions table
ALTER TABLE sessions ADD COLUMN worktree_path TEXT;
ALTER TABLE sessions ADD COLUMN git_branch VARCHAR(255);
ALTER TABLE sessions ADD COLUMN is_feature_branch BOOLEAN DEFAULT false;

-- Add git_operations table for tracking
CREATE TABLE git_operations (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  operation_type VARCHAR(50), -- 'commit', 'push', 'pull', etc.
  status VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2.4 Docker Integration
```typescript
// Modified container creation
interface ContainerConfig {
  // ... existing config
  mounts: [{
    type: 'bind',
    source: worktreePath,     // Host worktree path
    target: '/workspace',     // Container mount point
    consistency: 'cached'     // Performance optimization
  }],
  env: [
    `GIT_AUTHOR_NAME=${user.name}`,
    `GIT_AUTHOR_EMAIL=${user.email}`,
    `GITHUB_TOKEN=${encryptedToken}`, // For HTTPS auth
    // SSH agent forwarding for SSH auth
  ]
}
```

## 3. Git Credential Management

### 3.1 Credential Passing Strategy
1. **HTTPS Authentication**:
   - Pass GitHub token as environment variable
   - Configure git credential helper in container

2. **SSH Authentication**:
   - Use SSH agent forwarding
   - Mount SSH socket into container
   - Alternative: Generate deployment keys per session

### 3.2 Security Considerations
- Encrypt tokens at rest
- Use short-lived tokens where possible
- Implement token rotation
- Audit git operations

## 4. Git UI Components

### 4.1 Frontend Components
```typescript
// New components structure
components/
├── git/
│   ├── GitPanel.tsx           // Main git panel container
│   ├── GitStatus.tsx          // Shows git status output
│   ├── GitDiff.tsx            // Shows git diff with syntax highlighting
│   ├── GitCommit.tsx          // Commit interface
│   ├── GitBranch.tsx          // Branch management
│   └── GitHistory.tsx         // Commit history viewer

// Integration with existing UI
pages/
└── Environment.tsx            // Add GitPanel to environment view
```

### 4.2 API Endpoints for Git Operations
```typescript
// Git operations endpoints
GET    /api/git/status/:sessionId        // Get git status
GET    /api/git/diff/:sessionId          // Get git diff
POST   /api/git/commit/:sessionId        // Create commit
POST   /api/git/push/:sessionId          // Push changes
GET    /api/git/log/:sessionId           // Get commit history
POST   /api/git/branch/:sessionId        // Create/switch branches
GET    /api/git/branches/:sessionId      // List branches
```

### 4.3 WebSocket Integration
Extend existing WebSocket for real-time git updates:
```typescript
// New WebSocket message types
interface GitStatusUpdate {
  type: 'git:status';
  sessionId: string;
  data: {
    branch: string;
    ahead: number;
    behind: number;
    modified: string[];
    untracked: string[];
  };
}
```

## 5. Implementation Phases

### Phase 1: GitHub Authentication (Week 1)
1. Implement OAuth flow
2. Add database tables for tokens
3. Create GitHub API client
4. Build repository listing UI

### Phase 2: Git Worktree Integration (Week 2)
1. Implement worktree creation/deletion
2. Update session creation flow
3. Modify Docker mounting
4. Test branch management

### Phase 3: Credential Management (Week 3)
1. Implement HTTPS token passing
2. Set up SSH agent forwarding
3. Add security measures
4. Test push/pull operations

### Phase 4: Git UI Components (Week 4)
1. Build GitPanel components
2. Implement API endpoints
3. Add WebSocket updates
4. Polish UI/UX

## 6. Technical Considerations

### 6.1 Performance
- Cache git status to avoid repeated calls
- Use git plumbing commands for efficiency
- Implement debouncing for UI updates
- Consider pagination for large diffs

### 6.2 Error Handling
- Graceful degradation if GitHub is unavailable
- Clear error messages for git conflicts
- Rollback mechanisms for failed operations
- Logging and monitoring

### 6.3 Scalability
- Worktree cleanup strategies
- Storage management for multiple worktrees
- Rate limiting for GitHub API calls
- Efficient diff algorithms for large files

## 7. Security Considerations

### 7.1 Token Security
- Encrypt tokens using AES-256
- Implement token expiration
- Audit trail for git operations
- Secure credential passing to containers

### 7.2 Container Isolation
- Restrict git operations to user's repositories
- Prevent credential leakage between sessions
- Network isolation for git operations
- File system permissions

## 8. Future Enhancements

### 8.1 Advanced Git Features
- Interactive rebase UI
- Merge conflict resolution
- Stash management
- Submodule support

### 8.2 Integration Extensions
- GitLab support
- Bitbucket support
- Self-hosted git servers
- Git hooks integration

### 8.3 Collaboration Features
- Real-time collaborative editing
- Code review integration
- Pull request creation
- Issue tracking integration