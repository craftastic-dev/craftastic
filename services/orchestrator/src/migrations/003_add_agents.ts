import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Create agents table
  await db.schema
    .createTable('agents')
    .addColumn('id', 'uuid', (col) => 
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('type', 'varchar(50)', (col) => col.notNull()) // claude-code, gemini-cli, qwen-coder
    .addColumn('created_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updated_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  // Create agent_credentials table
  await db.schema
    .createTable('agent_credentials')
    .addColumn('id', 'uuid', (col) => 
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('agent_id', 'uuid', (col) => 
      col.references('agents.id').onDelete('cascade').notNull()
    )
    .addColumn('credential_type', 'varchar(50)', (col) => col.notNull()) // api_token, oauth
    .addColumn('encrypted_data', 'text', (col) => col.notNull()) // encrypted JSON blob
    .addColumn('created_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updated_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  // Add agent_id column to sessions table to support agent sessions
  await db.schema
    .alterTable('sessions')
    .addColumn('agent_id', 'uuid', (col) => 
      col.references('agents.id').onDelete('set null')
    )
    .addColumn('session_type', 'varchar(50)', (col) => 
      col.defaultTo('terminal') // 'terminal' or 'agent'
    )
    .execute();

  // Create indexes
  await db.schema
    .createIndex('idx_agents_user_id')
    .on('agents')
    .column('user_id')
    .execute();

  await db.schema
    .createIndex('idx_agents_type')
    .on('agents')
    .column('type')
    .execute();

  await db.schema
    .createIndex('idx_agent_credentials_agent_id')
    .on('agent_credentials')
    .column('agent_id')
    .execute();

  await db.schema
    .createIndex('idx_sessions_agent_id')
    .on('sessions')
    .column('agent_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Remove columns from sessions table
  await db.schema
    .alterTable('sessions')
    .dropColumn('agent_id')
    .dropColumn('session_type')
    .execute();

  // Drop tables in reverse order
  await db.schema.dropTable('agent_credentials').execute();
  await db.schema.dropTable('agents').execute();
}