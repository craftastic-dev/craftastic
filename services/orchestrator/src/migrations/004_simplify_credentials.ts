import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Drop the old agent_credentials table
  await db.schema.dropTable('agent_credentials').execute();

  // Create new simplified agent_credentials table
  await db.schema
    .createTable('agent_credentials')
    .addColumn('id', 'uuid', (col) => 
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('agent_id', 'uuid', (col) => 
      col.references('agents.id').onDelete('cascade').notNull()
    )
    .addColumn('type', 'varchar(50)', (col) => col.notNull()) // oauth, anthropic_api_key, etc.
    .addColumn('encrypted_value', 'text', (col) => col.notNull()) // encrypted credential value
    .addColumn('created_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updated_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();

  // Create indexes
  await db.schema
    .createIndex('idx_agent_credentials_agent_id_new')
    .on('agent_credentials')
    .column('agent_id')
    .execute();

  await db.schema
    .createIndex('idx_agent_credentials_type')
    .on('agent_credentials')
    .column('type')
    .execute();

  // Create unique constraint for agent_id (one credential per agent)
  await db.schema
    .createIndex('idx_agent_credentials_unique')
    .unique()
    .on('agent_credentials')
    .column('agent_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Drop the new table
  await db.schema.dropTable('agent_credentials').execute();

  // Recreate the old table structure
  await db.schema
    .createTable('agent_credentials')
    .addColumn('id', 'uuid', (col) => 
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('agent_id', 'uuid', (col) => 
      col.references('agents.id').onDelete('cascade').notNull()
    )
    .addColumn('credential_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('encrypted_data', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .addColumn('updated_at', 'timestamp', (col) => 
      col.defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute();
}