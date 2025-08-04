#!/usr/bin/env node
import { createDatabase, getDatabase } from '../lib/kysely';

async function main() {
  createDatabase();
  const db = getDatabase();
  
  console.log('Checking niall69 sessions in database...\n');
  
  const sessions = await db
    .selectFrom('sessions')
    .select(['id', 'name', 'tmux_session_name', 'status', 'created_at'])
    .where('name', '=', 'niall69')
    .orderBy('created_at', 'desc')
    .execute();
    
  console.log('Database sessions:');
  sessions.forEach(session => {
    console.log(`- ${session.tmux_session_name} (${session.status}) - created at ${session.created_at}`);
  });
  
  console.log(`\nTotal: ${sessions.length} sessions found`);
  process.exit(0);
}

main().catch(console.error);