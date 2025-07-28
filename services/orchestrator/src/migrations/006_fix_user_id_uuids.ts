import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  console.log('Fixing user_id UUID conversion...');

  // First, let's see what data we have
  const environments = await db
    .selectFrom('environments')
    .select(['id', 'user_id'])
    .execute();

  console.log(`Found ${environments.length} environments to migrate`);

  // Create proper UUID users for each unique user_id
  const uniqueUserIds = [...new Set(environments.map(env => env.user_id))];
  console.log(`Found ${uniqueUserIds.length} unique user IDs: ${uniqueUserIds.join(', ')}`);

  // Create a mapping from old user_id to new UUID
  const userIdMapping = new Map<string, string>();

  for (const oldUserId of uniqueUserIds) {
    // Generate a new UUID for this user
    const result = await db
      .insertInto('users')
      .values({
        id: sql`gen_random_uuid()`,
        email: `${oldUserId}@example.com`,
        name: `User ${oldUserId}`,
      })
      .returning('id')
      .executeTakeFirst();

    if (result) {
      userIdMapping.set(oldUserId, result.id);
      console.log(`Created user UUID ${result.id} for old user_id ${oldUserId}`);
    }
  }

  // Now update all environments to use the new UUIDs
  for (const environment of environments) {
    const newUserId = userIdMapping.get(environment.user_id);
    if (newUserId) {
      await db
        .updateTable('environments')
        .set({ user_id: newUserId })
        .where('id', '=', environment.id)
        .execute();
      
      console.log(`Updated environment ${environment.id} to use UUID ${newUserId}`);
    }
  }

  console.log('✅ User ID UUID conversion completed');
}

export async function down(db: Kysely<any>): Promise<void> {
  console.log('⚠️  Cannot rollback user UUID conversion - would lose data');
  // This migration cannot be easily rolled back as it transforms data
}