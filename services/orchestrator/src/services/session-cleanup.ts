import { getDatabase } from '../lib/kysely';
import { getDocker } from './docker';

/**
 * Clean up sessions for containers that have been restarted or are no longer running
 */
export async function cleanupStaleSessions() {
  const db = getDatabase();
  const docker = getDocker();
  
  console.log('[Session Cleanup] Starting cleanup of stale sessions...');
  
  try {
    // Get all environments with their active sessions
    const environmentsWithSessions = await db
      .selectFrom('environments as e')
      .leftJoin('sessions as s', (join) => 
        join.onRef('e.id', '=', 's.environment_id')
          .on('s.status', '!=', 'dead')
      )
      .select([
        'e.id as environment_id',
        'e.container_id',
        's.id as session_id',
        's.tmux_session_name',
        's.status as session_status'
      ])
      .where('e.container_id', 'is not', null)
      .execute();
    
    // Group by container
    const containerMap = new Map<string, { environmentId: string; sessions: Array<{ id: string; tmuxName: string }> }>();
    
    for (const row of environmentsWithSessions) {
      if (!row.container_id) continue;
      
      if (!containerMap.has(row.container_id)) {
        containerMap.set(row.container_id, {
          environmentId: row.environment_id,
          sessions: []
        });
      }
      
      if (row.session_id && row.tmux_session_name) {
        containerMap.get(row.container_id)!.sessions.push({
          id: row.session_id,
          tmuxName: row.tmux_session_name
        });
      }
    }
    
    // Check each container
    for (const [containerId, data] of containerMap) {
      try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        
        if (!info.State.Running) {
          // Container is not running, mark all sessions as dead
          console.log(`[Session Cleanup] Container ${containerId} is not running, marking ${data.sessions.length} sessions as dead`);
          
          for (const session of data.sessions) {
            await db
              .updateTable('sessions')
              .set({ 
                status: 'dead',
                updated_at: new Date()
              })
              .where('id', '=', session.id)
              .execute();
          }
        } else if (data.sessions.length > 0) {
          // Container is running, check if tmux sessions exist
          try {
            const exec = await container.exec({
              Cmd: ['tmux', 'list-sessions', '-F', '#{session_name}'],
              AttachStdout: true,
              AttachStderr: true
            });
            
            const stream = await exec.start({ Detach: false });
            
            // Collect output
            let output = '';
            stream.on('data', (chunk: Buffer) => {
              output += chunk.toString();
            });
            
            // Wait for command to complete
            await new Promise((resolve) => {
              stream.on('end', resolve);
            });
            
            const activeTmuxSessions = output.split('\n').filter(s => s.trim());
            
            // Check each session
            for (const session of data.sessions) {
              if (!activeTmuxSessions.includes(session.tmuxName)) {
                console.log(`[Session Cleanup] Tmux session ${session.tmuxName} not found in container, marking session ${session.id} as dead`);
                
                await db
                  .updateTable('sessions')
                  .set({ 
                    status: 'dead',
                    updated_at: new Date()
                  })
                  .where('id', '=', session.id)
                  .execute();
              }
            }
          } catch (error) {
            console.warn(`[Session Cleanup] Failed to check tmux sessions in container ${containerId}:`, error);
          }
        }
      } catch (error) {
        // Container doesn't exist or can't be inspected
        console.log(`[Session Cleanup] Container ${containerId} not found, marking ${data.sessions.length} sessions as dead`);
        
        for (const session of data.sessions) {
          await db
            .updateTable('sessions')
            .set({ 
              status: 'dead',
              updated_at: new Date()
            })
            .where('id', '=', session.id)
            .execute();
        }
      }
    }
    
    console.log('[Session Cleanup] Cleanup completed');
  } catch (error) {
    console.error('[Session Cleanup] Error during cleanup:', error);
  }
}

/**
 * Check if a specific session's tmux session exists
 */
export async function verifySessionExists(sessionId: string): Promise<boolean> {
  const db = getDatabase();
  const docker = getDocker();
  
  try {
    const session = await db
      .selectFrom('sessions as s')
      .innerJoin('environments as e', 's.environment_id', 'e.id')
      .select([
        's.tmux_session_name',
        's.status',
        'e.container_id'
      ])
      .where('s.id', '=', sessionId)
      .executeTakeFirst();
    
    if (!session || !session.container_id || session.status === 'dead') {
      return false;
    }
    
    const container = docker.getContainer(session.container_id);
    const info = await container.inspect();
    
    if (!info.State.Running) {
      return false;
    }
    
    // Check if tmux session exists
    try {
      const exec = await container.exec({
        Cmd: ['tmux', 'has-session', '-t', session.tmux_session_name],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start({ Detach: false });
      
      // Wait for command to complete
      await new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      
      return true; // If command succeeds, session exists
    } catch {
      return false; // Command failed, session doesn't exist
    }
  } catch (error) {
    return false;
  }
}