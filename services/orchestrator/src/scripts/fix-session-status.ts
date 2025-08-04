#!/usr/bin/env tsx

import { createDatabase } from '../lib/kysely';

async function fixSessionStatus() {
  const db = createDatabase();
  
  console.log('🔧 Fixing session status based on real tmux state\n');
  
  // Update niall68 to active (has 1 client)
  await db
    .updateTable('sessions')
    .set({ 
      status: 'active',
      last_activity: new Date(),
      updated_at: new Date()
    })
    .where('id', '=', '65c1dc02-52e3-40d3-bdb8-f18354e92364')
    .execute();
  
  console.log('✅ Updated niall68 session to active');
  
  // Update niall69 to active (has 1 client)  
  await db
    .updateTable('sessions')
    .set({ 
      status: 'active',
      last_activity: new Date(),
      updated_at: new Date()
    })
    .where('id', '=', '57745f2f-0e1c-4d77-b829-f6aa3eca8998')
    .execute();
    
  console.log('✅ Updated niall69 session to active');
  
  console.log('\n🎉 Both sessions should now show green dots (active)');
}

fixSessionStatus().catch(console.error);