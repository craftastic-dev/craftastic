const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Helper function to check if token is expired or about to expire
const isTokenExpired = (token: string, bufferMinutes: number = 5): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresAt = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const bufferMs = bufferMinutes * 60 * 1000;
    return expiresAt - now < bufferMs; // True if expires within buffer time
  } catch (error) {
    console.error('Failed to parse JWT token:', error);
    return true; // Assume expired if can't parse
  }
};

// Helper function to refresh token if needed
export const ensureValidToken = async (): Promise<boolean> => {
  const accessToken = localStorage.getItem('accessToken');
  const refreshToken = localStorage.getItem('refreshToken');
  
  if (!accessToken || !refreshToken) {
    return false;
  }
  
  if (!isTokenExpired(accessToken)) {
    return true; // Token is still valid
  }
  
  // Token is expired or about to expire, refresh it
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    
    if (response.ok) {
      const result = await response.json();
      localStorage.setItem('accessToken', result.data.accessToken);
      localStorage.setItem('refreshToken', result.data.refreshToken);
      return true;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }
  
  // Clear tokens if refresh failed
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  return false;
};

// Helper function to get common headers including auth
const getHeaders = (includeContentType: boolean = true, additionalHeaders: Record<string, string> = {}) => {
  const headers: Record<string, string> = {
    ...additionalHeaders,
  };
  
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  
  // Add JWT token if available
  const accessToken = localStorage.getItem('accessToken');
  
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  
  return headers;
};

