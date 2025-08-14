export declare const ensureValidToken: () => Promise<boolean>;
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
    type: string;
    value: string;
}
export interface Container {
    Id: string;
    Names: string[];
    Status: string;
    Labels: Record<string, string>;
}
export declare const api: {
    createEnvironment(userId: string, name: string, repositoryUrl?: string, branch?: string): Promise<Environment>;
    getUserEnvironments(userId: string): Promise<{
        environments: Environment[];
    }>;
    getEnvironment(environmentId: string): Promise<Environment>;
    deleteEnvironment(environmentId: string): Promise<void>;
    checkEnvironmentName(userId: string, name: string): Promise<{
        available: boolean;
        name: string;
        suggestions: string[];
        message: string;
    }>;
    checkSessionName(environmentId: string, name: string): Promise<{
        available: boolean;
        name: string;
        message: string;
        existingSession?: {
            id: string;
            name: string;
            createdAt: string;
        };
    }>;
    checkBranchAvailability(environmentId: string, branch: string): Promise<{
        available: boolean;
        branch: string;
        message: string;
        existingSession?: {
            id: string;
            name: string;
            branch: string;
            createdAt: string;
        };
    }>;
    createSession(environmentId: string, name?: string, branch?: string, workingDirectory?: string, sessionType?: "terminal" | "agent", agentId?: string): Promise<Session>;
    getEnvironmentSessions(environmentId: string): Promise<{
        sessions: Session[];
    }>;
    getSession(sessionId: string): Promise<Session>;
    checkSessionStatus(sessionId: string): Promise<{
        sessionId: string;
        status: "active" | "inactive" | "dead";
        isRealtime: boolean;
        checkedAt: string;
    }>;
    deleteSession(sessionId: string): Promise<void>;
    initiateGitHubAuth(): Promise<{
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
    }>;
    pollGitHubAuth(deviceCode: string, interval?: number): Promise<void>;
    disconnectGitHub(): Promise<void>;
    getGitHubStatus(): Promise<{
        connected: boolean;
        username?: string;
    }>;
    listGitHubRepos(params?: {
        page?: number;
        per_page?: number;
        sort?: string;
    }): Promise<{
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
    }>;
    gitCommit(sessionId: string, message: string, files?: string[]): Promise<any>;
    gitPush(sessionId: string, remote?: string, branch?: string): Promise<any>;
    gitStatus(sessionId: string): Promise<{
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
    }>;
    gitDiff(sessionId: string, file?: string, staged?: boolean): Promise<{
        diff: string;
        file: string | null;
        staged: boolean;
    }>;
    gitLog(sessionId: string, limit?: number, offset?: number): Promise<{
        commits: Array<{
            hash: string;
            author: string;
            email: string;
            date: string;
            message: string;
        }>;
        limit: number;
        offset: number;
    }>;
    getRepositoryInfo(environmentId: string): Promise<{
        path: string;
        branches: string[];
        currentBranch: string;
        remoteUrl: string;
    }>;
    deploy(environmentId: string, appId: string, branch?: string): Promise<any>;
    createAgent(userId: string, name: string, type: "claude-code" | "gemini-cli" | "qwen-coder", credential?: AgentCredential): Promise<Agent>;
    startAgentSetup(agentId: string, environmentId: string): Promise<{
        sessionId: string;
        containerHome: string;
    }>;
    ingestAgentCredentials(agentId: string, token?: string): Promise<void>;
    getUserAgents(userId: string): Promise<{
        agents: Agent[];
    }>;
    getAgent(agentId: string): Promise<Agent>;
    updateAgent(agentId: string, updates: {
        name?: string;
        credential?: AgentCredential;
    }): Promise<Agent>;
    deleteAgent(agentId: string): Promise<void>;
    listContainers(userId?: string): Promise<{
        containers: Container[];
    }>;
    deleteContainer(containerId: string): Promise<void>;
};
//# sourceMappingURL=client.d.ts.map