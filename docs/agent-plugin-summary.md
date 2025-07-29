# Agent Plugin System - Summary

## Overview

The agent plugin architecture allows Craftastic to support multiple AI coding assistants (Claude Code, Gemini CLI, Qwen Coder, etc.) through a modular plugin system.

## Key Concepts

### 1. Plugin Definition
Each agent is defined as a plugin with:
- **Metadata**: ID, name, description, icon
- **Installation**: Dockerfile snippet or commands
- **Authentication**: Supported auth methods (OAuth, API key, etc.)
- **Configuration**: Schema, paths, environment variables
- **Commands**: Available commands and how to run them

### 2. Current State vs Future

**Current (Claude Code)**:
- Claude Code is pre-installed in `sandbox.Dockerfile`
- Authentication handled specially for Claude
- Hardcoded configuration

**Future (Plugin System)**:
- Each agent defined as a plugin
- Dynamic image building based on enabled agents
- Consistent auth/config handling across all agents

### 3. Migration Path

```typescript
// Step 1: Define Claude as a plugin (while keeping existing behavior)
const claudeCodePlugin: AgentPlugin = {
  id: 'claude-code',
  name: 'Claude Code',
  dockerfileSnippet: '# Pre-installed in base image',
  // ... rest of definition
};

// Step 2: Gradually move logic to plugin system
// - Auth flows become plugin-driven
// - Config handling uses plugin schema
// - Commands use plugin definitions

// Step 3: Add new agents using plugin system
const geminiPlugin: AgentPlugin = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  dockerfileSnippet: 'RUN install-gemini-cli.sh',
  // ... full plugin definition
};
```

## Implementation Strategy

### Phase 1: Plugin Framework (Keep existing Claude behavior)
1. Create plugin interface and registry
2. Define Claude Code as a plugin
3. Build plugin UI components
4. Keep existing Claude auth flow

### Phase 2: Migrate Claude to Plugin System
1. Move Claude auth to plugin-based flow
2. Use plugin config schema for validation
3. Test thoroughly to ensure no regression

### Phase 3: Add New Agents
1. Create plugins for Gemini, Qwen, etc.
2. Implement agent-specific auth flows
3. Enable dynamic image building

## Benefits

1. **Extensibility**: Easy to add new AI assistants
2. **Consistency**: All agents follow same patterns
3. **User Control**: Enable/disable agents per user
4. **Maintainability**: Agent code isolated in plugins
5. **Future-Proof**: Ready for new AI tools

## Example: Adding a New Agent

```typescript
// 1. Create plugin definition
export const qwenCoderPlugin: AgentPlugin = {
  id: 'qwen-coder',
  name: 'Qwen Coder',
  
  dockerfileSnippet: `
RUN curl -L https://qwen.ai/install | sh && \\
    mv qwen /usr/local/bin/
`,
  
  authMethods: [{
    type: 'api_key',
    name: 'API Key',
    description: 'Qwen API key',
    isInteractive: false,
  }],
  
  envVars: [{
    name: 'QWEN_API_KEY',
    configKey: 'apiKey',
    isSecret: true,
  }],
  
  commands: [{
    name: 'code',
    command: 'qwen code',
    description: 'Start Qwen coding session',
    requiresAuth: true,
  }],
  
  primaryCommand: 'qwen',
};

// 2. Register the plugin
agentRegistry.register(qwenCoderPlugin);

// 3. Done! Users can now enable Qwen Coder in settings
```

## Database Changes

```sql
-- Simple schema to track agent enablement
CREATE TABLE user_agents (
  user_id INTEGER,
  agent_id VARCHAR(50),
  enabled BOOLEAN,
  config JSONB, -- Encrypted
  PRIMARY KEY (user_id, agent_id)
);
```

## UI Flow

```
Settings > AI Assistants
├─ Claude Code     [✓] Enabled
│  └─ Status: Configured ✓
├─ Gemini CLI      [✓] Enabled  
│  └─ Configure → [API Key: ****]
└─ Qwen Coder      [ ] Enable
```

## Summary

The plugin architecture provides a clean path to:
1. Keep Claude Code working as-is initially
2. Gradually migrate to plugin-based system
3. Easily add support for new AI assistants
4. Give users control over which agents to use

This design balances immediate functionality with long-term extensibility.