import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  console.log('Adding unique constraint for environment names per user...');
  
  // First, handle any existing duplicate environment names
  // Find duplicates and rename them by appending a number suffix
  const duplicates = await db
    .selectFrom('environments')
    .select(['user_id', 'name'])
    .select(sql<number>`count(*)`.as('count'))
    .groupBy(['user_id', 'name'])
    .having(sql<number>`count(*)`, '>', 1)
    .execute();

  console.log(`Found ${duplicates.length} duplicate environment names to resolve`);

  // For each duplicate group, rename all but the first (oldest) environment
  for (const duplicate of duplicates) {
    console.log(`Resolving duplicates for user ${duplicate.user_id}, name "${duplicate.name}"`);
    
    // Get all environments with this user_id and name, ordered by creation date
    const duplicateEnvs = await db
      .selectFrom('environments')
      .selectAll()
      .where('user_id', '=', duplicate.user_id)
      .where('name', '=', duplicate.name)
      .orderBy('created_at', 'asc')
      .execute();

    // Skip the first (oldest) environment, rename the rest
    for (let i = 1; i < duplicateEnvs.length; i++) {
      const env = duplicateEnvs[i];
      const newName = `${duplicate.name}-${i + 1}`;
      
      console.log(`Renaming environment ${env.id} from "${env.name}" to "${newName}"`);
      
      await db
        .updateTable('environments')
        .set({ name: newName, updated_at: new Date() })
        .where('id', '=', env.id)
        .execute();
    }
  }

  // Now add the unique constraint
  console.log('Adding unique constraint on (user_id, name)...');
  await db.schema
    .alterTable('environments')
    .addUniqueConstraint('environments_user_id_name_unique', ['user_id', 'name'])
    .execute();

  console.log('Unique constraint added successfully');
}

export async function down(db: Kysely<any>): Promise<void> {
  console.log('Removing unique constraint for environment names per user...');
  
  await db.schema
    .alterTable('environments')
    .dropConstraint('environments_user_id_name_unique')
    .execute();
    
  console.log('Unique constraint removed successfully');
}
