// Database table types for Kysely
export interface Database {
  environments: EnvironmentTable;
  sessions: SessionTable;
  deployments: DeploymentTable;
}

export interface EnvironmentTable {
  id: string;
  user_id: string;
  name: string;
  repository_url: string | null;
  branch: string;
  container_id: string | null;
  status: 'running' | 'stopped' | 'starting' | 'error';
  created_at: Date;
  updated_at: Date;
}

export interface SessionTable {
  id: string;
  environment_id: string;
  name: string | null;
  tmux_session_name: string;
  working_directory: string;
  status: 'active' | 'inactive' | 'dead';
  created_at: Date;
  updated_at: Date;
  last_activity: Date | null;
}

export interface DeploymentTable {
  id: string;
  environment_id: string;
  app_id: string;
  status: string;
  created_at: Date;
  metadata: any; // JSONB
}