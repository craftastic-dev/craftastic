#!/usr/bin/env node
import { createDatabase, getDatabase } from '../lib/kysely';
import { cleanupStaleSessions, cleanupOrphanedTmuxSessions } from '../services/session-cleanup';

async function main() {
  createDatabase();
  const db = getDatabase();
  
  console.log('Running manual cleanup...\n');
  
  // Get stats before cleanup
  const beforeStats = await db
    .selectFrom('sessions')
    .select([
      db.fn.count<number>('id').as('total'),
      db.fn.sum<number>(db.case().when('status', '=', 'active').then(1).else(0).end()).as('active'),
      db.fn.sum<number>(db.case().when('status', '=', 'inactive').then(1).else(0).end()).as('inactive'),
      db.fn.sum<number>(db.case().when('status', '=', 'dead').then(1).else(0).end()).as('dead')
    ])
    .executeTakeFirst();
    
  console.log('Before cleanup:');
  console.log(`- Total sessions: ${beforeStats?.total || 0}`);
  console.log(`- Active: ${beforeStats?.active || 0}`);
  console.log(`- Inactive: ${beforeStats?.inactive || 0}`);
  console.log(`- Dead: ${beforeStats?.dead || 0}`);
  
  // Run cleanup
  await cleanupStaleSessions();
  
  // Get container IDs and clean up orphaned tmux sessions
  const environments = await db
    .selectFrom('environments')
    .select(['container_id'])
    .where('container_id', 'is not', null)
    .execute();
    
  for (const env of environments) {
    if (env.container_id) {
      console.log(`\nCleaning up orphaned tmux sessions in container ${env.container_id}...`);
      await cleanupOrphanedTmuxSessions(env.container_id);
    }
  }
  
  // Get stats after cleanup
  const afterStats = await db
    .selectFrom('sessions')
    .select([
      db.fn.count<number>('id').as('total'),
      db.fn.sum<number>(db.case().when('status', '=', 'active').then(1).else(0).end()).as('active'),
      db.fn.sum<number>(db.case().when('status', '=', 'inactive').then(1).else(0).end()).as('inactive'),
      db.fn.sum<number>(db.case().when('status', '=', 'dead').then(1).else(0).end()).as('dead')
    ])
    .executeTakeFirst();
    
  console.log('\nAfter cleanup:');
  console.log(`- Total sessions: ${afterStats?.total || 0}`);
  console.log(`- Active: ${afterStats?.active || 0}`);
  console.log(`- Inactive: ${afterStats?.inactive || 0}`);
  console.log(`- Dead: ${afterStats?.dead || 0}`);
  
  process.exit(0);
}

main().catch(console.error);