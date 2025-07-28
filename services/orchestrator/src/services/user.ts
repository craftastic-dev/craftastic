import { getDatabase } from '../lib/kysely';
import { sql } from 'kysely';

/**
 * Service to handle user ID resolution and creation
 * Handles both legacy user-{timestamp} format and UUID format
 */
export class UserService {
  /**
   * Get or create a user from a legacy user ID or UUID
   * @param userIdOrLegacyId Either a UUID or legacy format like "user-1234567890"
   * @returns UUID of the user
   */
  async resolveUserId(userIdOrLegacyId: string): Promise<string> {
    // Check if it's already a UUID
    if (this.isUUID(userIdOrLegacyId)) {
      // Check if user exists
      const existingUser = await getDatabase()
        .selectFrom('users')
        .select('id')
        .where('id', '=', userIdOrLegacyId)
        .executeTakeFirst();
      
      if (existingUser) {
        return existingUser.id;
      }
      
      // UUID format but user doesn't exist, create it
      const newUser = await getDatabase()
        .insertInto('users')
        .values({
          id: userIdOrLegacyId,
          email: `${userIdOrLegacyId}@example.com`,
          name: `User ${userIdOrLegacyId.substring(0, 8)}`,
        })
        .returning('id')
        .executeTakeFirst();
      
      return newUser!.id;
    }

    // Legacy format, check if we have a mapping
    const existingUser = await getDatabase()
      .selectFrom('users')
      .select('id')
      .where('email', '=', `${userIdOrLegacyId}@example.com`)
      .executeTakeFirst();

    if (existingUser) {
      return existingUser.id;
    }

    // Create new user with UUID
    const newUser = await getDatabase()
      .insertInto('users')
      .values({
        id: sql`gen_random_uuid()`,
        email: `${userIdOrLegacyId}@example.com`,
        name: `User ${userIdOrLegacyId}`,
      })
      .returning('id')
      .executeTakeFirst();

    console.log(`✅ Created new user ${newUser!.id} for legacy ID ${userIdOrLegacyId}`);
    return newUser!.id;
  }

  /**
   * Check if a string is a valid UUID format
   */
  private isUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  /**
   * Get user information by UUID
   */
  async getUserById(userId: string): Promise<{
    id: string;
    email: string;
    name: string;
    github_username: string | null;
  } | null> {
    return await getDatabase()
      .selectFrom('users')
      .select(['id', 'email', 'name', 'github_username'])
      .where('id', '=', userId)
      .executeTakeFirst() || null;
  }
}

// Export singleton instance
export const userService = new UserService();