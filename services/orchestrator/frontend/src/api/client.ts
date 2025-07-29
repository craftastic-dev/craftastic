const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Helper function to get common headers including auth
const getHeaders = (includeContentType: boolean = true, additionalHeaders: Record<string, string> = {}) => {
  const headers: Record<string, string> = {
    ...additionalHeaders,
  };
  
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  
  // In development, add test user ID header
  if (import.meta.env.DEV) {
    const userId = localStorage.getItem('userId') || `user-${Date.now()}`;
    headers['x-test-user-id'] = userId;
  }
  
  return headers;
};

export interface Environment {
  id: string;
  userId: string;
  name: string;
  repositoryUrl?: string;
  branch: string;
  containerId: string;
  status: 'running' | 'stopped' | 'starting' | 'error';
  createdAt: string;
  updatedAt: string;
  sessions: Session[];
}

export interface Session {
  id: string;
  environmentId: string;
  name: string;
  tmuxSessionName: string;
  workingDirectory: string;
  status: 'active' | 'inactive' | 'dead';
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
  agentId?: string;
  sessionType: 'terminal' | 'agent';
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  type: 'claude-code' | 'gemini-cli' | 'qwen-coder';
  createdAt: string;
  updatedAt: string;
  credential?: AgentCredential;
}

export interface AgentCredential {
  type: string; // oauth, anthropic_api_key, gemini_api_key, etc.
  value: string; // the actual credential value (decrypted when retrieved)
}

export interface Container {
  Id: string;
  Names: string[];
  Status: string;
  Labels: Record<string, string>;
}

