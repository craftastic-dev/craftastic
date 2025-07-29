import request from 'supertest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from '../../src/config';
import gitRoutes from '../../src/routes/git';
import { environmentRoutes } from '../../src/routes/environments';
import { sessionRoutes } from '../../src/routes/sessions';
import { setupDatabase } from '../../src/lib/database';

/**
 * Create a test Fastify server instance for API testing
 */
export async function createTestServer() {
  const server = Fastify({
    logger: false, // Disable logging in tests
  });

  // Setup database
  await setupDatabase();

  // Register plugins
  await server.register(cors, {
    origin: '*',
  });

  await server.register(jwt, {
    secret: config.JWT_SECRET,
  });

  await server.register(websocket);

  // Development authentication bypass for testing
  server.addHook('preHandler', async (request, reply) => {
    // Allow test authentication via header
    if (request.headers['x-test-user-id']) {
      request.user = { id: request.headers['x-test-user-id'] as string };
    }
  });

  // Register routes
  server.register(environmentRoutes, { prefix: '/api' });
  server.register(sessionRoutes, { prefix: '/api/sessions' });
  server.register(gitRoutes);

  return server;
}

/**
 * API test client with common functionality
 */
export class ApiTestClient {
  private server: Fastify.FastifyInstance;
  private testUserId: string;
  private testEnvironmentId: string | null = null;
  private testSessionId: string | null = null;

  constructor(server: Fastify.FastifyInstance, testUserId: string = 'test-user-12345') {
    this.server = server;
    this.testUserId = testUserId;
  }

  /**
   * Make authenticated API request
   */
  async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: any) {
    const req = request(this.server.server)[method.toLowerCase() as keyof request.SuperTest<request.Test>](path)
      .set('x-test-user-id', this.testUserId);
    
    if (body) {
      req.send(body);
    }
    
    return req;
  }

  /**
   * Create a test environment
   */
  async createTestEnvironment(overrides: Partial<{
    name: string;
    repositoryUrl: string | undefined;
    branch: string;
  }> = {}) {
    const baseConfig = {
      userId: this.testUserId,
      name: 'test-environment',
      repositoryUrl: 'https://github.com/octocat/Hello-World.git',
      branch: 'main',
      ...overrides
    };
    
    // Remove repositoryUrl if explicitly set to undefined
    if (overrides.repositoryUrl === undefined) {
      delete baseConfig.repositoryUrl;
    }
    
    const response = await this.request('POST', '/api/environments', baseConfig);

    if (response.status === 200) {
      this.testEnvironmentId = response.body.id;
    }

    return response;
  }

  /**
   * Create a test session
   */
  async createTestSession(environmentId?: string, overrides: Partial<{
    name: string;
    workingDirectory: string;
    sessionType: 'terminal' | 'agent';
  }> = {}) {
    const envId = environmentId || this.testEnvironmentId;
    if (!envId) {
      throw new Error('No environment available. Call createTestEnvironment() first.');
    }

    const response = await this.request('POST', '/api/sessions', {
      environmentId: envId,
      name: 'test-session',
      workingDirectory: '/workspace',
      sessionType: 'terminal',
      ...overrides
    });

    if (response.status === 200) {
      this.testSessionId = response.body.id;
    }

    return response;
  }

  /**
   * Setup test environment and session
   */
  async setupTestData() {
    const envResponse = await this.createTestEnvironment();
    if (envResponse.status !== 200) {
      throw new Error(`Failed to create test environment: ${envResponse.body}`);
    }

    const sessionResponse = await this.createTestSession();
    if (sessionResponse.status !== 200) {
      throw new Error(`Failed to create test session: ${sessionResponse.body}`);
    }

    return {
      environmentId: this.testEnvironmentId!,
      sessionId: this.testSessionId!
    };
  }

  /**
   * Clean up test data created by this client
   */
  async cleanup() {
    if (this.testEnvironmentId) {
      await cleanupTestData(this.testEnvironmentId);
      this.testEnvironmentId = null;
      this.testSessionId = null;
    }
  }

  // Getters
  get environmentId() { return this.testEnvironmentId; }
  get sessionId() { return this.testSessionId; }
  get userId() { return this.testUserId; }
}

/**
 * Clean up test data (environments, sessions, containers)
 * Call this in test teardown to avoid resource leaks
 */
export async function cleanupTestData(environmentId?: string) {
  if (!environmentId) return;
  
  try {
    const { getDatabase } = await import('../../src/lib/kysely');
    const { destroySandbox } = await import('../../src/services/docker');
    
    const db = getDatabase();
    
    // Get environment details before deletion
    const environment = await db
      .selectFrom('environments')
      .select(['container_id'])
      .where('id', '=', environmentId)
      .executeTakeFirst();
    
    // Clean up Docker container if it exists
    if (environment?.container_id) {
      try {
        await destroySandbox(environment.container_id);
        console.log(`🧹 Cleaned up container: ${environment.container_id}`);
      } catch (error) {
        console.warn(`⚠️  Failed to cleanup container ${environment.container_id}:`, error.message);
      }
    }
    
    // Delete sessions (will cascade from environment deletion, but explicit is better)
    const deletedSessions = await db
      .deleteFrom('sessions')
      .where('environment_id', '=', environmentId)
      .returning('id')
      .execute();
    
    if (deletedSessions.length > 0) {
      console.log(`🧹 Deleted ${deletedSessions.length} sessions`);
    }
    
    // Delete environment (this should cascade to related records)
    const deletedEnv = await db
      .deleteFrom('environments')
      .where('id', '=', environmentId)
      .returning('id')
      .execute();
    
    if (deletedEnv.length > 0) {
      console.log(`🧹 Deleted environment: ${environmentId}`);
    }
    
  } catch (error) {
    console.warn(`⚠️  Failed to cleanup test environment ${environmentId}:`, error.message);
  }
}