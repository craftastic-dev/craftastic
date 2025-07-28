#!/usr/bin/env tsx

/**
 * Cleanup script to remove test environments and sessions
 * Run this if test data gets left behind from failed test runs
 */

import { setupDatabase } from '../src/lib/database';
import { getDatabase } from '../src/lib/kysely';
import { destroySandbox } from '../src/services/docker';

async function cleanupTestData() {
  console.log('🧹 Starting test data cleanup...');
  
  try {
    // Initialize database
    await setupDatabase();
    const db = getDatabase();

    // Find test environments (those created by tests)
    const testEnvironments = await db
      .selectFrom('environments')
      .select(['id', 'name', 'container_id', 'user_id'])
      .where((eb) => eb
        .or([
          eb('name', 'like', '%test%'),
          eb('name', '=', 'git-test-env')
        ])
      )
      .execute();

    console.log(`Found ${testEnvironments.length} test environments to clean up`);

    for (const env of testEnvironments) {
      console.log(`\n🧹 Cleaning up environment: ${env.name} (${env.id})`);
      
      // Clean up Docker container
      if (env.container_id) {
        try {
          await destroySandbox(env.container_id);
          console.log(`  🐳 Removed container: ${env.container_id}`);
        } catch (error) {
          console.warn(`  ⚠️  Failed to remove container ${env.container_id}:`, error.message);
        }
      }

      // Get sessions for this environment
      const sessions = await db
        .selectFrom('sessions')
        .select(['id', 'name'])
        .where('environment_id', '=', env.id)
        .execute();

      // Delete sessions
      if (sessions.length > 0) {
        await db
          .deleteFrom('sessions')
          .where('environment_id', '=', env.id)
          .execute();
        console.log(`  📱 Deleted ${sessions.length} sessions`);
      }

      // Delete environment
      await db
        .deleteFrom('environments')
        .where('id', '=', env.id)
        .execute();
      console.log(`  🏗️  Deleted environment`);
    }

    // Clean up test users (those with test emails)
    const testUsers = await db
      .selectFrom('users')
      .select(['id', 'email', 'name'])
      .where((eb) => eb
        .or([
          eb('email', 'like', '%test%'),
          eb('email', 'like', '%user-%@example.com')
        ])
      )
      .execute();

    if (testUsers.length > 0) {
      console.log(`\n👥 Found ${testUsers.length} test users to clean up`);
      
      for (const user of testUsers) {
        await db
          .deleteFrom('users')
          .where('id', '=', user.id)
          .execute();
        console.log(`  👤 Deleted user: ${user.email}`);
      }
    }

    console.log('\n✅ Test data cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Failed to cleanup test data:', error);
    process.exit(1);
  }
}

// Run cleanup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestData().catch(console.error);
}

export { cleanupTestData };