# Session Credentials Architecture

## Overview

Sessions in Craftastic need to support multiple types of credentials:
1. **Git credentials** (GitHub tokens for repository access)
2. **Agent credentials** (API keys and OAuth configs for AI assistants)
3. **Service credentials** (Future: AWS, Docker registries, etc.)

This document outlines how we'll manage and inject these credentials into sessions.

## Credential Types and Sources

### 1. Git Credentials (Already Planned)
- **Source**: GitHub Device Flow / OAuth
- **Storage**: Encrypted in PostgreSQL
- **Injection**: Environment variables with GIT_ASKPASS

### 2. Agent Credentials (New Requirement)
- **Claude Code**: OAuth config file (`~/.config/claude/config.json`)
- **Anthropic API**: Environment variable (`ANTHROPIC_API_KEY`)
- **OpenAI**: Environment variable (`OPENAI_API_KEY`)
- **Other agents**: Various config files and env vars

### 3. Future Service Credentials
- **Cloud providers**: AWS, GCP, Azure credentials
- **Container registries**: Docker Hub, GitHub Container Registry
- **Package registries**: npm, PyPI private registries

## Architecture Approach

### Session Startup Flow
```
1. Create Session Request
   │
   ├─▶ Gather Environment Credentials
   │   ├─ Git credentials (from DB)
   │   ├─ User agent configs (from DB)
   │   └─ Global agent configs (from host)
   │
   ├─▶ Create Worktree
   │   └─ Mount at /workspace
   │
   ├─▶ Prepare Credential Injection
   │   ├─ Environment variables
   │   ├─ Config file mounts
   │   └─ Runtime secrets
   │
   └─▶ Start Container
       ├─ Mount worktree
       ├─ Mount config files (read-only)
       ├─ Set environment variables
       └─ Initialize agents
```

## Implementation Strategy

### 1. Database Schema Extensions
```sql
-- User-level agent configurations
CREATE TABLE user_agent_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  agent_type VARCHAR(50), -- 'claude', 'openai', 'anthropic', etc.
  config_type VARCHAR(50), -- 'oauth', 'api_key', 'config_file'
  encrypted_value TEXT, -- Encrypted JSON with config/key
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Environment-specific overrides
CREATE TABLE environment_agent_configs (
  id SERIAL PRIMARY KEY,
  environment_id INTEGER REFERENCES environments(id) ON DELETE CASCADE,
  agent_type VARCHAR(50),
  config_type VARCHAR(50),
  encrypted_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session credential audit log
CREATE TABLE session_credentials (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  credential_type VARCHAR(50), -- 'git', 'agent', 'service'
  credential_name VARCHAR(100), -- 'github', 'claude', 'anthropic'
  injected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Container Credential Injection

```typescript
interface SessionCredentials {
  environment: Record<string, string>;
  configMounts: Array<{
    source: string;      // Host path
    target: string;      // Container path
    readOnly: boolean;
  }>;
}

class CredentialService {
  async prepareSessionCredentials(
    userId: string,
    environmentId: string,
    sessionId: string
  ): Promise<SessionCredentials> {
    const credentials: SessionCredentials = {
      environment: {},
      configMounts: []
    };

    // 1. Git credentials (existing)
    const gitToken = await this.getGitToken(userId);
    if (gitToken) {
      credentials.environment.GITHUB_TOKEN = gitToken;
      credentials.environment.GIT_ASKPASS = '/usr/local/bin/git-askpass';
    }

    // 2. Agent credentials
    const agentConfigs = await this.getAgentConfigs(userId, environmentId);
    
    // Anthropic API key
    if (agentConfigs.anthropic?.apiKey) {
      credentials.environment.ANTHROPIC_API_KEY = agentConfigs.anthropic.apiKey;
    }

    // Claude config file
    if (agentConfigs.claude?.configPath) {
      // Create temporary config file with injected credentials
      const tempConfig = await this.createTempConfig(
        sessionId,
        agentConfigs.claude.config
      );
      
      credentials.configMounts.push({
        source: tempConfig,
        target: '/home/user/.config/claude/config.json',
        readOnly: true
      });
    }

    // OpenAI
    if (agentConfigs.openai?.apiKey) {
      credentials.environment.OPENAI_API_KEY = agentConfigs.openai.apiKey;
    }

    // Audit what we're injecting
    await this.auditCredentials(sessionId, credentials);

    return credentials;
  }

