# GitHub Authentication for Local Development

## Authentication Options Comparison

### Option 1: GitHub Device Flow (Recommended) ✅

**How it works:**
1. User initiates auth in Craftastic
2. Craftastic shows a code and URL
3. User visits github.com/login/device
4. User enters the code
5. Craftastic polls for completion
6. Token is received and stored

**Pros:**
- No callback URL needed (works on any port)
- Same flow as GitHub CLI (`gh auth login`)
- Professional, secure experience
- Works behind firewalls/NAT
- No need to manage OAuth app

**Cons:**
- Requires user to visit external URL
- Slightly more steps than OAuth

**Implementation:**
```typescript
// Device flow implementation
const initiateDeviceFlow = async () => {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'repo read:user user:email write:pull_request'
    })
  });
  
  const { device_code, user_code, verification_uri, expires_in } = await response.json();
  
  // Show user the code and URL
  console.log(`Please visit: ${verification_uri}`);
  console.log(`And enter code: ${user_code}`);
  
  // Poll for completion
  return pollForToken(device_code);
};
```

### Option 2: Personal Access Token (Simplest)

**How it works:**
1. User creates PAT on GitHub
2. User enters PAT in Craftastic UI
3. Token is validated and stored

**Pros:**
- Dead simple implementation
- No OAuth complexity
- Works immediately
- User has full control

**Cons:**
- Manual token creation
- Less user-friendly
- Token management burden on user

### Option 3: Localhost OAuth App ❌

**How it works:**
1. Register OAuth app with localhost:3000 callback
2. Standard OAuth flow
3. Redirect back to localhost

**Pros:**
- Familiar OAuth flow
- One-click authorization

**Cons:**
- **Requires fixed port (3000)**
- **Breaks if port is in use**
- **Each developer needs own OAuth app**
- **Callback URL issues**
- Security concerns with localhost redirects

## Recommendation: GitHub Device Flow

Based on your requirements, I strongly recommend the **GitHub Device Flow** for local development:

1. **No port conflicts** - Works regardless of which port Craftastic runs on
2. **Same as GitHub CLI** - Users familiar with `gh auth login` will recognize the flow
3. **No OAuth app management** - Use GitHub's built-in device flow client
4. **Production-ready** - Same code can work in production with minor tweaks

## Implementation Plan

### 1. Configuration
```typescript
// config.ts
export const githubAuth = {
  // GitHub's device flow client ID (public)
  deviceClientId: '178c6fc778ccc68e1d6a',
  
  // For production OAuth (future)
  oauthClientId: process.env.GITHUB_OAUTH_CLIENT_ID,
  oauthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  
  // Required scopes
  scopes: ['repo', 'read:user', 'user:email', 'write:pull_request']
};
```

### 2. Device Flow Service
```typescript
class GitHubAuthService {
  async authenticateDevice(): Promise<string> {
    // 1. Request device code
    const deviceCode = await this.requestDeviceCode();
    
    // 2. Show code to user (emit via WebSocket or return)
    this.onDeviceCode(deviceCode);
    
    // 3. Poll for token
    const token = await this.pollForToken(deviceCode);
    
    // 4. Store encrypted token
    await this.storeToken(token);
    
    return token;
  }
  
  private async pollForToken(deviceCode: DeviceCode): Promise<string> {
    const interval = deviceCode.interval || 5;
    const expiresAt = Date.now() + (deviceCode.expires_in * 1000);
    
    while (Date.now() < expiresAt) {
      try {
        const token = await this.checkDeviceAuthorization(deviceCode.device_code);
        if (token) return token;
      } catch (error) {
        if (error.error === 'authorization_pending') {
          // Continue polling
        } else if (error.error === 'slow_down') {
          // Increase interval
          interval += 5;
        } else {
          throw error;
        }
      }
      
      await sleep(interval * 1000);
    }
    
    throw new Error('Device authorization expired');
  }
}
```

### 3. UI Flow
```typescript
// React component for device auth
const GitHubDeviceAuth: React.FC = () => {
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  
  const initiateAuth = async () => {
    const code = await api.github.initiateDeviceAuth();
    setDeviceCode(code);
    setIsPolling(true);
    
    // Start polling in background
    try {
      await api.github.waitForDeviceAuth(code.device_code);
      toast.success('GitHub authenticated successfully!');
      onSuccess();
    } catch (error) {
      toast.error('Authentication failed');
    } finally {
      setIsPolling(false);
    }
  };
  
  if (deviceCode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Authenticate with GitHub</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Please visit:</p>
          <a href={deviceCode.verification_uri} target="_blank">
            {deviceCode.verification_uri}
          </a>
          <p>And enter this code:</p>
          <div className="text-2xl font-mono">{deviceCode.user_code}</div>
          {isPolling && <Spinner />}
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Button onClick={initiateAuth}>
      Connect GitHub Account
    </Button>
  );
};
```

### 4. Token Storage
```typescript
// Same encryption for device flow or PAT
interface StoredToken {
  type: 'device' | 'pat' | 'oauth';
  token: string; // Encrypted
  expires_at?: Date;
  scopes: string[];
}
```

## Migration Path

1. **Phase 1**: Implement device flow for local development
2. **Phase 2**: Add PAT option as fallback
3. **Phase 3**: Add OAuth for production deployments
4. **Phase 4**: Automatic detection of best auth method

## Security Considerations

- Store all tokens encrypted (AES-256)
- Validate token scopes before storage
- Implement token refresh for OAuth (future)
- Audit all git operations with token usage
- Never log or expose tokens

## Summary

The GitHub Device Flow provides the best balance of:
- ✅ User experience (similar to GitHub CLI)
- ✅ Security (no localhost redirects)
- ✅ Flexibility (works on any port)
- ✅ Simplicity (no OAuth app management)

This approach avoids the pitfalls of localhost OAuth apps while providing a professional authentication experience that developers will recognize from other CLI tools.