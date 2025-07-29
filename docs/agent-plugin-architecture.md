# Agent Plugin Architecture

## Overview

Craftastic needs a modular plugin system to support multiple AI coding assistants (Claude Code, Gemini CLI, Qwen Coder, etc.) without hardcoding each integration. This document outlines a plugin-based architecture that makes adding new agents straightforward.

## Plugin System Design

### 1. Agent Plugin Interface

```typescript
// Core plugin interface that all agents must implement
interface AgentPlugin {
  // Metadata
  id: string;                    // 'claude-code', 'gemini-cli', etc.
  name: string;                  // 'Claude Code'
  description: string;           // User-facing description
  icon?: string;                 // Icon URL or component
  
  // Installation
  dockerfileSnippet: string;     // Dockerfile commands to install
  installCommands?: string[];    // Alternative: shell commands
  requiredPackages?: string[];   // System packages needed
  
  // Authentication
  authMethods: AuthMethod[];     // Supported auth methods
  authConfig: AuthConfig;        // How to authenticate
  
  // Configuration
  configSchema: z.ZodSchema;     // Zod schema for config validation
  configPaths: ConfigPath[];     // Where configs are stored
  envVars: EnvVarMapping[];      // Environment variables needed
  
  // Commands
  commands: AgentCommand[];      // Available commands
  primaryCommand: string;        // Main executable name
  
  // Lifecycle hooks
  onInstall?: (session: Session) => Promise<void>;
  onSessionStart?: (session: Session, config: any) => Promise<void>;
  onSessionStop?: (session: Session) => Promise<void>;
}

interface AuthMethod {
  type: 'oauth' | 'api_key' | 'config_file' | 'device_flow';
  name: string;
  description: string;
  isInteractive: boolean;
}

interface ConfigPath {
  containerPath: string;         // Path inside container
  configKey: string;             // Key in our config store
  isRequired: boolean;
}

interface EnvVarMapping {
  name: string;                  // ENV var name
  configKey: string;             // Key in our config
  isSecret: boolean;
}

interface AgentCommand {
  name: string;                  // 'login', 'chat', etc.
  command: string;               // Actual command to run
  description: string;
  requiresAuth: boolean;
}
```

### 2. Agent Plugin Registry

```typescript
// Registry for all available agent plugins
class AgentPluginRegistry {
  private plugins: Map<string, AgentPlugin> = new Map();
  
  register(plugin: AgentPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }
  
  get(id: string): AgentPlugin | undefined {
    return this.plugins.get(id);
  }
  
  list(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }
  
  getEnabledForUser(userId: string): Promise<AgentPlugin[]> {
    // Return plugins user has enabled/configured
    const userAgents = await db.getUserAgents(userId);
    return userAgents
      .map(ua => this.get(ua.agentId))
      .filter(Boolean);
  }
}

// Global registry instance
export const agentRegistry = new AgentPluginRegistry();
```

### 3. Built-in Agent Plugins

#### Claude Code Plugin

```typescript
// plugins/claude-code.ts
import { z } from 'zod';

export const claudeCodePlugin: AgentPlugin = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Anthropic\'s AI coding assistant',
  icon: '/icons/claude.svg',
  
  // Since already in sandbox.Dockerfile
  dockerfileSnippet: '# Claude Code pre-installed in base image',
  
  authMethods: [
    {
      type: 'device_flow',
      name: 'Interactive Login',
      description: 'Login via browser (recommended)',
      isInteractive: true,
    },
    {
      type: 'config_file',
      name: 'Import Config',
      description: 'Import existing config.json',
      isInteractive: false,
    }
  ],
  
  authConfig: {
    deviceFlow: {
      command: 'claude login',
      configPath: '~/.config/claude/config.json',
    }
  },
  
  configSchema: z.object({
    auth: z.object({
      token: z.string(),
      expires_at: z.string().optional(),
    }),
    model: z.object({
      preferences: z.record(z.any()).optional(),
    }).optional(),
  }),
  
  configPaths: [
    {
      containerPath: '/home/user/.config/claude/config.json',
      configKey: 'claude.config',
      isRequired: true,
    }
  ],
  
  envVars: [],  // Claude uses config file, not env vars
  
  commands: [
    {
      name: 'login',
      command: 'claude login',
      description: 'Authenticate with Claude',
      requiresAuth: false,
    },
    {
      name: 'chat',
      command: 'claude',
      description: 'Start Claude interactive session',
      requiresAuth: true,
    }
  ],
  
  primaryCommand: 'claude',
};

// Register the plugin
agentRegistry.register(claudeCodePlugin);
```

