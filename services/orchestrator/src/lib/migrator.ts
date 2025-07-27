import { Kysely, Migrator, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { config } from '../config';
import * as path from 'path';
import { promises as fs } from 'fs';

export interface Migration {
  up(db: Kysely<any>): Promise<void>;
  down(db: Kysely<any>): Promise<void>;
}

export async function createMigrator(): Promise<Migrator> {
  const db = new Kysely<any>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: config.DATABASE_URL,
      }),
    }),
  });

  // Load migrations from the migrations directory
  const migrationsPath = path.join(__dirname, '../migrations');
  const migrationFiles = await fs.readdir(migrationsPath);
  
  const migrations: Record<string, Migration> = {};
  
  for (const file of migrationFiles) {
    if (file.endsWith('.ts') || file.endsWith('.js')) {
      const migrationName = path.basename(file, path.extname(file));
      const migrationModule = await import(path.join(migrationsPath, file));
      migrations[migrationName] = migrationModule;
    }
  }

  return new Migrator({
    db,
    provider: {
      async getMigrations() {
        return migrations;
      },
    },
  });
}

export async function runMigrations(): Promise<void> {
  console.log('Running database migrations...');
  
  const migrator = await createMigrator();
  const { error, results } = await migrator.migrateToLatest();

  if (error) {
    console.error('Migration failed:', error);
    throw error;
  }

  if (results) {
    results.forEach((result) => {
      if (result.status === 'Success') {
        console.log(`✅ Migration "${result.migrationName}" executed successfully`);
      } else if (result.status === 'Error') {
        console.error(`❌ Migration "${result.migrationName}" failed:`, result.error);
      }
    });
  }

  console.log('✅ All migrations completed successfully');
}

export async function rollbackMigrations(steps: number = 1): Promise<void> {
  console.log(`Rolling back ${steps} migration(s)...`);
  
  const migrator = await createMigrator();
  
  for (let i = 0; i < steps; i++) {
    const { error, results } = await migrator.migrateDown();
    
    if (error) {
      console.error('Rollback failed:', error);
      throw error;
    }

    if (results) {
      results.forEach((result) => {
        if (result.status === 'Success') {
          console.log(`✅ Rollback "${result.migrationName}" executed successfully`);
        } else if (result.status === 'Error') {
          console.error(`❌ Rollback "${result.migrationName}" failed:`, result.error);
        }
      });
    }
  }

  console.log('✅ Rollback completed successfully');
}