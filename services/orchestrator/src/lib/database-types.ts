import { Generated } from 'kysely';

// Database table types for Kysely
export interface Database {
  users: UserTable;
  environments: EnvironmentTable;
  sessions: SessionTable;
  deployments: DeploymentTable;
  github_repositories: GitHubRepositoryTable;
  git_operations: GitOperationTable;
  user_agent_configs: UserAgentConfigTable;
  environment_agent_configs: EnvironmentAgentConfigTable;
  session_credentials: SessionCredentialTable;
  agents: AgentTable;
  agent_credentials: AgentCredentialTable;
  refresh_tokens: RefreshTokenTable;
}

export interface UserTable {
  id: Generated<string>;
  email: string | null;
  name: string;
  password_hash: string | null;
  email_verified: boolean;
  email_verification_token: string | null;
  password_reset_token: string | null;
  password_reset_expires: Date | null;
  last_login_at: Date | null;
  github_access_token: string | null;
  github_refresh_token: string | null;
  github_username: string | null;
  github_token_expires_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EnvironmentTable {
  id: Generated<string>;
  user_id: string; // UUID but Kysely treats as string
  name: string;
  repository_url: string | null;
  branch: string;
  container_id: string | null;
  status: 'running' | 'stopped' | 'starting' | 'error';
  github_repository_id: string | null;
  git_clone_path: string | null;
  default_branch: string;
  use_ssh_clone: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionTable {
  id: Generated<string>;
  environment_id: string;
  name: string | null;
  tmux_session_name: string;
  working_directory: string;
  status: 'active' | 'inactive' | 'dead';
  worktree_path: string | null;
  git_branch: string | null;
  is_feature_branch: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  last_activity: Date | null;
  agent_id: string | null;
  session_type: 'terminal' | 'agent';
}

export interface DeploymentTable {
  id: Generated<string>;
  environment_id: string;
  app_id: string;
  status: string;
  created_at: Generated<Date>;
  metadata: any; // JSONB
}

export interface AgentTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  type: 'claude-code' | 'gemini-cli' | 'qwen-coder';
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AgentCredentialTable {
  id: Generated<string>;
  agent_id: string; // unique constraint - one credential per agent
  type: string; // oauth, anthropic_api_key, gemini_api_key, etc.
  encrypted_value: string; // encrypted credential value (could be JSON string or simple string)
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GitHubRepositoryTable {
  id: Generated<number>;
  user_id: string; // UUID but Kysely treats as string
  github_id: bigint;
  name: string | null;
  full_name: string | null;
  private: boolean | null;
  default_branch: string | null;
  clone_url: string | null;
  ssh_url: string | null;
  updated_at: Date | null;
  cached_at: Generated<Date>;
}

export interface GitOperationTable {
  id: Generated<number>;
  session_id: string;
  operation_type: string;
  status: string;
  metadata: any; // JSONB
  error_message: string | null;
  created_at: Generated<Date>;
}

export interface UserAgentConfigTable {
  id: Generated<number>;
  user_id: string;
  agent_type: string;
  config_type: string;
  encrypted_value: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EnvironmentAgentConfigTable {
  id: Generated<number>;
  environment_id: string;
  agent_type: string;
  config_type: string;
  encrypted_value: string;
  created_at: Generated<Date>;
}

export interface SessionCredentialTable {
  id: Generated<number>;
  session_id: string;
  credential_type: string;
  credential_name: string;
  injected_at: Generated<Date>;
}

export interface RefreshTokenTable {
  id: Generated<string>;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Generated<Date>;
  revoked: boolean;
  user_agent: string | null;
  ip_address: string | null;
}