#### Gemini CLI Plugin (Example)

```typescript
// plugins/gemini-cli.ts
export const geminiCliPlugin: AgentPlugin = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  description: 'Google\'s Gemini AI assistant',
  icon: '/icons/gemini.svg',
  
  dockerfileSnippet: `
# Install Gemini CLI
RUN curl -fsSL https://gemini.google.com/install.sh | sh && \\
    mv /root/.gemini/bin/gemini /usr/local/bin/
`,
  
  authMethods: [
    {
      type: 'api_key',
      name: 'API Key',
      description: 'Use Google Cloud API key',
      isInteractive: false,
    }
  ],
  
  configSchema: z.object({
    apiKey: z.string(),
    project: z.string().optional(),
  }),
  
  configPaths: [],
  
  envVars: [
    {
      name: 'GEMINI_API_KEY',
      configKey: 'apiKey',
      isSecret: true,
    },
    {
      name: 'GEMINI_PROJECT',
      configKey: 'project',
      isSecret: false,
    }
  ],
  
  commands: [
    {
      name: 'chat',
      command: 'gemini chat',
      description: 'Start Gemini chat session',
      requiresAuth: true,
    }
  ],
  
  primaryCommand: 'gemini',
};
```

### 4. Dynamic Dockerfile Generation

```typescript
class DockerfileGenerator {
  generateForSession(
    baseImage: string,
    enabledAgents: AgentPlugin[]
  ): string {
    const sections = [
      `FROM ${baseImage}`,
      '',
      '# Agent installations',
    ];
    
    for (const agent of enabledAgents) {
      if (agent.dockerfileSnippet) {
        sections.push(`# Install ${agent.name}`);
        sections.push(agent.dockerfileSnippet);
        sections.push('');
      }
    }
    
    return sections.join('\n');
  }
  
  async buildImage(
    sessionId: string,
    enabledAgents: AgentPlugin[]
  ): Promise<string> {
    const dockerfile = this.generateForSession(
      'craftastic/sandbox:base',
      enabledAgents
    );
    
    const imageName = `craftastic/session:${sessionId}`;
    
    // Build the image
    await docker.buildImage({
      context: this.createBuildContext(dockerfile),
      tags: [imageName],
    });
    
    return imageName;
  }
}
```

### 5. Agent Configuration UI

```typescript
// Components for agent management
const AgentManager: React.FC = () => {
  const [availableAgents] = useAgents();
  const [enabledAgents, setEnabledAgents] = useEnabledAgents();
  
  return (
    <div className="space-y-4">
      <h2>AI Assistants</h2>
      
      {availableAgents.map(agent => (
        <Card key={agent.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <img src={agent.icon} className="w-8 h-8" />
                <div>
                  <CardTitle>{agent.name}</CardTitle>
                  <CardDescription>{agent.description}</CardDescription>
                </div>
              </div>
              
              <Switch
                checked={enabledAgents.has(agent.id)}
                onCheckedChange={(checked) => toggleAgent(agent.id, checked)}
              />
            </div>
          </CardHeader>
          
          {enabledAgents.has(agent.id) && (
            <CardContent>
              <AgentAuthConfig agent={agent} />
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
};

// Agent-specific auth configuration
const AgentAuthConfig: React.FC<{ agent: AgentPlugin }> = ({ agent }) => {
  const [authMethod, setAuthMethod] = useState(agent.authMethods[0]);
  
  return (
    <div className="space-y-4">
      <Select value={authMethod.type} onValueChange={setAuthMethod}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {agent.authMethods.map(method => (
            <SelectItem key={method.type} value={method.type}>
              {method.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {authMethod.type === 'device_flow' && (
        <DeviceFlowAuth agent={agent} />
      )}
      
      {authMethod.type === 'api_key' && (
        <ApiKeyInput agent={agent} />
      )}
      
      {authMethod.type === 'config_file' && (
        <ConfigFileImport agent={agent} />
      )}
    </div>
  );
};
```

### 6. Session Integration

```typescript
class AgentSessionService {
  async prepareSession(
    session: Session,
    userId: string
  ): Promise<SessionConfig> {
    // Get enabled agents for user
    const enabledAgents = await agentRegistry.getEnabledForUser(userId);
    
    // Build custom image if needed
    const imageName = await this.ensureImage(session.id, enabledAgents);
    
    // Prepare credentials for all agents
    const credentials = await this.prepareCredentials(
      userId,
      session.environmentId,
      enabledAgents
    );
    
    return {
      image: imageName,
      env: credentials.env,
      mounts: credentials.mounts,
    };
  }
  
  private async prepareCredentials(
    userId: string,
    environmentId: string,
    agents: AgentPlugin[]
  ): Promise<Credentials> {
    const env: Record<string, string> = {};
    const mounts: Mount[] = [];
    
    for (const agent of agents) {
      const config = await this.getAgentConfig(userId, agent.id);
      
      // Set environment variables
      for (const envVar of agent.envVars) {
        const value = config[envVar.configKey];
        if (value) {
          env[envVar.name] = value;
        }
      }
      
      // Prepare config file mounts
      for (const configPath of agent.configPaths) {
        const configData = config[configPath.configKey];
        if (configData) {
          const tempPath = await this.createTempConfig(
            session.id,
            agent.id,
            configData
          );
          
          mounts.push({
            source: tempPath,
            target: configPath.containerPath,
            readOnly: true,
          });
        }
      }
      
      // Run lifecycle hook
      if (agent.onSessionStart) {
        await agent.onSessionStart(session, config);
      }
    }
    
    return { env, mounts };
  }
}
```

### 7. Database Schema for Plugins

```sql
-- Track which agents users have enabled
CREATE TABLE user_agents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  agent_id VARCHAR(50), -- 'claude-code', 'gemini-cli', etc.
  enabled BOOLEAN DEFAULT true,
  config JSONB, -- Encrypted agent-specific config
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, agent_id)
);

-- Track agent usage per session
CREATE TABLE session_agents (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id VARCHAR(50),
  config_snapshot JSONB, -- Config used for this session
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Plugin Development Guide

### Creating a New Agent Plugin

1. **Define the plugin**:
```typescript
// plugins/my-agent.ts
export const myAgentPlugin: AgentPlugin = {
  id: 'my-agent',
  name: 'My AI Agent',
  // ... implement interface
};
```

2. **Register the plugin**:
```typescript
// plugins/index.ts
import { myAgentPlugin } from './my-agent';
agentRegistry.register(myAgentPlugin);
```

3. **Add UI components** (if needed):
```typescript
// components/agents/my-agent/
// - Auth components
// - Config components
// - Status components
```

## Benefits of Plugin Architecture

1. **Extensibility**: Easy to add new agents without modifying core code
2. **Consistency**: All agents follow the same patterns
3. **User Choice**: Users can enable only the agents they need
4. **Performance**: Custom images built with only required agents
5. **Maintenance**: Agent-specific code isolated in plugins

## Future Enhancements

1. **Plugin Marketplace**: Community-contributed agent plugins
2. **Dynamic Loading**: Load plugins without restart
3. **Version Management**: Support multiple versions of agents
4. **Agent Chaining**: Use multiple agents in sequence
5. **Custom Commands**: User-defined agent commands

This architecture ensures Craftastic can grow to support any AI coding assistant while maintaining a clean, modular codebase.