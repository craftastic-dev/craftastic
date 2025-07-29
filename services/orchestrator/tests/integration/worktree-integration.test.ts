import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestServer, ApiTestClient, cleanupTestData } from '../helpers/api-client';
import type { FastifyInstance } from 'fastify';

describe('Worktree Integration', () => {
  let server: FastifyInstance;
  let client: ApiTestClient;

  beforeAll(async () => {
    server = await createTestServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    client = new ApiTestClient(server);
  });

  afterEach(async () => {
    if (client) {
      await client.cleanup();
    }
  });

  it('should create session with worktree for environment with repository', async () => {
    // Create environment with repository
    const envResponse = await client.createTestEnvironment({
      name: 'test-worktree-env',
      repositoryUrl: 'https://github.com/octocat/Hello-World.git',
      branch: 'master' // This repo uses master as default
    });
    
    expect(envResponse.status).toBe(200);
    expect(envResponse.body).toHaveProperty('repositoryUrl');

    // Create session - should automatically create worktree
    const sessionResponse = await client.createTestSession(envResponse.body.id, {
      name: 'test-worktree-session'
    });

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body).toHaveProperty('id');
    expect(sessionResponse.body).toHaveProperty('workingDirectory');
    
    // Working directory should be set to worktree path in container
    expect(sessionResponse.body.workingDirectory).toMatch(/^\/data\/repos\/.+\/worktrees\/.+$/);
  });

  it('should create session with worktree that has git functionality', async () => {
    // Create environment and session with repository
    const envResponse = await client.createTestEnvironment({
      repositoryUrl: 'https://github.com/octocat/Hello-World.git',
      branch: 'master'
    });
    const sessionResponse = await client.createTestSession(envResponse.body.id);

    expect(sessionResponse.status).toBe(200);
    const sessionId = sessionResponse.body.id;

    // Test git status - should NOT return "Session has no git worktree" error
    const statusResponse = await client.request('GET', `/api/git/status/${sessionId}`);
    
    // Should get either success (200) or an actual git error, not the worktree error
    if (statusResponse.status !== 200) {
      expect(statusResponse.body.error).not.toBe('Session has no git worktree');
    }
  });

  it('should handle environment without repository gracefully', async () => {
    // Create environment without repository
    const envResponse = await client.createTestEnvironment({
      name: 'no-repo-env',
      repositoryUrl: undefined // Explicitly no repository
    });
    
    expect(envResponse.status).toBe(200);

    // Create session - should work but without worktree
    const sessionResponse = await client.createTestSession(envResponse.body.id);

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body.workingDirectory).toBe('/workspace'); // Default working directory

    // Git operations should return "no worktree" error
    const statusResponse = await client.request('GET', `/api/git/status/${sessionResponse.body.id}`);
    expect(statusResponse.status).toBe(400);
    expect(statusResponse.body.error).toBe('Session has no git worktree');
  });

  it('should clean up worktree when session is deleted', async () => {
    // Create environment and session with repository
    const envResponse = await client.createTestEnvironment({
      repositoryUrl: 'https://github.com/octocat/Hello-World.git',
      branch: 'master'
    });
    const sessionResponse = await client.createTestSession(envResponse.body.id);
    const sessionId = sessionResponse.body.id;

    expect(sessionResponse.status).toBe(200);

    // Delete the session
    const deleteResponse = await client.request('DELETE', `/api/sessions/${sessionId}`);
    expect(deleteResponse.status).toBe(200);

    // Session should no longer exist
    const getResponse = await client.request('GET', `/api/sessions/${sessionId}`);
    expect(getResponse.status).toBe(404);
  });

  it('should set correct container working directory for worktree sessions', async () => {
    // Create environment and session with repository  
    const envResponse = await client.createTestEnvironment({
      repositoryUrl: 'https://github.com/octocat/Hello-World.git',
      branch: 'master'
    });
    const sessionResponse = await client.createTestSession(envResponse.body.id);

    expect(sessionResponse.status).toBe(200);
    
    const workingDir = sessionResponse.body.workingDirectory;
    
    // Should be mapped to container path
    expect(workingDir).toMatch(/^\/data\/repos\/.+\/worktrees\/.+$/);
    
    // Should contain environment ID and session ID in path
    expect(workingDir).toContain(envResponse.body.id);
    expect(workingDir).toContain(sessionResponse.body.id);
  });
});