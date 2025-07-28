import { beforeAll, afterAll } from 'vitest';
import { setupDatabase } from '../src/lib/database';
import { createDatabase } from '../src/lib/kysely';

beforeAll(async () => {
  // Initialize database connection for tests
  await setupDatabase();
});

afterAll(async () => {
  // Clean up database connections
  const db = createDatabase();
  // Note: We don't close the connection as it might be shared
  // In a real CI environment, you might want to use a separate test database
});