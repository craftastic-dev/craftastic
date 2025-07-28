import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, ApiTestClient } from '../helpers/api-client';
import type { FastifyInstance } from 'fastify';

describe('API Health', () => {
  let server: FastifyInstance;
  let client: ApiTestClient;

  beforeAll(async () => {
    server = await createTestServer();
    await server.ready();
    client = new ApiTestClient(server);
  });

  afterAll(async () => {
    await server.close();
  });

  it('should be able to create test server', () => {
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });

  it('should be able to create and use API client', () => {
    expect(client).toBeDefined();
    expect(client.userId).toBe('test-user-12345');
  });

  it('should handle 404 for non-existent endpoints', async () => {
    const response = await client.request('GET', '/api/non-existent-endpoint');
    expect(response.status).toBe(404);
  });
});

describe('Environment and Session Creation', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('should create test environment successfully', async () => {
    const client = new ApiTestClient(server);
    
    try {
      const response = await client.createTestEnvironment();
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', 'test-environment');
      expect(response.body).toHaveProperty('repositoryUrl', 'https://github.com/octocat/Hello-World.git');
      expect(response.body).toHaveProperty('branch', 'main');
      expect(response.body).toHaveProperty('status', 'running');
      expect(response.body).toHaveProperty('containerId');
    } finally {
      await client.cleanup();
    }
  });

  it('should create test session successfully', async () => {
    const client = new ApiTestClient(server);
    
    try {
      await client.createTestEnvironment();
      const response = await client.createTestSession();
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('environmentId', client.environmentId);
      expect(response.body).toHaveProperty('name', 'test-session');
      expect(response.body).toHaveProperty('sessionType', 'terminal');
      expect(response.body).toHaveProperty('status', 'inactive');
    } finally {
      await client.cleanup();
    }
  });

  it('should setup test data with helper method', async () => {
    const client = new ApiTestClient(server);
    
    try {
      const { environmentId, sessionId } = await client.setupTestData();
      
      expect(environmentId).toBeDefined();
      expect(sessionId).toBeDefined();
      expect(typeof environmentId).toBe('string');
      expect(typeof sessionId).toBe('string');
    } finally {
      await client.cleanup();
    }
  });
});