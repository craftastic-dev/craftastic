import { FastifyPluginAsync } from 'fastify';
import { createTerminalSession, getTerminalSession } from '../services/terminal';
import { getDatabase } from '../lib/kysely';
import { verifySessionExists } from '../services/session-cleanup';

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
          's.session_type',
          's.agent_id',
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
      
      // Verify the session's tmux session still exists
      const sessionExists = await verifySessionExists(sessionId);
      if (!sessionExists && sessionWithEnv.status !== 'dead') {
        console.log(`[Terminal WebSocket] Session ${sessionId} tmux session no longer exists, marking as dead`);
        await db
          .updateTable('sessions')
          .set({ 
            status: 'dead',
            updated_at: new Date()
          })
          .where('id', '=', sessionId)
          .execute();
      }

      // Handle agent sessions differently
      if (sessionWithEnv.session_type === 'agent') {
        if (!sessionWithEnv.agent_id) {
          connection.socket.close(1008, 'Agent session requires agent ID');
          return;
        }

        // Get agent information and credentials
        const agent = await db
          .selectFrom('agents')
          .select(['id', 'name', 'type'])
          .where('id', '=', sessionWithEnv.agent_id)
          .executeTakeFirst();

        if (!agent) {
          connection.socket.close(1008, 'Agent not found');
          return;
        }

        // For now, send a message that we're starting the agent
        // TODO: Implement actual agent process startup
        connection.socket.send(JSON.stringify({
          type: 'output',
          data: `\r\n🤖 Starting ${agent.name} (${agent.type}) agent...\r\n`
        }));

        connection.socket.send(JSON.stringify({
          type: 'output',
          data: `📋 Agent Session Details:\r\n`
        }));

        connection.socket.send(JSON.stringify({
          type: 'output',
          data: `   Name: ${agent.name}\r\n`
        }));

        connection.socket.send(JSON.stringify({
          type: 'output',
          data: `   Type: ${agent.type}\r\n`
        }));

        connection.socket.send(JSON.stringify({
          type: 'output',
          data: `   Working Directory: ${sessionWithEnv.working_directory}\r\n`
        }));

        connection.socket.send(JSON.stringify({
          type: 'output',
          data: `\r\n🚧 Agent process startup not yet implemented.\r\n`
        }));

        connection.socket.send(JSON.stringify({
          type: 'output',
          data: `💡 This will eventually start the actual agent process with loaded credentials.\r\n\r\n`
        }));

        // Keep connection alive for demonstration
        connection.socket.on('message', (message: Buffer) => {
          try {
            const parsed = JSON.parse(message.toString());
            if (parsed.type === 'input') {
              connection.socket.send(JSON.stringify({
                type: 'output',
                data: `Agent received: ${parsed.data}`
              }));
            }
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        });

        return;
      }

      // Regular session
      let terminal;
      try {
        terminal = await createTerminalSession(
          sessionId, 
          containerId, 
          sessionWithEnv.tmux_session_name,
          sessionWithEnv.working_directory
        );
      } catch (error) {
        console.error(`[Terminal WebSocket] Failed to create terminal session:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error creating terminal session';
        
        // Send error to client
        connection.socket.send(JSON.stringify({
          type: 'error',
          message: `Failed to create terminal session: ${errorMessage}`,
        }));
        
        // Close connection after a delay to ensure message is sent
        setTimeout(() => {
          connection.socket.close(1011, errorMessage);
        }, 100);
        
        return;
      }

      terminal.on('data', (data: string) => {
        connection.socket.send(JSON.stringify({
          type: 'output',
          data,
        }));
      });

      terminal.on('error', (error: Error) => {
        console.error(`[Terminal WebSocket] Terminal error for session ${sessionId}:`, error);
        connection.socket.send(JSON.stringify({
          type: 'error',
          message: error.message,
        }));
      });

      terminal.on('close', () => {
        console.log(`[Terminal WebSocket] Terminal closed for session ${sessionId}`);
        connection.socket.close(1000, 'Terminal session ended');
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
      console.error(`Failed to create terminal session for ${sessionId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      connection.socket.close(1011, `Failed to create session: ${errorMessage}`);
    }
  });
};