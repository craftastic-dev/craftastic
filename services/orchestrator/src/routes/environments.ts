import { FastifyInstance } from 'fastify';
import { getDatabase } from '../lib/kysely';
import { createSandbox, destroySandbox, getDocker } from '../services/docker';
import { userService } from '../services/user';
import { config } from '../config';
import os from 'os';

export interface Environment {
  id: string;
  userId: string;
  name: string;
  repositoryUrl?: string;
  branch: string;
  containerId?: string;
  status: 'running' | 'stopped' | 'starting' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  environmentId: string;
  name?: string;
  tmuxSessionName: string;
  workingDirectory: string;
  status: 'active' | 'inactive' | 'dead';
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
  agentId?: string;
  sessionType: 'terminal' | 'agent';
  gitBranch?: string;
}

export async function environmentRoutes(fastify: FastifyInstance) {
  const db = getDatabase();

  // Create new environment
  fastify.post('/environments', async (request, reply) => {
    const { userId, name, repositoryUrl, branch = 'main' } = request.body as {
      userId: string;
      name: string;
      repositoryUrl?: string;
      branch?: string;
    };

    try {
      // Check if Docker image exists BEFORE creating environment
      const docker = getDocker();
      const imageName = config.SANDBOX_IMAGE;
      
      try {
        const images = await docker.listImages({
          filters: {
            reference: [imageName]
          }
        });
        
        if (images.length === 0) {
          reply.code(400).send({
            error: 'Docker image not found',
            details: `Docker image '${imageName}' not found. Please build it first with:\ndocker build -f services/orchestrator/docker/sandbox.Dockerfile -t ${imageName} .`
          });
          return;
        }
      } catch (error) {
        console.error('Error checking for Docker image:', error);
        reply.code(500).send({
          error: 'Failed to check Docker image',
          details: `Failed to verify Docker image availability: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
        return;
      }
      
      // Resolve user ID (handles both UUID and legacy formats)
      const resolvedUserId = await userService.resolveUserId(userId);
      
      // Check if environment name already exists for this user
      const existingEnvironment = await db
        .selectFrom('environments')
        .select(['id', 'name'])
        .where('user_id', '=', resolvedUserId)
        .where('name', '=', name)
        .executeTakeFirst();

      if (existingEnvironment) {
        reply.code(409).send({
          error: 'Environment name already exists',
          details: `An environment named "${name}" already exists. Please choose a different name.`,
          suggestions: [
            `${name}-2`,
            `${name}-copy`,
            `${name}-${new Date().toISOString().slice(0, 10)}`
          ]
        });
        return;
      }
      
      // Create environment record (only after confirming Docker image exists)
      const environment = await db
        .insertInto('environments')
        .values({
          user_id: resolvedUserId,
          name,
          repository_url: repositoryUrl || null,
          branch,
          status: 'starting',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create Docker container for this environment
      // Mount the craftastic data directory so all worktrees are accessible
      const dataDir = process.env.CRAFTASTIC_DATA_DIR || os.homedir() + '/.craftastic';
      
      // Create Docker container
      const container = await createSandbox({
        sessionId: environment.id, // Use environment ID as session ID for now
        userId,
        environmentName: name,
        worktreeMounts: [{
          hostPath: dataDir,
          containerPath: '/data'
        }]
      });
      
      // Update environment with container ID
      const updatedEnvironment = await db
        .updateTable('environments')
        .set({
          container_id: container.id,
          status: 'running',
          updated_at: new Date(),
        })
        .where('id', '=', environment.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      const responseEnv: Environment = {
        id: updatedEnvironment.id,
        userId: updatedEnvironment.user_id,
        name: updatedEnvironment.name,
        repositoryUrl: updatedEnvironment.repository_url || undefined,
        branch: updatedEnvironment.branch,
        containerId: updatedEnvironment.container_id || undefined,
        status: updatedEnvironment.status,
        createdAt: updatedEnvironment.created_at.toISOString(),
        updatedAt: updatedEnvironment.updated_at.toISOString(),
      };

      reply.send(responseEnv);
    } catch (error) {
      console.error('Error creating environment:', error);
      reply.code(500).send({ error: 'Failed to create environment' });
    }
  });

  // Get user's environments
  fastify.get('/environments/user/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };

    try {
      // Resolve the user ID to handle both legacy and UUID formats
      const resolvedUserId = await userService.resolveUserId(userId);
      
      // First get all environments for the user
      const environmentRows = await db
        .selectFrom('environments')
        .selectAll()
        .where('user_id', '=', resolvedUserId)
        .orderBy('created_at', 'desc')
        .execute();

      // Then get all sessions for these environments
      const environmentIds = environmentRows.map(env => env.id);
      const sessionRows = environmentIds.length > 0 ? await db
        .selectFrom('sessions')
        .selectAll()
        .where('environment_id', 'in', environmentIds)
        .orderBy('created_at', 'desc')
        .execute() : [];

      // Group sessions by environment
      const sessionsByEnvironment = sessionRows.reduce((acc, session) => {
        if (!acc[session.environment_id]) {
          acc[session.environment_id] = [];
        }
        acc[session.environment_id].push({
          id: session.id,
          environmentId: session.environment_id,
          name: session.name || undefined,
          tmuxSessionName: session.tmux_session_name,
          workingDirectory: session.working_directory,
          status: session.status,
          createdAt: session.created_at.toISOString(),
          updatedAt: session.updated_at.toISOString(),
          lastActivity: session.last_activity?.toISOString(),
          gitBranch: session.git_branch,
        });
        return acc;
      }, {} as Record<string, Session[]>);

      const environments: (Environment & { sessions: Session[] })[] = environmentRows.map(row => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        repositoryUrl: row.repository_url || undefined,
        branch: row.branch,
        containerId: row.container_id || undefined,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        sessions: sessionsByEnvironment[row.id] || [],
      }));

      reply.send({ environments });
    } catch (error) {
      console.error('Error fetching environments:', error);
      reply.code(500).send({ error: 'Failed to fetch environments' });
    }
  });

  // Get specific environment
  fastify.get('/environments/:environmentId', async (request, reply) => {
    const { environmentId } = request.params as { environmentId: string };

    try {
      const result = await db
        .selectFrom('environments')
        .selectAll()
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!result) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }

      const environment: Environment = {
        id: result.id,
        userId: result.user_id,
        name: result.name,
        repositoryUrl: result.repository_url || undefined,
        branch: result.branch,
        containerId: result.container_id || undefined,
        status: result.status,
        createdAt: result.created_at.toISOString(),
        updatedAt: result.updated_at.toISOString(),
      };

      reply.send(environment);
    } catch (error) {
      console.error('Error fetching environment:', error);
      reply.code(500).send({ error: 'Failed to fetch environment' });
    }
  });

  // Check environment name availability
  fastify.get('/environments/check-name/:userId/:name', async (request, reply) => {
    const { userId, name } = request.params as { userId: string; name: string };

    try {
      // Resolve user ID (handles both UUID and legacy formats)
      const resolvedUserId = await userService.resolveUserId(userId);
      
      // Check if environment name already exists for this user
      const existingEnvironment = await db
        .selectFrom('environments')
        .select(['id', 'name'])
        .where('user_id', '=', resolvedUserId)
        .where('name', '=', name)
        .executeTakeFirst();

      const available = !existingEnvironment;
      const suggestions = available ? [] : [
        `${name}-2`,
        `${name}-copy`,
        `${name}-${new Date().toISOString().slice(0, 10)}`
      ];

      reply.send({
        available,
        name,
        suggestions,
        message: available 
          ? `"${name}" is available` 
          : `"${name}" is already taken`
      });
    } catch (error) {
      console.error('Error checking environment name:', error);
      reply.code(500).send({ error: 'Failed to check environment name' });
    }
  });

  // Delete environment
  fastify.delete('/environments/:environmentId', async (request, reply) => {
    const { environmentId } = request.params as { environmentId: string };

    try {
      // Get environment details
      const environment = await db
        .selectFrom('environments')
        .selectAll()
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }

      // Clean up all sessions before deleting container
      if (environment.container_id) {
        try {
          // Import cleanup service
          const { cleanupEnvironmentSessions } = await import('../services/session-cleanup');
          
          // Clean up all tmux sessions for this environment
          await cleanupEnvironmentSessions(environment.id, environment.container_id);
          
          // Delete Docker container
          await destroySandbox(environment.container_id);
        } catch (error) {
          console.warn('Failed to delete container:', error);
        }
      }

      // Delete environment (CASCADE will delete sessions)
      await db
        .deleteFrom('environments')
        .where('id', '=', environmentId)
        .execute();

      reply.send({ success: true });
    } catch (error) {
      console.error('Error deleting environment:', error);
      reply.code(500).send({ error: 'Failed to delete environment' });
    }
  });
}