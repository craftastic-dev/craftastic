const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

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

  // Git operations (now environment-based)
  async gitCommit(environmentId: string, message: string, files?: string[]): Promise<any> {
    const response = await fetch(`${API_BASE}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environmentId, message, files }),
    });
    
    if (!response.ok) throw new Error('Failed to commit');
    return response.json();
  },

  async gitPush(environmentId: string, branch = 'main'): Promise<any> {
    const response = await fetch(`${API_BASE}/git/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environmentId, branch }),
    });
    
    if (!response.ok) throw new Error('Failed to push');
    return response.json();
  },

  async gitStatus(environmentId: string): Promise<{ files: Array<{ status: string; path: string }> }> {
    const response = await fetch(`${API_BASE}/git/status/${environmentId}`);
    
    if (!response.ok) throw new Error('Failed to get git status');
    return response.json();
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