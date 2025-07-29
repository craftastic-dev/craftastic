# Claude Code Authentication Flow Design

## Overview

Making Claude Code authentication user-friendly requires handling two distinct scenarios:
1. **Local development**: Can potentially access existing Claude Code config
2. **Remote deployment**: No access to local configs, need guided setup

## User Experience Flow

### Initial Setup Flow

```
┌─────────────────────────────────────────────────┐
│          Claude Code Setup Required              │
├─────────────────────────────────────────────────┤
│                                                  │
│  We need to set up Claude Code access.          │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ 🔍 Checking for existing config...       │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  Choose setup method:                            │
│                                                  │
│  ╭─────────────────────────────────────────╮   │
│  │ ✓ Interactive Setup (Recommended)       │   │
│  │   Let us guide you through login        │   │
│  ╰─────────────────────────────────────────╯   │
│                                                  │
│  ╭─────────────────────────────────────────╮   │
│  │   Import Existing Config                 │   │
│  │   Upload your config.json file          │   │
│  ╰─────────────────────────────────────────╯   │
│                                                  │
│  ╭─────────────────────────────────────────╮   │
│  │   Manual Configuration                   │   │
│  │   Enter details manually                 │   │
│  ╰─────────────────────────────────────────╯   │
│                                                  │
└─────────────────────────────────────────────────┘
```

## Implementation Approach

### 1. Local Config Detection (Local Dev Only)

```typescript
class ClaudeConfigService {
  async detectLocalConfig(): Promise<ClaudeConfig | null> {
    // Only attempt on local development
    if (!this.isLocalDevelopment()) {
      return null;
    }

    const configPaths = [
      path.join(os.homedir(), '.config', 'claude', 'config.json'),
      path.join(os.homedir(), '.claude', 'config.json'),
      // Other potential locations
    ];

    for (const configPath of configPaths) {
      try {
        if (await fs.pathExists(configPath)) {
          const config = await fs.readJson(configPath);
          // Validate config structure
          if (this.isValidClaudeConfig(config)) {
            return config;
          }
        }
      } catch (error) {
        // Continue checking other paths
      }
    }

    return null;
  }
}
```

### 2. Interactive Claude Code Setup

The key innovation: **Run Claude Code in a temporary container** to handle the auth flow:

```typescript
class ClaudeInteractiveAuth {
  async runInteractiveSetup(): Promise<ClaudeConfig> {
    // 1. Create a temporary container with Claude Code
    const container = await this.createAuthContainer();
    
    // 2. Connect user's terminal to the container
    const pty = await this.attachTerminal(container);
    
    // 3. Run claude login command
    await this.executeInContainer(container, 'claude', ['login']);
    
    // 4. User completes interactive flow in their browser
    // Claude Code handles the OAuth flow
    
    // 5. Extract the generated config
    const config = await this.extractConfig(container);
    
    // 6. Clean up
    await this.cleanupContainer(container);
    
    return config;
  }

  private async createAuthContainer(): Promise<Container> {
    // Use sandbox image which already has Claude Code installed
    const config = {
      Image: 'craftastic/sandbox:latest', // Claude pre-installed
      Cmd: ['/bin/bash'],
      Tty: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: '/tmp',
      Env: [
        'HOME=/tmp/claude-home',
        'TERM=xterm-256color'
      ],
      HostConfig: {
        AutoRemove: false, // We need to extract config first
        NetworkMode: 'bridge', // Need internet for OAuth
      }
    };

    const container = await docker.createContainer(config);
    await container.start();

    // Claude Code is already installed in sandbox image
    // No need to install

    return container;
  }

  // Note: This method is not needed since Claude is pre-installed in sandbox.Dockerfile
  // Keeping for reference if we need to support dynamic agent installation
  private async installClaude(container: Container): Promise<void> {
    // For dynamic installation, see agent-plugin-architecture.md
    throw new Error('Claude Code should be pre-installed in sandbox image');
  }

  private async extractConfig(container: Container): Promise<ClaudeConfig> {
    // Extract the generated config file
    const configPath = '/tmp/claude-home/.config/claude/config.json';
    
    const stream = await container.getArchive({ path: configPath });
    const extracted = await this.extractFromTar(stream);
    
    return JSON.parse(extracted);
  }
}
```

### 3. Terminal UI for Interactive Setup

```typescript
// React component for interactive setup
const ClaudeAuthSetup: React.FC = () => {
  const [stage, setStage] = useState<'init' | 'running' | 'success'>('init');
  const [terminalRef, setTerminalRef] = useState<XTerm | null>(null);

  const startInteractiveSetup = async () => {
    setStage('running');
    
    // Create websocket connection to auth container
    const ws = new WebSocket(`/api/claude-auth/interactive`);
    
    ws.onopen = () => {
      // Terminal is ready
      terminalRef?.write('Starting Claude Code authentication...\n');
    };

    ws.onmessage = (event) => {
      // Stream terminal output
      terminalRef?.write(event.data);
    };

    ws.onclose = () => {
      // Auth complete or failed
      checkAuthStatus();
    };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude Code Authentication</CardTitle>
      </CardHeader>
      <CardContent>
        {stage === 'init' && (
          <>
            <p>We'll guide you through the Claude Code login process.</p>
            <Button onClick={startInteractiveSetup}>
              Start Interactive Setup
            </Button>
          </>
        )}
        
        {stage === 'running' && (
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Follow the instructions below to authenticate with Claude Code.
                A browser window should open automatically.
              </AlertDescription>
            </Alert>
            
            <div className="h-96 border rounded">
              <Terminal 
                ref={setTerminalRef}
                className="h-full"
              />
            </div>
          </div>
        )}
        
        {stage === 'success' && (
          <Alert className="bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription>
              Claude Code authenticated successfully!
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};
```

