import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createSandbox, destroySandbox, listSandboxes } from '../services/docker';
import { getDatabase } from '../lib/kysely';

const createContainerSchema = z.object({
  userId: z.string(),
});

export const containerRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  server.post('/create', async (request, reply) => {
    const { userId } = createContainerSchema.parse(request.body);
    
    // Note: This route may need updating to work with the new environment/session model
    // Creating a session without an environment may not be valid in the new schema
    const session = await db
      .insertInto('sessions')
      .values({
        // This would need an environment_id in the new schema
        user_id: userId, // This column may not exist in the new schema
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    
    const container = await createSandbox({
      sessionId: session.id,
      userId,
    });
    
    await db
      .updateTable('sessions')
      .set({ container_id: container.id }) // This column may not exist in the new schema
      .where('id', '=', session.id)
      .execute();
    
    return {
      sessionId: session.id,
      containerId: container.id,
    };
  });

  server.delete('/:containerId', async (request, reply) => {
    const { containerId } = request.params as { containerId: string };
    
    await destroySandbox(containerId);
    
    // Note: In the new schema, container_id is on environments, not sessions
    // This would need to update environments instead
    await db
      .updateTable('environments')
      .set({ status: 'stopped' })
      .where('container_id', '=', containerId)
      .execute();
    
    return { success: true };
  });

  server.get('/list', async (request, reply) => {
    const { userId } = request.query as { userId?: string };
    
    const containers = await listSandboxes(userId);
    
    return { containers };
  });
};