export const api = {
  // Environment management
  async createEnvironment(userId: string, name: string, repositoryUrl?: string, branch = 'main'): Promise<Environment> {
    const response = await fetch(`${API_BASE}/environments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name, repositoryUrl, branch }),
    });
    
    if (!response.ok) throw new Error('Failed to create environment');
    return response.json();
  },

  async getUserEnvironments(userId: string): Promise<{ environments: Environment[] }> {
    const response = await fetch(`${API_BASE}/environments/user/${userId}`);
    
    if (!response.ok) throw new Error('Failed to get environments');
    return response.json();
  },

  async getEnvironment(environmentId: string): Promise<Environment> {
    const response = await fetch(`${API_BASE}/environments/${environmentId}`);
    
    if (!response.ok) throw new Error('Failed to get environment');
    return response.json();
  },

  async deleteEnvironment(environmentId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/environments/${environmentId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) throw new Error('Failed to delete environment');
  },

  // Session management  
  async createSession(environmentId: string, name?: string, workingDirectory = '/', sessionType: 'terminal' | 'agent' = 'terminal', agentId?: string): Promise<Session> {
    const response = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environmentId, name, workingDirectory, sessionType, agentId }),
    });
    
    if (!response.ok) throw new Error('Failed to create session');
    return response.json();
  },

  async getEnvironmentSessions(environmentId: string): Promise<{ sessions: Session[] }> {
    const response = await fetch(`${API_BASE}/sessions/environment/${environmentId}`);
    
    if (!response.ok) throw new Error('Failed to get sessions');
    return response.json();
  },

  async getSession(sessionId: string): Promise<Session> {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
    
    if (!response.ok) throw new Error('Failed to get session');
    return response.json();
  },

  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) throw new Error('Failed to delete session');
  },

  // GitHub authentication
  async initiateGitHubAuth(): Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }> {
    const response = await fetch(`${API_BASE}/auth/github/initiate`, {
      method: 'POST',
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    if (!response.ok) throw new Error('Failed to initiate GitHub auth');
    const result = await response.json();
    return result.data;
  },

  async pollGitHubAuth(deviceCode: string, interval?: number): Promise<void> {
    const response = await fetch(`${API_BASE}/auth/github/poll`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ deviceCode, interval }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Authentication failed');
    }
  },

  async disconnectGitHub(): Promise<void> {
    const response = await fetch(`${API_BASE}/auth/github/disconnect`, {
      method: 'DELETE',
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    if (!response.ok) throw new Error('Failed to disconnect GitHub');
  },

  async getGitHubStatus(): Promise<{ connected: boolean; username?: string }> {
    const response = await fetch(`${API_BASE}/auth/github/status`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    if (!response.ok) throw new Error('Failed to get GitHub status');
    const result = await response.json();
    return result.data;
  },

  // Git operations (now session-based)
  async gitCommit(sessionId: string, message: string, files?: string[]): Promise<any> {
    const response = await fetch(`${API_BASE}/git/commit/${sessionId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ message, files }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to commit');
    }
    return response.json();
  },

  async gitPush(sessionId: string, remote = 'origin', branch?: string): Promise<any> {
    const response = await fetch(`${API_BASE}/git/push/${sessionId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ remote, branch }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to push');
    }
    return response.json();
  },

  async gitStatus(sessionId: string): Promise<{ 
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
    files: Array<{ 
      filename: string; 
      status: string; 
      staged: boolean; 
      modified: boolean;
    }>;
    clean: boolean;
  }> {
    const response = await fetch(`${API_BASE}/git/status/${sessionId}`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get git status');
    }
    const result = await response.json();
    return result.data;
  },

  async gitDiff(sessionId: string, file?: string, staged?: boolean): Promise<{
    diff: string;
    file: string | null;
    staged: boolean;
  }> {
    const params = new URLSearchParams();
    if (file) params.append('file', file);
    if (staged) params.append('staged', 'true');
    
    const response = await fetch(`${API_BASE}/git/diff/${sessionId}?${params}`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get git diff');
    }
    const result = await response.json();
    return result.data;
  },

  async gitLog(sessionId: string, limit = 10, offset = 0): Promise<{
    commits: Array<{
      hash: string;
      author: string;
      email: string;
      date: string;
      message: string;
    }>;
    limit: number;
    offset: number;
  }> {
    const response = await fetch(`${API_BASE}/git/log/${sessionId}?limit=${limit}&offset=${offset}`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get git log');
    }
    const result = await response.json();
    return result.data;
  },

  async getRepositoryInfo(environmentId: string): Promise<{
    path: string;
    branches: string[];
    currentBranch: string;
    remoteUrl: string;
  }> {
    const response = await fetch(`${API_BASE}/git/repo/${environmentId}`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get repository info');
    }
    const result = await response.json();
    return result.data;
  },

  // Deployment
  async deploy(environmentId: string, appId: string, branch = 'main'): Promise<any> {
    const response = await fetch(`${API_BASE}/deployment/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environmentId, appId, branch }),
    });
    
    if (!response.ok) throw new Error('Failed to deploy');
    return response.json();
  },

  // Agent management
  async createAgent(userId: string, name: string, type: 'claude-code' | 'gemini-cli' | 'qwen-coder', credential?: AgentCredential): Promise<Agent> {
    const response = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name, type, credential }),
    });
    
    if (!response.ok) throw new Error('Failed to create agent');
    return response.json();
  },

  async getUserAgents(userId: string): Promise<{ agents: Agent[] }> {
    const response = await fetch(`${API_BASE}/agents/user/${userId}`);
    
    if (!response.ok) throw new Error('Failed to get agents');
    return response.json();
  },

  async getAgent(agentId: string): Promise<Agent> {
    const response = await fetch(`${API_BASE}/agents/${agentId}`);
    
    if (!response.ok) throw new Error('Failed to get agent');
    return response.json();
  },

  async updateAgent(agentId: string, updates: { name?: string, credential?: AgentCredential }): Promise<Agent> {
    const response = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    
    if (!response.ok) throw new Error('Failed to update agent');
    return response.json();
  },

  async deleteAgent(agentId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) throw new Error('Failed to delete agent');
  },

  // Legacy container methods (for backward compatibility during transition)
  async listContainers(userId?: string): Promise<{ containers: Container[] }> {
    const params = userId ? `?userId=${userId}` : '';
    const response = await fetch(`${API_BASE}/containers/list${params}`);
    
    if (!response.ok) throw new Error('Failed to list containers');
    return response.json();
  },

  async deleteContainer(containerId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/containers/${containerId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) throw new Error('Failed to delete container');
  },
};