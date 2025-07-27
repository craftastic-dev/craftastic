import { FastifyPluginAsync } from 'fastify';
import { createTerminalSession, getTerminalSession } from '../services/terminal';
import { getDatabase } from '../lib/kysely';

export const terminalRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  server.get('/ws/:sessionId', { websocket: true }, async (connection, request) => {
    const { sessionId } = request.params as { sessionId: string };
    const { environmentId } = request.query as { environmentId: string };

    if (!environmentId) {
      connection.socket.close(1008, 'Environment ID required');
      return;
    }

    try {
      // Get session and environment information
      const sessionWithEnv = await db
        .selectFrom('sessions as s')
        .innerJoin('environments as e', 's.environment_id', 'e.id')
        .select([
          's.id',
          's.environment_id',
          's.name',
          's.tmux_session_name',
          's.working_directory',
          's.status',
          's.created_at',
          's.updated_at',
          's.last_activity',
          'e.container_id'
        ])
        .where('s.id', '=', sessionId)
        .executeTakeFirst();

      if (!sessionWithEnv) {
        connection.socket.close(1008, 'Session not found');
        return;
      }

      const containerId = sessionWithEnv.container_id;

      if (!containerId) {
        connection.socket.close(1008, 'Environment container not available');
        return;
      }

      const terminal = await createTerminalSession(sessionId, containerId, sessionWithEnv.tmux_session_name);

      terminal.on('data', (data: string) => {
        connection.socket.send(JSON.stringify({
          type: 'output',
          data,
        }));
      });

      terminal.on('error', (error: Error) => {
        connection.socket.send(JSON.stringify({
          type: 'error',
          message: error.message,
        }));
      });

      terminal.on('close', () => {
        connection.socket.close();
      });

      connection.socket.on('message', (message: Buffer) => {
        try {
          const parsed = JSON.parse(message.toString());
          
          switch (parsed.type) {
            case 'input':
              terminal.write(parsed.data);
              break;
            case 'resize':
              terminal.resize(parsed.cols, parsed.rows);
              break;
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      connection.socket.on('close', () => {
        terminal.destroy();
      });

    } catch (error) {
      connection.socket.close(1011, 'Failed to create terminal session');
    }
  });
};