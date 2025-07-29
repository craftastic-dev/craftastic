import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  console.log('Adding authentication fields to users table...');

  // Add password authentication fields to existing users table
  // The users table already has: id, email (unique), name, github_*, created_at, updated_at
  
  try {
    await db.schema
      .alterTable('users')
      .addColumn('password_hash', 'varchar(255)')
      .addColumn('email_verified', 'boolean', (col) => col.defaultTo(false))
      .addColumn('email_verification_token', 'varchar(255)')
      .addColumn('password_reset_token', 'varchar(255)')
      .addColumn('password_reset_expires', 'timestamp')
      .addColumn('last_login_at', 'timestamp')
      .execute();
    console.log('✅ Added authentication columns to users table');
  } catch (error) {
    if (error.message?.includes('already exists')) {
      console.log('⚠️  Some authentication columns already exist, continuing...');
    } else {
      throw error;
    }
  }

  // Create refresh_tokens table for JWT token management
  try {
    await db.schema
      .createTable('refresh_tokens')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade').notNull())
      .addColumn('token', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('expires_at', 'timestamp', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('revoked', 'boolean', (col) => col.defaultTo(false).notNull())
      .addColumn('user_agent', 'text')
      .addColumn('ip_address', 'varchar(45)')
      .execute();
      
    console.log('✅ Created refresh_tokens table');
  } catch (error) {
    if (error.message?.includes('already exists')) {
      console.log('⚠️  refresh_tokens table already exists, skipping');
    } else {
      throw error;
    }
  }

  // Create indexes for performance
  try {
    await db.schema
      .createIndex('refresh_tokens_user_id_idx')
      .on('refresh_tokens')
      .column('user_id')
      .execute();

    await db.schema
      .createIndex('refresh_tokens_token_idx')
      .on('refresh_tokens')
      .column('token')
      .execute();
      
    console.log('✅ Created refresh_tokens indexes');
  } catch (error) {
    console.log('⚠️  Some indexes might already exist, continuing...');
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // Drop refresh_tokens table
  await db.schema.dropTable('refresh_tokens').execute();

  // Remove authentication fields from users table
  await db.schema
    .alterTable('users')
    .dropConstraint('users_email_unique')
    .execute();

  await db.schema
    .alterTable('users')
    .dropColumn('email')
    .dropColumn('password_hash')
    .dropColumn('email_verified')
    .dropColumn('email_verification_token')
    .dropColumn('password_reset_token')
    .dropColumn('password_reset_expires')
    .dropColumn('last_login_at')
    .execute();
}