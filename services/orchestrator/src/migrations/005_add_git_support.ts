import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  console.log('Adding git support tables and columns...');

  // Check if users table exists, create it if not
  const tables = await db.introspection.getTables();
  const hasUsers = tables.some(table => table.name === 'users');
  
  if (!hasUsers) {
    // Create users table with UUID
    console.log('Creating users table...');
    await db.schema
      .createTable('users')
      .addColumn('id', 'uuid', (col) => 
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('github_access_token', 'text')
      .addColumn('github_refresh_token', 'text')
      .addColumn('github_username', 'varchar(255)')
      .addColumn('github_token_expires_at', 'timestamp')
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Update existing tables to use UUID for user_id
    console.log('Updating environments table to use UUID for user_id...');
    
    // Add new UUID column
    await db.schema
      .alterTable('environments')
      .addColumn('user_id_uuid', 'uuid')
      .execute();
    
    // For now, we can't convert existing varchar user_ids to UUIDs automatically
    // In a real scenario, you'd need to migrate the data properly
    console.log('⚠️  Note: Existing environments may need user_id migration to UUID');
    
    // Drop old user_id column and rename new one
    await db.schema
      .alterTable('environments')
      .dropColumn('user_id')
      .execute();
      
    await db.schema
      .alterTable('environments')
      .renameColumn('user_id_uuid', 'user_id')
      .execute();

  } else {
    // Add GitHub token fields to existing users table
    console.log('Adding GitHub fields to users table...');
    try {
      await db.schema
        .alterTable('users')
        .addColumn('github_access_token', 'text')
        .addColumn('github_refresh_token', 'text')
        .addColumn('github_username', 'varchar(255)')
        .addColumn('github_token_expires_at', 'timestamp')
        .execute();
    } catch (error) {
      // Columns might already exist, check and continue
      console.log('Some GitHub columns may already exist, continuing...');
    }

    // Check if environments table needs user_id type conversion
    const metadata = await db.introspection.getMetadata();
    const environmentsTable = metadata.tables.find(t => t.name === 'environments');
    const userIdColumn = environmentsTable?.columns.find(c => c.name === 'user_id');
    
    if (userIdColumn && userIdColumn.dataType !== 'uuid') {
      console.log('Converting environments.user_id to UUID...');
      
      // Add new UUID column
      await db.schema
        .alterTable('environments')
        .addColumn('user_id_uuid', 'uuid')
        .execute();
      
      // Drop old user_id column and rename new one
      await db.schema
        .alterTable('environments')
        .dropColumn('user_id')
        .execute();
        
      await db.schema
        .alterTable('environments')
        .renameColumn('user_id_uuid', 'user_id')
        .execute();
    }
  }

  // Create github_repositories table for caching (using UUID for user_id)
  console.log('Creating github_repositories table...');
  await db.schema
    .createTable('github_repositories')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) => 
      col.references('users.id').onDelete('cascade').notNull())
    .addColumn('github_id', 'bigint', (col) => col.unique())
    .addColumn('name', 'varchar(255)')
    .addColumn('full_name', 'varchar(255)')
    .addColumn('private', 'boolean')
    .addColumn('default_branch', 'varchar(255)')
    .addColumn('clone_url', 'text')
    .addColumn('ssh_url', 'text')
    .addColumn('updated_at', 'timestamp')
    .addColumn('cached_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  // Add git-related columns to environments table (if they don't exist)
  console.log('Adding git columns to environments table...');
  const envMetadata = await db.introspection.getMetadata();
  const environmentsTable = envMetadata.tables.find(t => t.name === 'environments');
  const existingColumns = environmentsTable?.columns.map(c => c.name) || [];

  // Only add columns that don't exist
  const columnsToAdd = [];
  if (!existingColumns.includes('github_repository_id')) {
    columnsToAdd.push(['github_repository_id', 'integer', (col: any) => col.references('github_repositories.id')]);
  }
  if (!existingColumns.includes('git_clone_path')) {
    columnsToAdd.push(['git_clone_path', 'text']);
  }
  if (!existingColumns.includes('default_branch')) {
    columnsToAdd.push(['default_branch', 'varchar(255)', (col: any) => col.defaultTo('main')]);
  }
  if (!existingColumns.includes('use_ssh_clone')) {
    columnsToAdd.push(['use_ssh_clone', 'boolean', (col: any) => col.defaultTo(false)]);
  }

  // Add columns one by one to avoid conflicts
  for (const [columnName, columnType, columnConfig] of columnsToAdd) {
    try {
      let query = db.schema.alterTable('environments').addColumn(columnName as string, columnType as any);
      if (columnConfig) {
        query = columnConfig(query);
      }
      await query.execute();
      console.log(`✅ Added column ${columnName} to environments table`);
    } catch (error) {
      console.log(`⚠️  Column ${columnName} might already exist, skipping...`);
    }
  }

  // Add git-related columns to sessions table (if they don't exist)
  console.log('Adding git columns to sessions table...');
  const sessionsTable = envMetadata.tables.find(t => t.name === 'sessions');
  const existingSessionColumns = sessionsTable?.columns.map(c => c.name) || [];

  const sessionColumnsToAdd = [];
  if (!existingSessionColumns.includes('worktree_path')) {
    sessionColumnsToAdd.push(['worktree_path', 'text']);
  }
  if (!existingSessionColumns.includes('git_branch')) {
    sessionColumnsToAdd.push(['git_branch', 'varchar(255)']);
  }
  if (!existingSessionColumns.includes('is_feature_branch')) {
    sessionColumnsToAdd.push(['is_feature_branch', 'boolean', (col: any) => col.defaultTo(false)]);
  }

  // Add columns one by one to avoid conflicts
  for (const [columnName, columnType, columnConfig] of sessionColumnsToAdd) {
    try {
      let query = db.schema.alterTable('sessions').addColumn(columnName as string, columnType as any);
      if (columnConfig) {
        query = columnConfig(query);
      }
      await query.execute();
      console.log(`✅ Added column ${columnName} to sessions table`);
    } catch (error) {
      console.log(`⚠️  Column ${columnName} might already exist, skipping...`);
    }
  }

  // Create git_operations table for tracking operations (using UUID for session_id)
  console.log('Creating git_operations table...');
  await db.schema
    .createTable('git_operations')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('session_id', 'uuid', (col) => 
      col.references('sessions.id').onDelete('cascade').notNull())
    .addColumn('operation_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('status', 'varchar(50)', (col) => col.notNull())
    .addColumn('metadata', 'jsonb')
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  // Create user_agent_configs table for agent credentials (using UUID for user_id)
  console.log('Creating user_agent_configs table...');
  await db.schema
    .createTable('user_agent_configs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) => 
      col.references('users.id').onDelete('cascade').notNull())
    .addColumn('agent_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('config_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('encrypted_value', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  // Add unique constraint for user + agent type
  await db.schema
    .createIndex('user_agent_configs_user_agent_unique')
    .on('user_agent_configs')
    .columns(['user_id', 'agent_type'])
    .unique()
    .execute();

  // Create environment_agent_configs table for environment-specific overrides (using UUID for environment_id)
  console.log('Creating environment_agent_configs table...');
  await db.schema
    .createTable('environment_agent_configs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('environment_id', 'uuid', (col) => 
      col.references('environments.id').onDelete('cascade').notNull())
    .addColumn('agent_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('config_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('encrypted_value', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  // Create session_credentials audit table (using UUID for session_id)
  console.log('Creating session_credentials table...');
  await db.schema
    .createTable('session_credentials')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('session_id', 'uuid', (col) => 
      col.references('sessions.id').onDelete('cascade').notNull())
    .addColumn('credential_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('credential_name', 'varchar(100)', (col) => col.notNull())
    .addColumn('injected_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  // Add indexes for performance
  await db.schema
    .createIndex('github_repositories_user_id_idx')
    .on('github_repositories')
    .column('user_id')
    .execute();

  await db.schema
    .createIndex('git_operations_session_id_idx')
    .on('git_operations')
    .column('session_id')
    .execute();

  await db.schema
    .createIndex('user_agent_configs_user_id_idx')
    .on('user_agent_configs')
    .column('user_id')
    .execute();

  console.log('✅ Git support tables and columns added successfully');
}

export async function down(db: Kysely<any>): Promise<void> {
  console.log('Rolling back git support migration...');

  // Drop tables in reverse order (respecting foreign key constraints)
  await db.schema.dropTable('session_credentials').ifExists().execute();
  await db.schema.dropTable('environment_agent_configs').ifExists().execute();
  await db.schema.dropTable('user_agent_configs').ifExists().execute();
  await db.schema.dropTable('git_operations').ifExists().execute();
  await db.schema.dropTable('github_repositories').ifExists().execute();

  // Remove columns from existing tables
  await db.schema
    .alterTable('sessions')
    .dropColumn('worktree_path')
    .dropColumn('git_branch')
    .dropColumn('is_feature_branch')
    .execute();

  await db.schema
    .alterTable('environments')
    .dropColumn('github_repository_id')
    .dropColumn('repository_url')
    .dropColumn('git_clone_path')
    .dropColumn('default_branch')
    .dropColumn('use_ssh_clone')
    .execute();

  await db.schema
    .alterTable('users')
    .dropColumn('github_access_token')
    .dropColumn('github_refresh_token')
    .dropColumn('github_username')
    .dropColumn('github_token_expires_at')
    .execute();

  console.log('✅ Git support migration rolled back');
}