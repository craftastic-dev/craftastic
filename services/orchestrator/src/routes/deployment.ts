import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { getDatabase } from '../lib/kysely';

const deploySchema = z.object({
  sessionId: z.string(),
  appId: z.string(),
  branch: z.string().default('main'),
});

export const deploymentRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  server.post('/deploy', async (request, reply) => {
    const { sessionId, appId, branch } = deploySchema.parse(request.body);
    
    if (!config.COOLIFY_API_URL || !config.COOLIFY_API_TOKEN) {
      return reply.code(501).send({
        error: 'Deployment not configured',
      });
    }
    
    const deployment = await db
      .insertInto('deployments')
      .values({
        environment_id: sessionId, // Note: this may need to be updated to match new schema
        app_id: appId,
        status: 'pending',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    
    try {
      const response = await fetch(`${config.COOLIFY_API_URL}/applications/${appId}/deploy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.COOLIFY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          branch,
          force: true,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Deployment failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      await db
        .updateTable('deployments')
        .set({
          status: 'started',
          metadata: JSON.stringify(result),
        })
        .where('id', '=', deployment.id)
        .execute();
      
      return {
        deploymentId: deployment.id,
        status: 'started',
        coolifyResponse: result,
      };
    } catch (error) {
      await db
        .updateTable('deployments')
        .set({ status: 'failed' })
        .where('id', '=', deployment.id)
        .execute();
      
      throw error;
    }
  });

  server.get('/status/:deploymentId', async (request, reply) => {
    const { deploymentId } = request.params as { deploymentId: string };
    
    const deployment = await db
      .selectFrom('deployments')
      .selectAll()
      .where('id', '=', deploymentId)
      .executeTakeFirst();
    
    if (!deployment) {
      return reply.code(404).send({
        error: 'Deployment not found',
      });
    }
    
    return deployment;
  });

  server.get('/list/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    
    const deployments = await db
      .selectFrom('deployments')
      .selectAll()
      .where('environment_id', '=', sessionId) // Note: this may need to be updated to match new schema
      .orderBy('created_at', 'desc')
      .execute();
    
    return { deployments };
  });
};