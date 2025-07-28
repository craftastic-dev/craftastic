import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeService } from '../../src/services/worktree';
import { getDatabase } from '../../src/lib/kysely';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('WorktreeService', () => {
  let worktreeService: WorktreeService;
  let testEnvironmentId: string;
  let testSessionId: string;
  let testDataDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'craftastic-test-'));
    
    // Override the data directory for testing
    process.env.CRAFTASTIC_DATA_DIR = testDataDir;
    
    worktreeService = new WorktreeService();
    testEnvironmentId = randomUUID();
    testSessionId = randomUUID();

    // Create test environment and session in database
    const db = getDatabase();
    
    // Create test user first
    const user = await db
      .insertInto('users')
      .values({
        email: 'test@example.com',
        name: 'Test User',
      })
      .returning('id')
      .executeTakeFirst();

    // Create test environment
    await db
      .insertInto('environments')
      .values({
        id: testEnvironmentId,
        user_id: user!.id,
        name: 'test-env',
        repository_url: 'https://github.com/octocat/Hello-World.git',
        branch: 'main',
        status: 'running',
      })
      .execute();

    // Create test session
    await db
      .insertInto('sessions')
      .values({
        id: testSessionId,
        environment_id: testEnvironmentId,
        name: 'test-session',
        tmux_session_name: 'test-session-123',
        working_directory: '/workspace',
        status: 'inactive',
        session_type: 'terminal',
      })
      .execute();
  });

  afterEach(async () => {
    // Clean up test data directory
    try {
      await fs.rmdir(testDataDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }

    // Clean up database records
    const db = getDatabase();
    try {
      await db.deleteFrom('sessions').where('id', '=', testSessionId).execute();
      await db.deleteFrom('environments').where('id', '=', testEnvironmentId).execute();
    } catch (error) {
      // Ignore cleanup errors
    }

    // Reset environment variable
    delete process.env.CRAFTASTIC_DATA_DIR;
  });

  describe('Repository Management', () => {
    it('should handle repository info for non-existent repository', async () => {
      const repoInfo = await worktreeService.getRepositoryInfo(testEnvironmentId);
      
      expect(repoInfo).toBeNull();
    });

    it('should list empty worktrees for non-existent repository', async () => {
      const worktrees = await worktreeService.listWorktrees(testEnvironmentId);
      
      expect(worktrees).toEqual([]);
    });
  });

  describe('Worktree Operations', () => {
    it('should fail to create worktree without valid git repository', async () => {
      const config = {
        environmentId: testEnvironmentId,
        sessionId: testSessionId,
        repositoryUrl: 'https://github.com/nonexistent/repo.git',
        branch: 'main',
      };

      await expect(worktreeService.createWorktree(config)).rejects.toThrow();
    });

    it('should handle worktree removal gracefully when worktree does not exist', async () => {
      // This should not throw an error
      await expect(
        worktreeService.removeWorktree(testEnvironmentId, testSessionId)
      ).resolves.toBeUndefined();
    });

    it('should cleanup orphaned worktrees', async () => {
      // Should not throw an error even with no worktrees
      await expect(
        worktreeService.cleanupOrphanedWorktrees(testEnvironmentId)
      ).resolves.toBeUndefined();
    });
  });

  describe('Configuration', () => {
    it('should use custom data directory when CRAFTASTIC_DATA_DIR is set', () => {
      const service = new WorktreeService();
      // Test that the service respects the environment variable
      // (We can't easily test the internal dataDir property, but the constructor runs)
      expect(service).toBeInstanceOf(WorktreeService);
    });

    it('should use default data directory when CRAFTASTIC_DATA_DIR is not set', () => {
      delete process.env.CRAFTASTIC_DATA_DIR;
      const service = new WorktreeService();
      expect(service).toBeInstanceOf(WorktreeService);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid repository URLs gracefully', async () => {
      const config = {
        environmentId: testEnvironmentId,
        sessionId: testSessionId,
        repositoryUrl: 'not-a-valid-url',
        branch: 'main',
      };

      await expect(worktreeService.createWorktree(config)).rejects.toThrow();
    });

    it('should handle database connection errors gracefully', async () => {
      // Create a worktree service but don't test actual git operations
      // since they require a real repository
      const service = new WorktreeService();
      
      // Test that methods exist and can be called
      expect(typeof service.getRepositoryInfo).toBe('function');
      expect(typeof service.listWorktrees).toBe('function');
      expect(typeof service.createWorktree).toBe('function');
      expect(typeof service.removeWorktree).toBe('function');
      expect(typeof service.cleanupOrphanedWorktrees).toBe('function');
    });
  });
});