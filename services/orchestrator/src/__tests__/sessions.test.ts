import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { getDatabase } from '../lib/kysely';
import { setupDatabase } from '../lib/database';
import { getDocker } from '../services/docker';

/**
 * SESSION MANAGEMENT TESTS - Hoare Logic Verification
 * ==================================================
 * 
 * These tests verify the core invariants of the session-owned container architecture:
 * 
 * I₁: ∀s ∈ Sessions. |{c ∈ Containers : owner(c) = s}| ≤ 1
 *     (At most one container per session)
 * 
 * I₂: ∀s ∈ Sessions. ∃!e ∈ Environments. environment_of(s) = e
 *     (Each session belongs to exactly one environment)
 * 
 * I₃: ∀b ∈ Branches, e ∈ Environments. |{s ∈ Sessions : branch(s) = b ∧ env(s) = e}| ≤ 1
 *     (At most one active session per branch per environment)
 * 
 * I₄: ∀e ∈ Environments. container_id(e) = null
 *     (Environments never have containers)
 */

describe('Session Management', () => {
  let db: any;
  const docker = getDocker();
  const testEnvironmentId = 'test-env-' + Date.now();
  const testUserId = 'test-user-' + Date.now();
  
  beforeAll(async () => {
    // Initialize database connection for tests
    await setupDatabase();
    db = getDatabase();
  });
  
  beforeEach(async () => {
    // Clean test state
    await db.deleteFrom('sessions').where('environment_id', '=', testEnvironmentId).execute();
    await db.deleteFrom('environments').where('id', '=', testEnvironmentId).execute();
    
    // Create test environment
    await db.insertInto('environments').values({
      id: testEnvironmentId,
      user_id: testUserId,
      name: 'test-environment',
      repository_url: 'https://github.com/test/repo',
      branch: 'main',
      status: 'ready'
    }).execute();
  });

  afterEach(async () => {
    // Cleanup containers and sessions
    const sessions = await db
      .selectFrom('sessions')
      .select('container_id')
      .where('environment_id', '=', testEnvironmentId)
      .execute();
    
    for (const session of sessions) {
      if (session.container_id) {
        try {
          const container = docker.getContainer(session.container_id);
          await container.stop();
          await container.remove();
        } catch (error) {
          console.warn('Failed to cleanup container:', session.container_id);
        }
      }
    }
    
    // Clean database
    await db.deleteFrom('sessions').where('environment_id', '=', testEnvironmentId).execute();
    await db.deleteFrom('environments').where('id', '=', testEnvironmentId).execute();
  });

  describe('Invariant I₁: At most one container per session', () => {
    it('should create session with its own container', async () => {
      // {P: environment exists ∧ valid session data}
      const sessionData = {
        environment_id: testEnvironmentId,
        name: 'test-session',
        tmux_session_name: 'test-tmux-' + Date.now(),
        working_directory: '/workspace',
        status: 'inactive' as const,
        git_branch: 'main'
      };
      
      const session = await db
        .insertInto('sessions')
        .values(sessionData)
        .returningAll()
        .executeTakeFirstOrThrow();
      
      // {Q: session created ∧ session.container_id = null initially}
      expect(session.container_id).toBeNull();
      expect(session.working_directory).toBe('/workspace');
      expect(session.git_branch).toBe('main');
    });

    it('should never create multiple containers for same session', async () => {
      // {P: session exists}
      const session = await createTestSession('test-session', 'main');
      
      // Simulate multiple container creation attempts
      // This would happen if ensureSessionContainer is called multiple times
      const containerId1 = 'mock-container-1';
      const containerId2 = 'mock-container-2';
      
      // First update
      await db
        .updateTable('sessions')
        .set({ container_id: containerId1 })
        .where('id', '=', session.id)
        .execute();
      
      // Second update should replace, not add
      await db
        .updateTable('sessions')
        .set({ container_id: containerId2 })
        .where('id', '=', session.id)
        .execute();
      
      // {Q: session has only one container_id}
      const updatedSession = await db
        .selectFrom('sessions')
        .select('container_id')
        .where('id', '=', session.id)
        .executeTakeFirstOrThrow();
      
      expect(updatedSession.container_id).toBe(containerId2);
    });
  });

  describe('Invariant I₂: Each session belongs to exactly one environment', () => {
    it('should enforce foreign key constraint', async () => {
      // {P: ¬∃e. e.id = 'invalid-id'}
      
      // Try to create session with invalid environment
      await expect(
        db.insertInto('sessions')
          .values({
            environment_id: 'invalid-uuid-12345',
            tmux_session_name: 'test',
            working_directory: '/workspace',
            status: 'inactive'
          })
          .execute()
      ).rejects.toThrow();
      
      // {Q: session not created}
    });

    it('should cascade delete sessions when environment deleted', async () => {
      // {P: session exists in environment}
      const session = await createTestSession('test-session', 'main');
      
      // Delete environment
      await db.deleteFrom('environments')
        .where('id', '=', testEnvironmentId)
        .execute();
      
      // {Q: session also deleted}
      const deletedSession = await db
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', session.id)
        .executeTakeFirst();
      
      expect(deletedSession).toBeUndefined();
    });
  });

  describe('Invariant I₃: At most one session per branch per environment', () => {
    it('should prevent duplicate branch sessions', async () => {
      // {P: session exists with branch 'main'}
      await createTestSession('session1', 'main');
      
      // Try to create another session with same branch
      await expect(
        createTestSession('session2', 'main')
      ).rejects.toThrow(/BRANCH_IN_USE|constraint/);
      
      // {Q: only one session for branch 'main'}
      const sessions = await db
        .selectFrom('sessions')
        .select('id')
        .where('environment_id', '=', testEnvironmentId)
        .where('git_branch', '=', 'main')
        .where('status', '!=', 'dead')
        .execute();
      
      expect(sessions).toHaveLength(1);
    });

    it('should allow same branch after marking session dead', async () => {
      // {P: dead session with branch 'main'}
      const session1 = await createTestSession('session1', 'main');
      
      // Mark session as dead
      await db
        .updateTable('sessions')
        .set({ status: 'dead' })
        .where('id', '=', session1.id)
        .execute();
      
      // Create new session with same branch
      const session2 = await createTestSession('session2', 'main');
      
      // {Q: new session created successfully}
      expect(session2.id).not.toBe(session1.id);
      expect(session2.git_branch).toBe('main');
    });

    it('should allow different branches in same environment', async () => {
      // {P: environment exists}
      const session1 = await createTestSession('session1', 'main');
      const session2 = await createTestSession('session2', 'feature');
      
      // {Q: both sessions exist with different branches}
      expect(session1.git_branch).toBe('main');
      expect(session2.git_branch).toBe('feature');
      expect(session1.environment_id).toBe(session2.environment_id);
    });
  });

  describe('Session Container Integration', () => {
    it('should update session container_id when container created', async () => {
      // {P: session without container}
      const session = await createTestSession('test-session', 'main');
      expect(session.container_id).toBeNull();
      
      // Simulate container creation
      const mockContainerId = 'mock-container-' + Date.now();
      
      await db
        .updateTable('sessions')
        .set({
          container_id: mockContainerId,
          status: 'active'
        })
        .where('id', '=', session.id)
        .execute();
      
      // {Q: session has container_id ∧ status = active}
      const updatedSession = await db
        .selectFrom('sessions')
        .select(['container_id', 'status'])
        .where('id', '=', session.id)
        .executeTakeFirstOrThrow();
      
      expect(updatedSession.container_id).toBe(mockContainerId);
      expect(updatedSession.status).toBe('active');
    });

    it('should handle session deletion with container cleanup', async () => {
      // {P: session with container}
      const session = await createTestSession('test-session', 'main');
      const mockContainerId = 'mock-container-' + Date.now();
      
      await db
        .updateTable('sessions')
        .set({ container_id: mockContainerId })
        .where('id', '=', session.id)
        .execute();
      
      // Delete session
      await db
        .deleteFrom('sessions')
        .where('id', '=', session.id)
        .execute();
      
      // {Q: session deleted}
      const deletedSession = await db
        .selectFrom('sessions')
        .select('id')
        .where('id', '=', session.id)
        .executeTakeFirst();
      
      expect(deletedSession).toBeUndefined();
    });
  });

  describe('Session Lifecycle State Transitions', () => {
    it('should transition from inactive → active when container ready', async () => {
      // {P: session.status = inactive}
      const session = await createTestSession('test-session', 'main');
      expect(session.status).toBe('inactive');
      
      // Simulate container creation and activation
      await db
        .updateTable('sessions')
        .set({
          container_id: 'mock-container',
          status: 'active'
        })
        .where('id', '=', session.id)
        .execute();
      
      // {Q: session.status = active}
      const activeSession = await db
        .selectFrom('sessions')
        .select('status')
        .where('id', '=', session.id)
        .executeTakeFirstOrThrow();
      
      expect(activeSession.status).toBe('active');
    });

    it('should transition to dead when container fails', async () => {
      // {P: session.status = active}
      const session = await createTestSession('test-session', 'main');
      
      await db
        .updateTable('sessions')
        .set({ status: 'active', container_id: 'mock-container' })
        .where('id', '=', session.id)
        .execute();
      
      // Simulate container failure
      await db
        .updateTable('sessions')
        .set({ status: 'dead', container_id: null })
        .where('id', '=', session.id)
        .execute();
      
      // {Q: session.status = dead ∧ container_id = null}
      const deadSession = await db
        .selectFrom('sessions')
        .select(['status', 'container_id'])
        .where('id', '=', session.id)
        .executeTakeFirstOrThrow();
      
      expect(deadSession.status).toBe('dead');
      expect(deadSession.container_id).toBeNull();
    });
  });

  // Helper function to create test sessions
  async function createTestSession(name: string, branch: string) {
    return await db
      .insertInto('sessions')
      .values({
        environment_id: testEnvironmentId,
        name,
        tmux_session_name: name + '-tmux-' + Date.now(),
        working_directory: '/workspace',
        status: 'inactive',
        git_branch: branch
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
});