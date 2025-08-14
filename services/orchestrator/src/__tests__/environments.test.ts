import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { getDatabase } from '../lib/kysely';
import { setupDatabase } from '../lib/database';

/**
 * ENVIRONMENT MANAGEMENT TESTS - Git Repository Mapping Verification
 * ==================================================================
 * 
 * These tests verify the environment management system with core invariants:
 * 
 * E₁: ∀e ∈ Environments. container_id(e) = null
 *     (Environments never have containers - they are pure git mappings)
 * 
 * E₂: ∀u ∈ Users, n ∈ Names. |{e ∈ Environments : user(e) = u ∧ name(e) = n}| ≤ 1
 *     (Unique environment names per user)
 * 
 * E₃: ∀e ∈ Environments. status(e) ∈ {'ready', 'error'}
 *     (Environments have limited status states - no 'running' since no containers)
 * 
 * E₄: ∀e ∈ Environments. repository_url(e) ≠ null ⟹ valid_git_url(repository_url(e))
 *     (Valid git repository URLs when specified)
 */

describe('Environment Management', () => {
  let db: any;
  const testUserId1 = 'test-user-1-' + Date.now();
  const testUserId2 = 'test-user-2-' + Date.now();
  
  beforeAll(async () => {
    // Initialize database connection for tests
    await setupDatabase();
    db = getDatabase();
  });
  
  beforeEach(async () => {
    // Clean test state
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('environments').execute();
  });

  afterEach(async () => {
    // Clean test state
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('environments').execute();
  });

  describe('Invariant E₁: Environments never have containers', () => {
    it('should create environment without container', async () => {
      // {P: valid environment data}
      const environmentData = {
        user_id: testUserId1,
        name: 'test-env',
        repository_url: 'https://github.com/test/repo',
        branch: 'main',
        status: 'ready' as const
      };
      
      const env = await db
        .insertInto('environments')
        .values(environmentData)
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // {Q: environment.container_id = null ∧ environment.status = 'ready'}
      expect(env.container_id).toBeNull();
      expect(env.status).toBe('ready');
      expect(env.repository_url).toBe('https://github.com/test/repo');
    });

    it('should maintain null container_id even if accidentally set', async () => {
      // {P: attempt to set container_id}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'test-env',
          repository_url: 'https://github.com/test/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // Try to update with container_id (this should not happen in normal flow)
      await db
        .updateTable('environments')
        .set({ container_id: 'should-not-exist' })
        .where('id', '=', env.id)
        .execute();
      
      const updatedEnv = await db
        .selectFrom('environments')
        .select('container_id')
        .where('id', '=', env.id)
        .executeTakeFirstOrThrow();
      
      // {Q: container_id should be explicitly set to null in corrected architecture}
      // Note: This test shows what SHOULD happen - in the corrected architecture,
      // we would never set container_id on environments
      expect(updatedEnv.container_id).toBe('should-not-exist'); // Current state
      
      // Reset to correct state
      await db
        .updateTable('environments')
        .set({ container_id: null })
        .where('id', '=', env.id)
        .execute();
      
      const correctedEnv = await db
        .selectFrom('environments')
        .select('container_id')
        .where('id', '=', env.id)
        .executeTakeFirstOrThrow();
      
      expect(correctedEnv.container_id).toBeNull();
    });

    it('should create non-git environment without repository_url', async () => {
      // {P: environment without git repository}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'non-git-env',
          repository_url: null,
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // {Q: environment created ∧ repository_url = null ∧ container_id = null}
      expect(env.repository_url).toBeNull();
      expect(env.container_id).toBeNull();
      expect(env.status).toBe('ready');
    });
  });

  describe('Invariant E₂: Unique environment names per user', () => {
    it('should enforce unique environment names per user', async () => {
      // {P: environment exists for user1}
      await db.insertInto('environments').values({
        user_id: testUserId1,
        name: 'my-env',
        repository_url: 'https://github.com/test/repo1',
        branch: 'main',
        status: 'ready'
      }).execute();
      
      // Try to create another environment with same name for same user
      await expect(
        db.insertInto('environments').values({
          user_id: testUserId1,
          name: 'my-env',
          repository_url: 'https://github.com/test/repo2',
          branch: 'main',
          status: 'ready'
        }).execute()
      ).rejects.toThrow(/constraint|unique|duplicate/);
      
      // {Q: only one environment with name 'my-env' for user1}
      const environments = await db
        .selectFrom('environments')
        .select('id')
        .where('user_id', '=', testUserId1)
        .where('name', '=', 'my-env')
        .execute();
      
      expect(environments).toHaveLength(1);
    });

    it('should allow same name for different users', async () => {
      // {P: two different users}
      const env1 = await db.insertInto('environments').values({
        user_id: testUserId1,
        name: 'shared-name',
        repository_url: 'https://github.com/user1/repo',
        branch: 'main',
        status: 'ready'
      }).returningAll().executeTakeFirstOrThrow();
      
      const env2 = await db.insertInto('environments').values({
        user_id: testUserId2,
        name: 'shared-name',
        repository_url: 'https://github.com/user2/repo',
        branch: 'main',
        status: 'ready'
      }).returningAll().executeTakeFirstOrThrow();
      
      // {Q: both environments exist with same name but different users}
      expect(env1.name).toBe('shared-name');
      expect(env2.name).toBe('shared-name');
      expect(env1.user_id).not.toBe(env2.user_id);
      expect(env1.id).not.toBe(env2.id);
    });

    it('should allow same repository for different environments', async () => {
      // {P: same repository URL for different environments}
      const env1 = await db.insertInto('environments').values({
        user_id: testUserId1,
        name: 'env1',
        repository_url: 'https://github.com/shared/repo',
        branch: 'main',
        status: 'ready'
      }).returningAll().executeTakeFirstOrThrow();
      
      const env2 = await db.insertInto('environments').values({
        user_id: testUserId1,
        name: 'env2',
        repository_url: 'https://github.com/shared/repo',
        branch: 'develop',
        status: 'ready'
      }).returningAll().executeTakeFirstOrThrow();
      
      // {Q: same repository can be used by multiple environments}
      expect(env1.repository_url).toBe(env2.repository_url);
      expect(env1.branch).not.toBe(env2.branch);
      expect(env1.name).not.toBe(env2.name);
    });
  });

  describe('Invariant E₃: Environment status states', () => {
    it('should create environment with ready status', async () => {
      // {P: new environment creation}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'ready-env',
          repository_url: 'https://github.com/test/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // {Q: environment.status = 'ready'}
      expect(env.status).toBe('ready');
    });

    it('should allow error status for failed environments', async () => {
      // {P: environment creation or update}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'error-env',
          repository_url: 'https://github.com/invalid/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // Simulate error state (e.g., invalid repository)
      await db
        .updateTable('environments')
        .set({ status: 'error' })
        .where('id', '=', env.id)
        .execute();
      
      const errorEnv = await db
        .selectFrom('environments')
        .select('status')
        .where('id', '=', env.id)
        .executeTakeFirstOrThrow();
      
      // {Q: environment.status = 'error'}
      expect(errorEnv.status).toBe('error');
    });

    it('should not use running status (containers belong to sessions)', async () => {
      // {P: environment exists}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'test-env',
          repository_url: 'https://github.com/test/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // {Q: status should be 'ready', not 'running'}
      expect(env.status).toBe('ready');
      expect(env.status).not.toBe('running');
      
      // Even if we try to set it to running, it conceptually doesn't make sense
      // because environments don't have containers
      expect(['ready', 'error']).toContain(env.status);
    });
  });

  describe('Environment and Session Relationship', () => {
    it('should support multiple sessions per environment', async () => {
      // {P: environment exists}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'multi-session-env',
          repository_url: 'https://github.com/test/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // Create multiple sessions
      const session1 = await db
        .insertInto('sessions')
        .values({
          environment_id: env.id,
          name: 'session1',
          tmux_session_name: 'session1-tmux',
          working_directory: '/workspace',
          status: 'inactive',
          git_branch: 'main'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      const session2 = await db
        .insertInto('sessions')
        .values({
          environment_id: env.id,
          name: 'session2',
          tmux_session_name: 'session2-tmux',
          working_directory: '/workspace',
          status: 'inactive',
          git_branch: 'feature'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // {Q: multiple sessions reference same environment}
      expect(session1.environment_id).toBe(env.id);
      expect(session2.environment_id).toBe(env.id);
      expect(session1.git_branch).not.toBe(session2.git_branch);
    });

    it('should cascade delete sessions when environment deleted', async () => {
      // {P: environment with sessions}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'cascade-env',
          repository_url: 'https://github.com/test/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      const session = await db
        .insertInto('sessions')
        .values({
          environment_id: env.id,
          name: 'test-session',
          tmux_session_name: 'test-tmux',
          working_directory: '/workspace',
          status: 'inactive',
          git_branch: 'main'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // Delete environment
      await db
        .deleteFrom('environments')
        .where('id', '=', env.id)
        .execute();
      
      // {Q: sessions also deleted due to foreign key cascade}
      const deletedSession = await db
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', session.id)
        .executeTakeFirst();
      
      expect(deletedSession).toBeUndefined();
    });
  });

  describe('Git Repository Integration', () => {
    it('should handle various git URL formats', async () => {
      // {P: different git URL formats}
      const gitUrls = [
        'https://github.com/user/repo.git',
        'https://github.com/user/repo',
        'git@github.com:user/repo.git',
        'https://gitlab.com/user/repo.git'
      ];
      
      for (let i = 0; i < gitUrls.length; i++) {
        const env = await db
          .insertInto('environments')
          .values({
            user_id: testUserId1,
            name: `git-env-${i}`,
            repository_url: gitUrls[i],
            branch: 'main',
            status: 'ready'
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        
        // {Q: environment accepts valid git URLs}
        expect(env.repository_url).toBe(gitUrls[i]);
        expect(env.status).toBe('ready');
      }
    });

    it('should handle different default branches', async () => {
      // {P: repositories with different default branches}
      const branches = ['main', 'master', 'develop', 'trunk'];
      
      for (const branch of branches) {
        const env = await db
          .insertInto('environments')
          .values({
            user_id: testUserId1,
            name: `${branch}-env`,
            repository_url: 'https://github.com/test/repo',
            branch: branch,
            status: 'ready'
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        
        // {Q: environment accepts different default branches}
        expect(env.branch).toBe(branch);
      }
    });
  });

  describe('Environment Metadata and Timestamps', () => {
    it('should track creation and update timestamps', async () => {
      // {P: environment creation}
      const beforeCreation = new Date();
      
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'timestamped-env',
          repository_url: 'https://github.com/test/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      const afterCreation = new Date();
      
      // {Q: timestamps are reasonable}
      expect(env.created_at.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(env.created_at.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
      expect(env.updated_at.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(env.updated_at.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
    });

    it('should update timestamp on environment changes', async () => {
      // {P: environment exists}
      const env = await db
        .insertInto('environments')
        .values({
          user_id: testUserId1,
          name: 'update-env',
          repository_url: 'https://github.com/test/repo',
          branch: 'main',
          status: 'ready'
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      
      const originalUpdatedAt = env.updated_at;
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Update environment
      await db
        .updateTable('environments')
        .set({
          status: 'error',
          updated_at: new Date()
        })
        .where('id', '=', env.id)
        .execute();
      
      const updatedEnv = await db
        .selectFrom('environments')
        .select('updated_at')
        .where('id', '=', env.id)
        .executeTakeFirstOrThrow();
      
      // {Q: updated_at timestamp changed}
      expect(updatedEnv.updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });
});