### 4. Backend API Endpoints

```typescript
// New API endpoints for Claude auth
router.get('/api/claude-auth/check', async (req, res) => {
  const hasConfig = await claudeService.userHasConfig(req.user.id);
  const localConfig = await claudeService.detectLocalConfig();
  
  return res.json({
    hasExistingConfig: hasConfig,
    localConfigDetected: !!localConfig,
    setupMethods: ['interactive', 'import', 'manual']
  });
});

router.post('/api/claude-auth/import-local', async (req, res) => {
  const localConfig = await claudeService.detectLocalConfig();
  if (!localConfig) {
    return res.status(404).json({ error: 'No local config found' });
  }
  
  await claudeService.saveUserConfig(req.user.id, localConfig);
  return res.json({ success: true });
});

router.ws('/api/claude-auth/interactive', async (ws, req) => {
  // WebSocket for interactive terminal
  const authSession = await claudeService.createInteractiveSession(req.user.id);
  
  // Pipe container PTY to WebSocket
  authSession.on('data', (data) => ws.send(data));
  ws.on('message', (data) => authSession.write(data));
  
  authSession.on('complete', async (config) => {
    await claudeService.saveUserConfig(req.user.id, config);
    ws.close();
  });
});
```

### 5. Alternative: Guided Manual Setup

For cases where interactive setup isn't possible:

```typescript
const ManualClaudeSetup: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual Claude Code Setup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3>Step 1: Install Claude Code</h3>
          <CodeBlock language="bash">
            curl -fsSL https://console.anthropic.com/install.sh | sh
          </CodeBlock>
        </div>
        
        <div>
          <h3>Step 2: Login to Claude</h3>
          <CodeBlock language="bash">
            claude login
          </CodeBlock>
          <p className="text-sm text-gray-600 mt-2">
            This will open your browser. Complete the login process.
          </p>
        </div>
        
        <div>
          <h3>Step 3: Copy your config file</h3>
          <p>Find your config at:</p>
          <CodeBlock language="bash">
            cat ~/.config/claude/config.json
          </CodeBlock>
        </div>
        
        <div>
          <h3>Step 4: Paste config here</h3>
          <Textarea 
            placeholder="Paste your config.json contents"
            rows={10}
            onChange={(e) => setConfigJson(e.target.value)}
          />
        </div>
        
        <Button onClick={saveConfig}>
          Save Configuration
        </Button>
      </CardContent>
    </Card>
  );
};
```

## User Experience Optimizations

### 1. Smart Detection and Suggestions

```typescript
// Detect user's scenario and suggest best approach
const getRecommendedAuthMethod = async (): Promise<AuthMethod> => {
  // Check if running locally with existing config
  if (isLocalDevelopment && await hasLocalConfig()) {
    return 'import-local';
  }
  
  // Check if we can run containers (for interactive)
  if (await canRunContainers()) {
    return 'interactive';
  }
  
  // Fallback to manual
  return 'manual';
};
```

### 2. Simplified First-Time Experience

```typescript
// First-time user flow
const FirstTimeSetup: React.FC = () => {
  const [skipSetup, setSkipSetup] = useState(false);
  
  return (
    <Modal open={!hasClaudeConfig && !skipSetup}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Welcome to Craftastic! 🚀</ModalTitle>
          <ModalDescription>
            Let's set up Claude Code for AI-powered development
          </ModalDescription>
        </ModalHeader>
        
        <div className="space-y-4">
          <Button 
            onClick={startQuickSetup} 
            className="w-full"
            variant="primary"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Quick Setup (2 minutes)
          </Button>
          
          <Button 
            onClick={() => setSkipSetup(true)}
            variant="outline"
            className="w-full"
          >
            Set Up Later
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
};
```

### 3. Configuration Validation

```typescript
// Validate Claude config before saving
interface ClaudeConfigValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

const validateClaudeConfig = async (
  config: any
): Promise<ClaudeConfigValidation> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check required fields
  if (!config.auth?.token) {
    errors.push('Missing authentication token');
  }
  
  // Test the configuration
  try {
    await testClaudeConnection(config);
  } catch (error) {
    errors.push(`Connection test failed: ${error.message}`);
  }
  
  // Check optional features
  if (!config.model?.preferences) {
    warnings.push('No model preferences set');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};
```

## Security Considerations

1. **Config Encryption**: All configs stored encrypted
2. **Container Isolation**: Auth containers are isolated and temporary
3. **No Token Logging**: Never log authentication tokens
4. **Secure Transport**: Use HTTPS for all auth flows
5. **Token Scoping**: Request minimum required permissions

## Implementation Priority

1. **Phase 1**: Manual config import
   - Simple textarea for config paste
   - Basic validation

2. **Phase 2**: Local config detection
   - Auto-detect on local development
   - One-click import

3. **Phase 3**: Interactive container setup
   - Full guided experience
   - Automatic config extraction

This approach provides multiple paths for users to authenticate, from fully automated (interactive container) to manual (copy-paste), ensuring a smooth experience regardless of deployment scenario.