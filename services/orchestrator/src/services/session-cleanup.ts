import { getDatabase } from '../lib/kysely';
import { getDocker } from './docker';
import type { Container } from 'dockerode';

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
      
      // Wait for command to complete - use a shorter timeout and poll for result
      let attempts = 0;
      const maxAttempts = 10; // 1 second total (100ms * 10)
      
      while (attempts < maxAttempts) {
        try {
          const result = await exec.inspect();
          if (result.Running === false) {
            // Command has finished, return based on exit code
            return result.ExitCode === 0; // Exit code 0 means session exists
          }
        } catch (inspectError) {
          // If inspect fails, wait a bit and try again
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      // If we get here, command took too long - assume session doesn't exist
      return false;
    } catch {
      return false; // Command failed, session doesn't exist
    }
  } catch (error) {
    return false;
  }
}

/**
 * Kill a specific tmux session in a container
 */
export async function killTmuxSession(containerId: string, tmuxSessionName: string): Promise<void> {
  try {
    const docker = getDocker();
    const container = docker.getContainer(containerId);
    
    // Check if container is running
    const containerInfo = await container.inspect();
    if (!containerInfo.State.Running) {
      console.log(`[Session Cleanup] Container ${containerId} not running, skipping tmux cleanup`);
      return;
    }

    console.log(`[Session Cleanup] Killing tmux session ${tmuxSessionName} in container ${containerId}`);
    
    const exec = await container.exec({
      Cmd: ['tmux', 'kill-session', '-t', tmuxSessionName],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const stream = await exec.start({ hijack: true });
    
    await new Promise<void>((resolve) => {
      stream.on('end', () => resolve());
      stream.on('error', (err: Error) => {
        console.error(`[Session Cleanup] Error killing tmux session: ${err.message}`);
        resolve();
      });
    });
    
    console.log(`[Session Cleanup] Successfully killed tmux session ${tmuxSessionName}`);
  } catch (error) {
    console.error(`[Session Cleanup] Failed to kill tmux session ${tmuxSessionName}:`, error);
  }
}

/**
 * Clean up all tmux sessions for a given environment
 */
export async function cleanupEnvironmentSessions(environmentId: string, containerId: string): Promise<void> {
  const db = getDatabase();
  
  try {
    // Get all sessions for this environment
    const sessions = await db
      .selectFrom('sessions')
      .select(['id', 'tmux_session_name'])
      .where('environment_id', '=', environmentId)
      .execute();

    // Kill all tmux sessions
    for (const session of sessions) {
      if (session.tmux_session_name) {
        await killTmuxSession(containerId, session.tmux_session_name);
      }
    }

    // Mark all sessions as dead in the database
    await db
      .updateTable('sessions')
      .set({ 
        status: 'dead',
        updated_at: new Date() 
      })
      .where('environment_id', '=', environmentId)
      .execute();
      
    console.log(`[Session Cleanup] Cleaned up ${sessions.length} sessions for environment ${environmentId}`);
  } catch (error) {
    console.error(`[Session Cleanup] Failed to cleanup environment sessions:`, error);
  }
}

/**
 * Find and clean up orphaned tmux sessions in a container
 */
export async function cleanupOrphanedTmuxSessions(containerId: string): Promise<void> {
  const db = getDatabase();
  
  try {
    const docker = getDocker();
    const container = docker.getContainer(containerId);
    
    // Check if container is running
    const containerInfo = await container.inspect();
    if (!containerInfo.State.Running) {
      return;
    }

    // List all tmux sessions
    const listExec = await container.exec({
      Cmd: ['/bin/bash', '-c', 'tmux list-sessions -F "#{session_name}" 2>/dev/null || true'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const listStream = await listExec.start({ hijack: true });
    let sessionsList = '';
    
    await new Promise<void>((resolve) => {
      listStream.on('data', (chunk: Buffer) => {
        sessionsList += chunk.toString();
      });
      listStream.on('end', () => resolve());
    });
    
    const tmuxSessions = sessionsList
      .split('\n')
      .filter(s => s.trim())
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.includes('\x00')); // Filter out sessions with null bytes
    
    if (tmuxSessions.length === 0) {
      return;
    }

    // Get all known tmux session names from database  
    const dbSessions = await db
      .selectFrom('sessions')
      .select(['tmux_session_name'])
      .where('tmux_session_name', 'in', tmuxSessions)
      .execute();
    
    const knownSessions = new Set(dbSessions.map(s => s.tmux_session_name).filter(Boolean));
    
    // Find orphaned sessions
    const orphanedSessions = tmuxSessions.filter(session => !knownSessions.has(session));
    
    if (orphanedSessions.length > 0) {
      console.log(`[Session Cleanup] Found ${orphanedSessions.length} orphaned tmux sessions in container ${containerId}: ${orphanedSessions.join(', ')}`);
      
      // Kill orphaned sessions
      for (const orphanSession of orphanedSessions) {
        await killTmuxSession(containerId, orphanSession);
      }
    }
  } catch (error) {
    console.error(`[Session Cleanup] Failed to cleanup orphaned tmux sessions:`, error);
  }
}

/**
 * Periodic cleanup job for all environments
 */
let cleanupInterval: NodeJS.Timeout | null = null;

export function startPeriodicCleanup(intervalMs: number = 5 * 60 * 1000): void { // Default: 5 minutes
  if (cleanupInterval) {
    console.log('[Session Cleanup] Periodic cleanup already running');
    return;
  }
  
  console.log(`[Session Cleanup] Starting periodic cleanup (every ${intervalMs / 1000}s)`);
  
  // Run immediately
  cleanupStaleSessions().catch(console.error);
  
  // Then run periodically
  cleanupInterval = setInterval(() => {
    cleanupStaleSessions().catch(console.error);
  }, intervalMs);
}

export function stopPeriodicCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[Session Cleanup] Stopped periodic cleanup');
  }
}