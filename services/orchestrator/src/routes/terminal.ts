import { FastifyPluginAsync } from 'fastify';
import { createTerminalSession, getTerminalSession } from '../services/terminal';
import { getDatabase } from '../lib/kysely';
import { verifySessionExists } from '../services/session-cleanup';
import { getDocker } from '../services/docker';

export const terminalRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  console.log('[routes/terminal.ts] Terminal routes registered');
  
  server.get('/ws/:sessionId', { websocket: true }, async (connection, request) => {
    console.log('[routes/terminal.ts] ========== NEW WEBSOCKET CONNECTION ATTEMPT ==========');
    const { sessionId } = request.params as { sessionId: string };
    const { environmentId, token } = request.query as { environmentId: string; token?: string };

    // Authenticate WebSocket connection
    try {
      if (token) {
        // Verify the JWT token
        const decoded = await request.server.jwt.verify(token);
        console.log('[routes/terminal.ts] WebSocket authenticated for user:', decoded.sub);
        // Store user info for later use if needed
        (request as any).user = decoded;
      } else {
        console.error('[routes/terminal.ts] No authentication token provided');
        connection.socket.close(1008, 'Authentication required');
        return;
      }
    } catch (error) {
      console.error('[routes/terminal.ts] Authentication failed:', error);
      connection.socket.close(1008, 'Invalid authentication token');
      return;
    }

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
      
      console.log('[Terminal WebSocket] Session details:', {
        sessionId,
        sessionType: sessionWithEnv.session_type,
        agentId: sessionWithEnv.agent_id,
        workingDirectory: sessionWithEnv.working_directory,
        tmuxSessionName: sessionWithEnv.tmux_session_name,
        status: sessionWithEnv.status,
        name: sessionWithEnv.name
      });
      
      // Verify the user owns this environment
      const environment = await db
        .selectFrom('environments')
        .select(['user_id'])
        .where('id', '=', environmentId)
        .executeTakeFirst();
        
      if (!environment || environment.user_id !== (request as any).user.sub) {
        console.error('[routes/terminal.ts] User does not have access to this environment');
        connection.socket.close(1008, 'Access denied');
        return;
      }

      const containerId = sessionWithEnv.container_id;

      if (!containerId) {
        connection.socket.close(1008, 'Environment container not available');
        return;
      }
      
      // Get Docker instance for debugging
      const docker = getDocker();
      
      // Verify container is actually running before attempting to create session
      try {
        const container = docker.getContainer(containerId);
        const containerInfo = await container.inspect();
        
        if (!containerInfo.State.Running) {
          console.error(`[Terminal WebSocket] Container ${containerId} is not running`);
          connection.socket.close(1008, 'Container is not running');
          return;
        }
      } catch (error) {
        console.error(`[Terminal WebSocket] Failed to inspect container ${containerId}:`, error);
        connection.socket.close(1008, 'Container not accessible');
        return;
      }
      
      console.log(`[Terminal WebSocket] Creating terminal session for ${sessionWithEnv.name} (${sessionId})`);

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

      // Regular terminal session
      console.log(`[Terminal WebSocket] Creating regular terminal session...`);
      
      let terminal;
      try {
        terminal = await createTerminalSession(
          sessionId, 
          containerId, 
          sessionWithEnv.tmux_session_name,
          sessionWithEnv.working_directory
        );
        console.log(`[Terminal WebSocket] Terminal session created successfully`);
      } catch (error) {
        console.error(`[Terminal WebSocket] Failed to create terminal session:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error creating terminal session';
        
        // Mark session as dead if terminal creation fails
        try {
          await db
            .updateTable('sessions')
            .set({ 
              status: 'dead',
              updated_at: new Date()
            })
            .where('id', '=', sessionId)
            .execute();
        } catch (dbError) {
          console.error(`[Terminal WebSocket] Failed to update session status:`, dbError);
        }
        
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

      // Update session status to active after successful terminal creation
      try {
        await db
          .updateTable('sessions')
          .set({ 
            status: 'active',
            last_activity: new Date(),
            updated_at: new Date()
          })
          .where('id', '=', sessionId)
          .execute();
        console.log(`[Terminal WebSocket] Updated session ${sessionId} status to 'active'`);
      } catch (dbError) {
        console.error(`[Terminal WebSocket] Failed to update session status to active:`, dbError);
      }

      // Set up terminal event handlers
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
      
      // Send initial resize to ensure proper terminal size
      connection.socket.send(JSON.stringify({
        type: 'request-resize'
      }));

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

      connection.socket.on('close', async () => {
        console.log(`[Terminal WebSocket] Connection closed for session ${sessionId}`);
        
        if (terminal && typeof terminal.destroy === 'function') {
          terminal.destroy();
        }
        
        // Update session status to inactive after WebSocket closes
        try {
          await db
            .updateTable('sessions')
            .set({ 
              status: 'inactive',
              updated_at: new Date()
            })
            .where('id', '=', sessionId)
            .execute();
          console.log(`[Terminal WebSocket] Updated session ${sessionId} status to 'inactive'`);
        } catch (dbError) {
          console.error(`[Terminal WebSocket] Failed to update session status to inactive:`, dbError);
        }
      });

    } catch (error) {
      console.error(`[routes/terminal.ts] CRITICAL ERROR - Failed to handle WebSocket for ${sessionId}:`, error);
      if (error instanceof Error) {
        console.error('[routes/terminal.ts] Error stack:', error.stack);
        console.error('[routes/terminal.ts] Error message:', error.message);
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      try {
        connection.socket.close(1011, `Failed to create session: ${errorMessage}`);
      } catch (closeError) {
        console.error('[routes/terminal.ts] Failed to close socket:', closeError);
      }
    }
  });
  
  console.log('[routes/terminal.ts] WebSocket route handler registered successfully');
};