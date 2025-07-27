import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Check if environments table exists
  const environmentsExists = await db.introspection.getTables();
  const hasEnvironments = environmentsExists.some(table => table.name === 'environments');
  
  if (!hasEnvironments) {
    // Create environments table
    await db.schema
      .createTable('environments')
      .addColumn('id', 'uuid', (col) => 
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('user_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('repository_url', 'text')
      .addColumn('branch', 'varchar(255)', (col) => col.defaultTo('main'))
      .addColumn('container_id', 'varchar(255)')
      .addColumn('status', 'varchar(50)', (col) => col.defaultTo('stopped'))
      .addColumn('created_at', 'timestamp', (col) => 
        col.defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('updated_at', 'timestamp', (col) => 
        col.defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .execute();
  }

  // Check if sessions table needs to be migrated or created
  const hasSessions = environmentsExists.some(table => table.name === 'sessions');
  
  if (hasSessions) {
    // Check if sessions table has the new schema
    const sessionColumns = await db.introspection.getMetadata({ withInternalKyselyTables: false });
    const sessionsTable = sessionColumns.tables.find(table => table.name === 'sessions');
    const hasEnvironmentId = sessionsTable?.columns.some(col => col.name === 'environment_id');
    
    if (!hasEnvironmentId) {
      // Need to migrate sessions table
      console.log('Migrating sessions table schema...');
      
      // Backup existing sessions
      await db.schema
        .createTable('sessions_backup')
        .as(db.selectFrom('sessions').selectAll())
        .execute();
      
      // Drop old sessions table
      await db.schema.dropTable('sessions').cascade().execute();
      
      // Create new sessions table
      await db.schema
        .createTable('sessions')
        .addColumn('id', 'uuid', (col) => 
          col.primaryKey().defaultTo(sql`gen_random_uuid()`)
        )
        .addColumn('environment_id', 'uuid', (col) => 
          col.references('environments.id').onDelete('cascade').notNull()
        )
        .addColumn('name', 'varchar(255)')
        .addColumn('tmux_session_name', 'varchar(255)', (col) => col.notNull())
        .addColumn('working_directory', 'varchar(500)', (col) => 
          col.defaultTo('/workspace')
        )
        .addColumn('status', 'varchar(50)', (col) => col.defaultTo('inactive'))
        .addColumn('created_at', 'timestamp', (col) => 
          col.defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('updated_at', 'timestamp', (col) => 
          col.defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('last_activity', 'timestamp')
        .execute();
    }
  } else {
    // Create new sessions table
    await db.schema
      .createTable('sessions')
      .addColumn('id', 'uuid', (col) => 
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('environment_id', 'uuid', (col) => 
        col.references('environments.id').onDelete('cascade').notNull()
      )
      .addColumn('name', 'varchar(255)')
      .addColumn('tmux_session_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('working_directory', 'varchar(500)', (col) => 
        col.defaultTo('/workspace')
      )
      .addColumn('status', 'varchar(50)', (col) => col.defaultTo('inactive'))
      .addColumn('created_at', 'timestamp', (col) => 
        col.defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('updated_at', 'timestamp', (col) => 
        col.defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('last_activity', 'timestamp')
      .execute();
  }

  // Create deployments table if it doesn't exist
  const hasDeployments = environmentsExists.some(table => table.name === 'deployments');
  
  if (!hasDeployments) {
    await db.schema
      .createTable('deployments')
      .addColumn('id', 'uuid', (col) => 
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('environment_id', 'uuid', (col) => 
        col.references('environments.id').onDelete('cascade').notNull()
      )
      .addColumn('app_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('status', 'varchar(50)', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) => 
        col.defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('metadata', 'jsonb')
      .execute();
  }

  // Create indexes if they don't exist
  try {
    await db.schema
      .createIndex('idx_environments_user_id')
      .ifNotExists()
      .on('environments')
      .column('user_id')
      .execute();
  } catch (error) {
    // Index might already exist, ignore
  }

  try {
    await db.schema
      .createIndex('idx_sessions_environment_id')
      .ifNotExists()
      .on('sessions')
      .column('environment_id')
      .execute();
  } catch (error) {
    // Index might already exist, ignore
  }

  try {
    await db.schema
      .createIndex('idx_sessions_tmux_name')
      .ifNotExists()
      .on('sessions')
      .column('tmux_session_name')
      .execute();
  } catch (error) {
    // Index might already exist, ignore
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('deployments').execute();
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('environments').execute();
}