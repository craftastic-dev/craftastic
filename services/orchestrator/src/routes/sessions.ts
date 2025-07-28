import { FastifyPluginAsync } from 'fastify';
import { getDatabase } from '../lib/kysely';
import { Session } from './environments';

export const sessionRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  // Create new session
  server.post('/', async (request, reply) => {
    const { 
      environmentId, 
      name, 
      workingDirectory = '/workspace',
      sessionType = 'terminal',
      agentId 
    } = request.body as {
      environmentId: string;
      name?: string;
      workingDirectory?: string;
      sessionType?: 'terminal' | 'agent';
      agentId?: string;
    };

    try {
      // Verify environment exists
      const environment = await db
        .selectFrom('environments')
        .select('id')
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }

      // If it's an agent session, verify the agent exists
      if (sessionType === 'agent' && agentId) {
        const agent = await db
          .selectFrom('agents')
          .select('id')
          .where('id', '=', agentId)
          .executeTakeFirst();

        if (!agent) {
          reply.code(404).send({ error: 'Agent not found' });
          return;
        }
      }

      // Generate unique tmux session name
      const timestamp = Date.now();
      const tmuxSessionName = name ? `${name}-${timestamp}` : 
        sessionType === 'agent' ? `agent-${timestamp}` : `session-${timestamp}`;

      // Create session record
      const sessionData = await db
        .insertInto('sessions')
        .values({
          environment_id: environmentId,
          name,
          tmux_session_name: tmuxSessionName,
          working_directory: workingDirectory,
          status: 'inactive',
          session_type: sessionType,
          agent_id: agentId || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const session: Session = {
        id: sessionData.id,
        environmentId: sessionData.environment_id,
        name: sessionData.name,
        tmuxSessionName: sessionData.tmux_session_name,
        workingDirectory: sessionData.working_directory,
        status: sessionData.status,
        createdAt: sessionData.created_at.toISOString(),
        updatedAt: sessionData.updated_at.toISOString(),
        lastActivity: sessionData.last_activity?.toISOString(),
        agentId: sessionData.agent_id,
        sessionType: sessionData.session_type,
      };

      reply.send(session);
    } catch (error) {
      console.error('Error creating session:', error);
      reply.code(500).send({ error: 'Failed to create session' });
    }
  });

  // Get sessions for an environment
  server.get('/environment/:environmentId', async (request, reply) => {
    const { environmentId } = request.params as { environmentId: string };
    
    try {
      const sessions = await db
        .selectFrom('sessions')
        .selectAll()
        .where('environment_id', '=', environmentId)
        .orderBy('created_at', 'desc')
        .execute();
      
      const sessionList: Session[] = sessions.map(row => ({
        id: row.id,
        environmentId: row.environment_id,
        name: row.name,
        tmuxSessionName: row.tmux_session_name,
        workingDirectory: row.working_directory,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        lastActivity: row.last_activity?.toISOString(),
        agentId: row.agent_id,
        sessionType: row.session_type,
      }));
      
      reply.send({ sessions: sessionList });
    } catch (error) {
      console.error('Error fetching sessions:', error);
      reply.code(500).send({ error: 'Failed to fetch sessions' });
    }
  });

  // Get a specific session
  server.get('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    
    try {
      const row = await db
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();
      
      if (!row) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }

      const session: Session = {
        id: row.id,
        environmentId: row.environment_id,
        name: row.name,
        tmuxSessionName: row.tmux_session_name,
        workingDirectory: row.working_directory,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        lastActivity: row.last_activity?.toISOString(),
        agentId: row.agent_id,
        sessionType: row.session_type,
      };
      
      reply.send(session);
    } catch (error) {
      console.error('Error fetching session:', error);
      reply.code(500).send({ error: 'Failed to fetch session' });
    }
  });

  // Update session status
  server.patch('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { status } = request.body as { status: string };
    
    try {
      const row = await db
        .updateTable('sessions')
        .set({
          status: status as 'active' | 'inactive' | 'dead',
          updated_at: new Date(),
        })
        .where('id', '=', sessionId)
        .returningAll()
        .executeTakeFirst();
      
      if (!row) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }

      const session: Session = {
        id: row.id,
        environmentId: row.environment_id,
        name: row.name,
        tmuxSessionName: row.tmux_session_name,
        workingDirectory: row.working_directory,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        lastActivity: row.last_activity?.toISOString(),
        agentId: row.agent_id,
        sessionType: row.session_type,
      };
      
      reply.send(session);
    } catch (error) {
      console.error('Error updating session:', error);
      reply.code(500).send({ error: 'Failed to update session' });
    }
  });

  // Delete session
  server.delete('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    
    try {
      // Get session details first
      const session = await db
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();

      if (!session) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }

      // TODO: Kill the tmux session if it's running
      // This would require executing `tmux kill-session -t ${session.tmux_session_name}` 
      // in the environment's container

      // Delete session from database
      await db
        .deleteFrom('sessions')
        .where('id', '=', sessionId)
        .execute();

      reply.send({ success: true });
    } catch (error) {
      console.error('Error deleting session:', error);
      reply.code(500).send({ error: 'Failed to delete session' });
    }
  });
};