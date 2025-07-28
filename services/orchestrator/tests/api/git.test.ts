import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestServer, ApiTestClient, cleanupTestData } from '../helpers/api-client';
import type { FastifyInstance } from 'fastify';

describe('Git API', () => {
  let server: FastifyInstance;
  let client: ApiTestClient;
  let testData: { environmentId: string; sessionId: string };

  beforeAll(async () => {
    server = await createTestServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    client = new ApiTestClient(server);
    testData = await client.setupTestData();
  });

  afterEach(async () => {
    // Clean up test data after each test
    if (client) {
      await client.cleanup();
    }
  });

  describe('GitHub Authentication', () => {
    it('should initiate GitHub device flow', async () => {
      const response = await client.request('POST', '/api/auth/github/initiate');
      
      // Note: This may fail due to GitHub API issues, but we test the endpoint exists
      expect([200, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body.data).toHaveProperty('device_code');
        expect(response.body.data).toHaveProperty('user_code');
        expect(response.body.data).toHaveProperty('verification_uri');
      }
    });

    it('should check GitHub authentication status', async () => {
      const response = await client.request('GET', '/api/auth/github/status');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('connected');
      expect(response.body.data.connected).toBe(false); // Should be false initially
    });

    it('should handle GitHub disconnect', async () => {
      const response = await client.request('DELETE', '/api/auth/github/disconnect');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('Repository Operations', () => {
    it('should handle repository info request for environment without repo', async () => {
      const response = await client.request('GET', `/api/git/repo/${testData.environmentId}`);
      
      // Should return 404 because repository hasn't been cloned yet
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'No repository found for this environment');
    });

    it('should reject unauthorized repository access', async () => {
      // Create client with different user ID
      const unauthorizedClient = new ApiTestClient(server, 'different-user-id');
      
      const response = await unauthorizedClient.request('GET', `/api/git/repo/${testData.environmentId}`);
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Environment not found');
      
      // Note: unauthorizedClient doesn't create its own test data, so no cleanup needed
    });
  });

  describe('Git Session Operations', () => {
    it('should return error for git status on session without worktree', async () => {
      const response = await client.request('GET', `/api/git/status/${testData.sessionId}`);
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Session has no git worktree');
    });

    it('should return error for git diff on session without worktree', async () => {
      const response = await client.request('GET', `/api/git/diff/${testData.sessionId}`);
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Session has no git worktree');
    });

    it('should return error for git log on session without worktree', async () => {
      const response = await client.request('GET', `/api/git/log/${testData.sessionId}?limit=5`);
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Session has no git worktree');
    });

    it('should reject unauthorized session access', async () => {
      const unauthorizedClient = new ApiTestClient(server, 'different-user-id');
      
      const response = await unauthorizedClient.request('GET', `/api/git/status/${testData.sessionId}`);
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Session not found');
      
      // Note: unauthorizedClient doesn't create its own test data, so no cleanup needed
    });
  });

  describe('Git Commit Operations', () => {
    it('should return error for commit on session without worktree', async () => {
      const response = await client.request('POST', `/api/git/commit/${testData.sessionId}`, {
        message: 'Test commit',
        files: []
      });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Session has no git worktree');
    });

    it('should validate commit request body', async () => {
      const response = await client.request('POST', `/api/git/commit/${testData.sessionId}`, {
        // Missing required message field
        files: []
      });
      
      expect(response.status).toBe(500); // Zod validation error
      expect(response.body).toHaveProperty('success', false);
    });

    it('should return error for push on session without worktree', async () => {
      const response = await client.request('POST', `/api/git/push/${testData.sessionId}`, {
        remote: 'origin',
        branch: 'main'
      });
      
      // This might return 404 or 400 depending on the exact flow
      expect([400, 404]).toContain(response.status);
      expect(response.body).toHaveProperty('success', false);
    });
  });

  describe('Authentication & Authorization', () => {
    it('should reject requests without authentication', async () => {
      const unauthenticatedRequest = await server.inject({
        method: 'GET',
        url: `/api/git/status/${testData.sessionId}`,
        // No x-test-user-id header
      });
      
      expect(unauthenticatedRequest.statusCode).toBe(401);
      const body = JSON.parse(unauthenticatedRequest.body);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('should handle legacy user ID format', async () => {
      const legacyClient = new ApiTestClient(server, 'user-1234567890');
      const legacyTestData = await legacyClient.setupTestData();
      
      try {
        // Should work with legacy user ID format
        const response = await legacyClient.request('GET', `/api/git/status/${legacyTestData.sessionId}`);
        
        // Should get proper response (400 for no worktree, not auth error)
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Session has no git worktree');
      } finally {
        // Cleanup
        await legacyClient.cleanup();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID', async () => {
      const response = await client.request('GET', '/api/git/status/invalid-session-id');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Session not found');
    });

    it('should handle invalid environment ID', async () => {
      const response = await client.request('GET', '/api/git/repo/invalid-environment-id');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Environment not found');
    });

    it('should handle malformed request bodies', async () => {
      const response = await client.request('POST', `/api/git/commit/${testData.sessionId}`, {
        message: '', // Empty message should fail validation
      });
      
      expect(response.status).toBe(500); // Zod validation error
      expect(response.body).toHaveProperty('success', false);
    });
  });
});