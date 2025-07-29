# Git Implementation Approach for Craftastic

## Key Design Decisions

### 1. GitHub Authentication Approach

**For Local Development:**
- Use GitHub Personal Access Tokens (PAT) as the primary method
- Store tokens encrypted in the database
- Provide UI for users to input their PAT
- Alternative: GitHub Device Flow for better UX

**For Production/Self-Hosted:**
- Register Craftastic as a GitHub OAuth App
- Use standard OAuth2 web flow
- Support dynamic callback URLs based on deployment

**Implementation:**
```typescript
// Configuration approach
interface GitHubAuthConfig {
  mode: 'oauth' | 'pat' | 'device';
  clientId?: string;      // For OAuth
  clientSecret?: string;  // For OAuth
  callbackUrl?: string;   // Dynamic based on deployment
}
```

### 2. Git Worktree Implementation

**Directory Structure:**
```
${CRAFTASTIC_DATA_DIR}/repos/{environment_id}/    # Default: ~/.craftastic/repos
├── .git/                          # Bare repository
└── worktrees/
    └── {session_id}/             # Each session gets its own worktree
        └── [project files]
```

**Configuration:**
```typescript
// config.ts
export const dataDir = process.env.CRAFTASTIC_DATA_DIR || path.join(os.homedir(), '.craftastic');
export const reposDir = path.join(dataDir, 'repos');
```

**Why Worktrees?**
- Isolated branches per session without full repo clones
- Efficient disk usage
- Fast branch switching
- Easy cleanup

**Session Creation Flow:**
```bash
# 1. First environment setup (one time)
git clone --bare <repo_url> ${CRAFTASTIC_DATA_DIR}/repos/{env_id}/.git

# 2. For each new session
cd ${CRAFTASTIC_DATA_DIR}/repos/{env_id}
git worktree add worktrees/{session_id} {branch_name}

# 3. Mount into container
docker run -v ${CRAFTASTIC_DATA_DIR}/repos/{env_id}/worktrees/{session_id}:/workspace ...
```

### 3. Credential Passing to Containers

**Option 1: Environment Variables (Recommended for MVP)**
```typescript
// Simple but effective for HTTPS
containerEnv: [
  `GIT_ASKPASS=/usr/local/bin/git-askpass`,
  `GITHUB_TOKEN=${encryptedToken}`,
]

// git-askpass script in container
#!/bin/sh
echo $GITHUB_TOKEN
```

**Option 2: Git Credential Helper**
```bash
# Configure in container startup
git config --global credential.helper 'store --file=/tmp/git-credentials'
echo "https://${GITHUB_TOKEN}:x-oauth-basic@github.com" > /tmp/git-credentials
```

**Option 3: SSH Agent Forwarding (Future)**
- More complex but supports SSH keys
- Requires SSH agent on host
- Better for advanced users

### 4. Git UI Panel Design

**Component Layout:**
```
┌─────────────────────────────────────────┐
│ Environment: my-project                 │
├─────────────────┬───────────────────────┤
│                 │                       │
│  Terminal       │  Git Panel           │
│                 │  ├─ Status           │
│                 │  ├─ Changes (Diff)   │
│                 │  ├─ Commit           │
│                 │  └─ Branch Info      │
│                 │                       │
└─────────────────┴───────────────────────┘
```

**Real-time Updates:**
- Poll git status every 5 seconds when panel is open
- Trigger updates after terminal commands
- WebSocket notifications for git operations

## Implementation Priority

### Phase 1: Core Git Integration (MVP)
1. **Database Schema Updates**
   - Add git-related fields to environments and sessions
   - Create github_tokens table

2. **Basic Worktree Support**
   - Implement worktree creation on session start
   - Mount worktrees into containers
   - Clean up worktrees on session deletion

3. **Simple Token Authentication**
   - UI for entering GitHub PAT
   - Pass token to containers via environment
   - Test with private repositories

### Phase 2: Enhanced UI
1. **Git Status Panel**
   - Real-time git status display
   - File change indicators
   - Branch information

2. **Git Operations**
   - Commit interface
   - Push/pull buttons
   - Basic diff viewer

### Phase 3: Advanced Features
1. **OAuth Integration**
   - Full GitHub OAuth flow
   - Repository browser
   - Token refresh handling

2. **Advanced Git Features**
   - Branch management UI
   - Merge conflict resolution
   - Git history viewer

## Technical Implementation Notes

### Worktree Management Service
```typescript
class WorktreeService {
  private dataDir: string;
  
  constructor() {
    this.dataDir = process.env.CRAFTASTIC_DATA_DIR || path.join(os.homedir(), '.craftastic');
  }
  
  async createWorktree(
    environmentId: string, 
    sessionId: string, 
    branch: string = 'main'
  ): Promise<string> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);
    const worktreePath = path.join(repoPath, 'worktrees', sessionId);
    
    // Ensure bare repo exists
    if (!await this.bareRepoExists(repoPath)) {
      await this.cloneBareRepo(environmentId);
    }
    
    // Create worktree
    await exec(`git -C ${repoPath} worktree add ${worktreePath} ${branch}`);
    
    return worktreePath;
  }
  
  async removeWorktree(environmentId: string, sessionId: string): Promise<void> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);
    await exec(`git -C ${repoPath} worktree remove worktrees/${sessionId}`);
  }
  
  async cloneBareRepo(environmentId: string, repoUrl: string): Promise<string> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);
    await fs.mkdir(path.dirname(repoPath), { recursive: true });
    await exec(`git clone --bare ${repoUrl} ${repoPath}/.git`);
    return repoPath;
  }
}
```

### Container Git Setup
```typescript
// In container startup script
const setupGitAuth = () => {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    // Configure git to use token
    fs.writeFileSync('/usr/local/bin/git-askpass', `#!/bin/sh\necho ${token}`);
    fs.chmodSync('/usr/local/bin/git-askpass', 0o755);
    process.env.GIT_ASKPASS = '/usr/local/bin/git-askpass';
  }
};
```

## Questions to Resolve

1. **Storage Location**: ✅ RESOLVED
   - Use `CRAFTASTIC_DATA_DIR` environment variable
   - Default to `~/.craftastic/repos/`
   - Store path in database for each environment

2. **GitHub Authentication**: ✅ RESOLVED
   - Use GitHub Device Flow for local development
   - No SSH, only token-based auth for now
   - Request scopes: `repo`, `read:user`, `user:email`, `write:pull_request`

3. **Branch Naming**: How to handle feature branch creation?
   - Proposal: `feature/{session_id}-{user_provided_name}`
   - Alternative: Let user specify full branch name

4. **Cleanup Policy**: When to clean up old worktrees?
   - Proposal: On session deletion + periodic cleanup of orphans

5. **Performance**: How to handle large repositories?
   - Proposal: Shallow clones option, git LFS support