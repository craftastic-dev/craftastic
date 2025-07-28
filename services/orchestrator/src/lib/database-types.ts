import { Generated } from 'kysely';

// Database table types for Kysely
export interface Database {
  environments: EnvironmentTable;
  sessions: SessionTable;
  deployments: DeploymentTable;
  agents: AgentTable;
  agent_credentials: AgentCredentialTable;
}

export interface EnvironmentTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  repository_url: string | null;
  branch: string;
  container_id: string | null;
  status: 'running' | 'stopped' | 'starting' | 'error';
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