import { config } from '../config';
import { setupDatabase } from '../lib/database';
import { getDatabase } from '../lib/kysely';

async function clearUsers() {
  console.log('🗑️  Clearing all users from database...');
  
  try {
    // Setup database connection first
    await setupDatabase();
    const db = getDatabase();
    
    // First, delete all refresh tokens (foreign key dependency)
    const refreshTokensDeleted = await db
      .deleteFrom('refresh_tokens')
      .execute();
    console.log(`✅ Deleted ${refreshTokensDeleted.length} refresh tokens`);
    
    // Delete all environments (this will cascade to sessions)
    const environmentsDeleted = await db
      .deleteFrom('environments')
      .execute();
    console.log(`✅ Deleted ${environmentsDeleted.length} environments`);
    
    // Delete all agents
    const agentsDeleted = await db
      .deleteFrom('agents')
      .execute();
    console.log(`✅ Deleted ${agentsDeleted.length} agents`);
    
    // Finally, delete all users
    const usersDeleted = await db
      .deleteFrom('users')
      .execute();
    console.log(`✅ Deleted ${usersDeleted.length} users`);
    
    console.log('🎉 Database cleared successfully! You can now register fresh users.');
    
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

clearUsers();