  private async createTempConfig(
    sessionId: string,
    config: any
  ): Promise<string> {
    // Create session-specific config file
    const tempDir = path.join(this.dataDir, 'session-configs', sessionId);
    await fs.mkdir(tempDir, { recursive: true });
    
    const configPath = path.join(tempDir, 'claude-config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    
    return configPath;
  }
}
```

### 3. Docker Container Configuration

```typescript
// Modified container creation
async createContainer(session: Session): Promise<string> {
  const credentials = await this.credentialService.prepareSessionCredentials(
    session.userId,
    session.environmentId,
    session.id
  );

  const config: ContainerCreateOptions = {
    Image: this.sandboxImage,
    Env: [
      // Git credentials
      ...Object.entries(credentials.environment).map(
        ([key, value]) => `${key}=${value}`
      ),
      
      // Default environment
      'NODE_ENV=development',
      `USER=${session.user}`,
      'HOME=/home/user',
    ],
    HostConfig: {
      Mounts: [
        // Worktree mount
        {
          Type: 'bind',
          Source: session.worktreePath,
          Target: '/workspace',
          Consistency: 'cached'
        },
        // Config file mounts
        ...credentials.configMounts.map(mount => ({
          Type: 'bind',
          Source: mount.source,
          Target: mount.target,
          ReadOnly: mount.readOnly
        }))
      ]
    }
  };

  return await this.docker.createContainer(config);
}
```

### 4. UI for Credential Management

```typescript
// New UI components
components/
├── credentials/
│   ├── CredentialManager.tsx    // Main credential management UI
│   ├── AgentCredentials.tsx     // Agent-specific configs
│   ├── GitCredentials.tsx       // GitHub integration
│   ├── CredentialStatus.tsx     // Show what's configured
│   └── claude/
│       ├── ClaudeAuthSetup.tsx  // Interactive Claude setup
│       ├── ClaudeConfigImport.tsx // Import existing config
│       └── ClaudeStatus.tsx     // Show Claude connection status

// User settings page addition
pages/Settings.tsx
└── Tabs
    ├── Profile
    ├── Git Integration
    └── Agent Credentials    // New tab
```

For Claude Code specifically, see `claude-code-auth-flow.md` for the detailed user-friendly authentication flow design.

## Security Considerations

### 1. Credential Isolation
- Each session gets its own credential set
- No credential sharing between sessions
- Read-only mounts for config files
- Session-specific temp configs deleted on cleanup

### 2. Encryption Strategy
```typescript
// All credentials encrypted at rest
class CredentialEncryption {
  private algorithm = 'aes-256-gcm';
  private key: Buffer;

  async encrypt(value: string): Promise<EncryptedValue> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  }
}
```

### 3. Audit Trail
- Log all credential injections
- Track which credentials are used by which sessions
- Never log actual credential values
- Retention policy for audit logs

## Credential Priority Order

When multiple credential sources exist:

1. **Environment-specific** (highest priority)
   - Credentials set for specific environment

2. **User-specific**
   - Credentials set in user settings

3. **Global defaults**
   - System-wide defaults (if any)

```typescript
// Priority resolution
async resolveCredential(
  type: string,
  userId: string,
  environmentId?: string
): Promise<string | null> {
  // 1. Check environment override
  if (environmentId) {
    const envCred = await this.getEnvironmentCredential(environmentId, type);
    if (envCred) return envCred;
  }
  
  // 2. Check user credential
  const userCred = await this.getUserCredential(userId, type);
  if (userCred) return userCred;
  
  // 3. Check global default
  return this.getGlobalDefault(type);
}
```

## Integration with Session Lifecycle

### Session Creation
1. User creates new session
2. System gathers all applicable credentials
3. Creates temporary config files if needed
4. Starts container with credentials injected
5. Audit log entry created

### Session Deletion
1. Stop container
2. Clean up temporary config files
3. Remove worktree
4. Audit log retained

### Credential Updates
- Changes to credentials don't affect running sessions
- User must create new session to use updated credentials
- Option to "refresh" session with new credentials (restart)

## Future Considerations

### 1. Dynamic Credential Injection
- Runtime credential updates without restart
- Credential rotation support
- Short-lived tokens

### 2. Credential Providers
- HashiCorp Vault integration
- AWS Secrets Manager
- Environment-specific providers

### 3. Team Credentials
- Shared team credentials
- Role-based access to credentials
- Credential approval workflows

## Implementation Priority

1. **Phase 1**: Basic environment variable injection
   - ANTHROPIC_API_KEY
   - OPENAI_API_KEY
   - Simple UI for entering keys

2. **Phase 2**: Config file mounting
   - Claude OAuth config
   - Read-only mounts
   - Temp file management

3. **Phase 3**: Advanced features
   - Credential inheritance
   - Environment overrides
   - Audit UI

This architecture ensures that agent credentials are handled securely while maintaining flexibility for different credential types and future extensions.