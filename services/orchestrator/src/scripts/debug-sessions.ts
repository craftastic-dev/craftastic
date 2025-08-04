#!/usr/bin/env tsx

import { createDatabase } from '../lib/kysely';
import { getDocker } from '../services/docker';

async function debugSessions() {
  const db = createDatabase();
  const docker = getDocker();
  
  console.log('🔍 Debugging Session Status\n');
  
  try {
    // Get all sessions with their environment info
    const sessions = await db
      .selectFrom('sessions as s')
      .innerJoin('environments as e', 's.environment_id', 'e.id')
      .select([
        's.id',
        's.name',
        's.tmux_session_name',
        's.status as db_status',
        'e.container_id',
        'e.name as env_name',
        'e.status as env_status'
      ])
      .where('s.status', '!=', 'dead')
      .execute();
    
    console.log(`Found ${sessions.length} active sessions:\n`);
    
    for (const session of sessions) {
      console.log(`📋 Session: ${session.name || session.id.substring(0, 8)}`);
      console.log(`   ID: ${session.id}`);
      console.log(`   Environment: ${session.env_name} (${session.env_status})`);
      console.log(`   Database Status: ${session.db_status}`);
      console.log(`   Tmux Session: ${session.tmux_session_name}`);
      console.log(`   Container ID: ${session.container_id}`);
      
      if (!session.container_id) {
        console.log(`   ❌ No container ID - session should be marked as dead`);
        console.log('');
        continue;
      }
      
      // Check Docker container status
      try {
        const container = docker.getContainer(session.container_id);
        const containerInfo = await container.inspect();
        
        console.log(`   🐳 Container Status: ${containerInfo.State.Status}`);
        console.log(`   🐳 Container Running: ${containerInfo.State.Running}`);
        
        if (!containerInfo.State.Running) {
          console.log(`   ❌ Container not running - session should be marked as dead`);
          console.log('');
          continue;
        }
        
        // Check if tmux session exists
        try {
          console.log(`   🔍 Checking tmux session: ${session.tmux_session_name}`);
          
          const listExec = await container.exec({
            Cmd: ['tmux', 'list-sessions', '-F', '#{session_name}'],
            AttachStdout: true,
            AttachStderr: true
          });
          
          const listStream = await listExec.start({ Detach: false });
          
          let tmuxOutput = '';
          listStream.on('data', (chunk: Buffer) => {
            tmuxOutput += chunk.toString();
          });
          
          await new Promise<void>((resolve) => {
            listStream.on('end', () => resolve());
            setTimeout(() => resolve(), 3000); // Timeout after 3 seconds
          });
          
          const activeSessions = tmuxOutput.split('\n').filter(s => s.trim());
          console.log(`   📝 Active tmux sessions: [${activeSessions.join(', ')}]`);
          
          const sessionExists = activeSessions.includes(session.tmux_session_name);
          console.log(`   ✅ Session ${session.tmux_session_name} exists: ${sessionExists}`);
          
          if (!sessionExists) {
            console.log(`   ❌ Tmux session not found - session should be marked as dead`);
          } else {
            // Check if there are any active connections
            try {
              const hasSessionExec = await container.exec({
                Cmd: ['tmux', 'list-clients', '-t', session.tmux_session_name],
                AttachStdout: true,
                AttachStderr: true
              });
              
              const hasSessionStream = await hasSessionExec.start({ Detach: false });
              
              let clientsOutput = '';
              hasSessionStream.on('data', (chunk: Buffer) => {
                clientsOutput += chunk.toString();
              });
              
              await new Promise<void>((resolve) => {
                hasSessionStream.on('end', () => resolve());
                setTimeout(() => resolve(), 2000);
              });
              
              const activeClients = clientsOutput.split('\n').filter(s => s.trim());
              console.log(`   👥 Active clients: ${activeClients.length}`);
              
              if (activeClients.length > 0) {
                console.log(`   ✅ Should be 'active' (has ${activeClients.length} clients)`);
              } else {
                console.log(`   ⚠️  Should be 'inactive' (no active clients)`);
              }
            } catch (clientError) {
              console.log(`   ⚠️  Could not check clients: ${clientError.message}`);
            }
          }
          
        } catch (tmuxError) {
          console.log(`   ❌ Error checking tmux: ${tmuxError.message}`);
        }
        
      } catch (dockerError) {
        console.log(`   ❌ Container not found or error: ${dockerError.message}`);
        console.log(`   ❌ Session should be marked as dead`);
      }
      
      console.log('');
    }
    
  } catch (error) {
    console.error('Error debugging sessions:', error);
  }
}

debugSessions().catch(console.error);