// Helper function to handle API responses with token refresh
const handleApiResponse = async (response: Response, originalRequest?: () => Promise<Response>): Promise<Response> => {
  if (response.status === 401 && originalRequest) {
    // Try to refresh token
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (refreshResponse.ok) {
          const result = await refreshResponse.json();
          localStorage.setItem('accessToken', result.data.accessToken);
          localStorage.setItem('refreshToken', result.data.refreshToken);
          
          // Retry original request
          return await originalRequest();
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }
    
    // Clear auth and redirect to login
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    window.location.reload(); // This will show the auth form
  }
  
  return response;
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
  gitBranch?: string;
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  type: 'claude-code' | 'gemini-cli' | 'qwen-coder' | 'cursor-cli';
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
    const makeRequest = async () => fetch(`${API_BASE}/environments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ userId, name, repositoryUrl, branch }),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to create environment' }));
      const errorMessage = errorData.details || errorData.error || 'Failed to create environment';
      const error = new Error(errorMessage);
      (error as any).code = response.status;
      (error as any).suggestions = errorData.suggestions;
      throw error;
    }
    return response.json();
  },

  async getUserEnvironments(userId: string): Promise<{ environments: Environment[] }> {
    const makeRequest = async () => fetch(`${API_BASE}/environments/user/${userId}`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to get environments');
    return response.json();
  },

  async getEnvironment(environmentId: string): Promise<Environment> {
    const makeRequest = async () => fetch(`${API_BASE}/environments/${environmentId}`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to get environment');
    return response.json();
  },

  async deleteEnvironment(environmentId: string): Promise<void> {
    const makeRequest = async () => fetch(`${API_BASE}/environments/${environmentId}`, {
      method: 'DELETE',
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to delete environment');
  },

  async checkEnvironmentName(userId: string, name: string): Promise<{
    available: boolean;
    name: string;
    suggestions: string[];
    message: string;
  }> {
    const makeRequest = async () => fetch(`${API_BASE}/environments/check-name/${userId}/${encodeURIComponent(name)}`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to check environment name');
    return response.json();
  },

  // Session management
  async checkSessionName(environmentId: string, name: string): Promise<{
    available: boolean;
    name: string;
    message: string;
    existingSession?: {
      id: string;
      name: string;
      createdAt: string;
    };
  }> {
    const makeRequest = async () => fetch(`${API_BASE}/sessions/check-name/${environmentId}/${encodeURIComponent(name)}`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to check session name');
    return response.json();
  },

  async checkBranchAvailability(environmentId: string, branch: string): Promise<{
    available: boolean;
    branch: string;
    message: string;
    existingSession?: {
      id: string;
      name: string;
      branch: string;
      createdAt: string;
    };
  }> {
    const makeRequest = async () => fetch(`${API_BASE}/sessions/check-branch/${environmentId}/${encodeURIComponent(branch)}`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to check branch availability');
    return response.json();
  },
  
  async createSession(environmentId: string, name?: string, branch?: string, workingDirectory = '/', sessionType: 'terminal' | 'agent' = 'terminal', agentId?: string): Promise<Session> {
    const makeRequest = async () => fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ environmentId, name, branch, workingDirectory, sessionType, agentId }),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to create session' }));
      const error = new Error(errorData.message || errorData.error || 'Failed to create session');
      (error as any).code = errorData.error;
      (error as any).existingSession = errorData.existingSession;
      (error as any).details = errorData.details;
      (error as any).response = { data: errorData };
      throw error;
    }
    return response.json();
  },

  async getEnvironmentSessions(environmentId: string): Promise<{ sessions: Session[] }> {
    const makeRequest = async () => fetch(`${API_BASE}/sessions/environment/${environmentId}`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to get sessions');
    return response.json();
  },

  async getSession(sessionId: string): Promise<Session> {
    const makeRequest = async () => fetch(`${API_BASE}/sessions/${sessionId}`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to get session');
    return response.json();
  },

  async checkSessionStatus(sessionId: string): Promise<{
    sessionId: string;
    status: 'active' | 'inactive' | 'dead';
    isRealtime: boolean;
    checkedAt: string;
  }> {
    const makeRequest = async () => fetch(`${API_BASE}/sessions/${sessionId}/status`, {
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to check session status');
    return response.json();
  },

  async deleteSession(sessionId: string): Promise<void> {
    const makeRequest = async () => fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getHeaders(false),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
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
    const makeRequest = async () => fetch(`${API_BASE}/auth/github/initiate`, {
      method: 'POST',
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to initiate GitHub auth');
    const result = await response.json();
    return result.data;
  },

  async pollGitHubAuth(deviceCode: string, interval?: number): Promise<void> {
    console.log(`[API Client] Polling GitHub auth - deviceCode: ${deviceCode.substring(0, 8)}..., interval: ${interval}`);
    
    const response = await fetch(`${API_BASE}/auth/github/poll`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ deviceCode, interval }),
    });
    
    const result = await response.json();
    console.log('[API Client] Poll response:', {
      status: response.status,
      ok: response.ok,
      result: result
    });
    
    if (!response.ok) {
      console.log('[API Client] Response not OK, throwing error');
      throw new Error(result.error || 'Authentication failed');
    }
    
    // Check if the response indicates success
    if (result.success === false) {
      console.log(`[API Client] Success is false - pending: ${result.pending}, error: ${result.error}`);
      // If it's pending, throw a specific error that the polling logic can handle
      if (result.pending) {
        throw new Error(result.error || 'authorization_pending');
      }
      throw new Error(result.error || 'Authentication failed');
    }
    
    console.log('[API Client] Poll response indicates success!');
  },

  async disconnectGitHub(): Promise<void> {
    const makeRequest = async () => fetch(`${API_BASE}/auth/github/disconnect`, {
      method: 'DELETE',
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to disconnect GitHub');
  },

  async getGitHubStatus(): Promise<{ connected: boolean; username?: string }> {
    const makeRequest = async () => fetch(`${API_BASE}/auth/github/status`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to get GitHub status');
    const result = await response.json();
    return result.data;
  },

  async listGitHubRepos(params?: { page?: number; per_page?: number; sort?: string }): Promise<{
    repositories: Array<{
      id: number;
      name: string;
      full_name: string;
      description: string;
      html_url: string;
      clone_url: string;
      ssh_url: string;
      private: boolean;
      default_branch: string;
      updated_at: string;
      language: string;
      stargazers_count: number;
      open_issues_count: number;
    }>;
    page: number;
    per_page: number;
    total_count: number;
  }> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.per_page) queryParams.append('per_page', params.per_page.toString());
    if (params?.sort) queryParams.append('sort', params.sort);
    
    const makeRequest = async () => fetch(`${API_BASE}/auth/github/repos?${queryParams}`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) throw new Error('Failed to list GitHub repositories');
    const result = await response.json();
    return result.data;
  },

  // Git operations (now session-based)
  async gitCommit(sessionId: string, message: string, files?: string[]): Promise<any> {
    const makeRequest = async () => fetch(`${API_BASE}/git/commit/${sessionId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ message, files }),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to commit');
    }
    return response.json();
  },

  async gitPush(sessionId: string, remote = 'origin', branch?: string): Promise<any> {
    const makeRequest = async () => fetch(`${API_BASE}/git/push/${sessionId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ remote, branch }),
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
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
    const makeRequest = async () => fetch(`${API_BASE}/git/status/${sessionId}`, {
      headers: getHeaders(false), // No Content-Type since no body
    });
    
    const response = await handleApiResponse(await makeRequest(), makeRequest);
    
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
      headers: getHeaders(),
      body: JSON.stringify({ environmentId, appId, branch }),
    });
    
    if (!response.ok) throw new Error('Failed to deploy');
    return response.json();
  },

  // Agent management
  async createAgent(userId: string, name: string, type: 'claude-code' | 'gemini-cli' | 'qwen-coder', credential?: AgentCredential): Promise<Agent> {
    // Note: Keep signature backward compatible for existing callers; 'cursor-cli' will be passed through at runtime
    const response = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ userId, name, type, credential }),
    });
    
    if (!response.ok) throw new Error('Failed to create agent');
    return response.json();
  },

  async getUserAgents(userId: string): Promise<{ agents: Agent[] }> {
    const response = await fetch(`${API_BASE}/agents/user/${userId}`, {
      headers: getHeaders(false),
    });
    
    if (!response.ok) throw new Error('Failed to get agents');
    return response.json();
  },

  async getAgent(agentId: string): Promise<Agent> {
    const response = await fetch(`${API_BASE}/agents/${agentId}`, {
      headers: getHeaders(false),
    });
    
    if (!response.ok) throw new Error('Failed to get agent');
    return response.json();
  },

  async updateAgent(agentId: string, updates: { name?: string, credential?: AgentCredential }): Promise<Agent> {
    const response = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(updates),
    });
    
    if (!response.ok) throw new Error('Failed to update agent');
    return response.json();
  },

  async deleteAgent(agentId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'DELETE',
      headers: getHeaders(false),
    });
    
    if (!response.ok) throw new Error('Failed to delete agent');
  },

  // Legacy container methods (for backward compatibility during transition)
  async listContainers(userId?: string): Promise<{ containers: Container[] }> {
    const params = userId ? `?userId=${userId}` : '';
    const response = await fetch(`${API_BASE}/containers/list${params}`, {
      headers: getHeaders(false),
    });
    
    if (!response.ok) throw new Error('Failed to list containers');
    return response.json();
  },

  async deleteContainer(containerId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/containers/${containerId}`, {
      method: 'DELETE',
      headers: getHeaders(false),
    });
    
    if (!response.ok) throw new Error('Failed to delete container');
  },
};