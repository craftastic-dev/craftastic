#!/usr/bin/env tsx

import { promises as fs } from 'fs';
import * as path from 'path';

async function main() {
  const migrationName = process.argv[2];
  
  if (!migrationName) {
    console.error('Usage: npm run migrate:create <migration_name>');
    console.error('Example: npm run migrate:create add_user_email_column');
    process.exit(1);
  }

  // Generate timestamp
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  
  // Create migration file name
  const fileName = `${timestamp}_${migrationName}.ts`;
  const migrationPath = path.join(__dirname, '../migrations', fileName);

  const template = `import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // TODO: Implement your migration here
  // Example:
  // await db.schema
  //   .alterTable('environments')
  //   .addColumn('new_column', 'varchar(255)')
  //   .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // TODO: Implement rollback here
  // Example:
  // await db.schema
  //   .alterTable('environments')
  //   .dropColumn('new_column')
  //   .execute();
}
`;

  await fs.writeFile(migrationPath, template);
  console.log(`✅ Created migration: ${fileName}`);
  console.log(`📝 Edit the file at: ${migrationPath}`);
}

main();