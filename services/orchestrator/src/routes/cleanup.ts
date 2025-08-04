import { FastifyPluginAsync } from 'fastify';
import { 
  cleanupStaleSessions, 
  cleanupOrphanedTmuxSessions,
  cleanupEnvironmentSessions 
} from '../services/session-cleanup';
import { getDatabase } from '../lib/kysely';

export const cleanupRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  // Manual cleanup endpoint - requires authentication
  server.post('/cleanup/sessions', async (request, reply) => {
    try {
      await cleanupStaleSessions();
      
      // Get statistics
      const stats = await db
        .selectFrom('sessions')
        .select([
          db.fn.count<number>('id').as('total'),
          db.fn.sum<number>(db.case().when('status', '=', 'active').then(1).else(0).end()).as('active'),
          db.fn.sum<number>(db.case().when('status', '=', 'inactive').then(1).else(0).end()).as('inactive'),
          db.fn.sum<number>(db.case().when('status', '=', 'dead').then(1).else(0).end()).as('dead')
        ])
        .executeTakeFirst();
      
      reply.send({
        success: true,
        message: 'Session cleanup completed',
        stats: {
          total: Number(stats?.total || 0),
          active: Number(stats?.active || 0),
          inactive: Number(stats?.inactive || 0),
          dead: Number(stats?.dead || 0)
        }
      });
    } catch (error) {
      console.error('Manual cleanup failed:', error);
      reply.code(500).send({ error: 'Failed to run cleanup' });
    }
  });

  // Cleanup orphaned tmux sessions in a specific container
  server.post('/cleanup/container/:containerId', async (request, reply) => {
    const { containerId } = request.params as { containerId: string };
    
    try {
      await cleanupOrphanedTmuxSessions(containerId);
      reply.send({ 
        success: true, 
        message: `Cleaned up orphaned tmux sessions in container ${containerId}` 
      });
    } catch (error) {
      console.error('Container cleanup failed:', error);
      reply.code(500).send({ error: 'Failed to cleanup container sessions' });
    }
  });

  // Cleanup all sessions for an environment
  server.post('/cleanup/environment/:environmentId', async (request, reply) => {
    const { environmentId } = request.params as { environmentId: string };
    
    try {
      // Get environment details
      const environment = await db
        .selectFrom('environments')
        .select(['container_id'])
        .where('id', '=', environmentId)
        .executeTakeFirst();
        
      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }
      
      if (!environment.container_id) {
        reply.code(400).send({ error: 'Environment has no container' });
        return;
      }
      
      await cleanupEnvironmentSessions(environmentId, environment.container_id);
      reply.send({ 
        success: true, 
        message: `Cleaned up all sessions for environment ${environmentId}` 
      });
    } catch (error) {
      console.error('Environment cleanup failed:', error);
      reply.code(500).send({ error: 'Failed to cleanup environment sessions' });
    }
  });
};