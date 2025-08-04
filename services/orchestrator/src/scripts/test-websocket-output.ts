#!/usr/bin/env tsx

import { createDatabase } from '../lib/kysely';
import { getDocker } from '../services/docker';

async function testWebSocketOutput() {
  const db = createDatabase();
  const docker = getDocker();
  
  console.log('🧪 Testing What WebSocket Should Output\n');
  
  const sessionId = '57745f2f-0e1c-4d77-b829-f6aa3eca8998'; // niall69 session ID
  
  try {
    // Get session details
    const session = await db
      .selectFrom('sessions as s')
      .innerJoin('environments as e', 's.environment_id', 'e.id')
      .select([
        's.tmux_session_name',
        's.working_directory',
        'e.container_id'
      ])
      .where('s.id', '=', sessionId)
      .executeTakeFirst();
    
    if (!session) {
      console.log('❌ Session not found');
      return;
    }
    
    const container = docker.getContainer(session.container_id!);
    
    console.log(`📋 Testing tmux attach for: ${session.tmux_session_name}`);
    console.log(`📂 Working directory: ${session.working_directory}`);
    console.log('');
    
    // Simulate what the WebSocket terminal service does
    const tmuxCommand = `
      if [ -d "${session.working_directory}" ]; then
        cd "${session.working_directory}" || exit 1
        if tmux has-session -t ${session.tmux_session_name} 2>/dev/null; then
          echo "[Terminal] Attaching to existing tmux session: ${session.tmux_session_name}"
          tmux attach-session -d -x -t ${session.tmux_session_name}
        else
          echo "[Terminal] Creating new tmux session: ${session.tmux_session_name}"
          tmux new-session -d -s ${session.tmux_session_name} -c "${session.working_directory}"
          tmux attach-session -d -x -t ${session.tmux_session_name}
        fi
      else
        echo "[Terminal] ERROR: Working directory does not exist: ${session.working_directory}"
        exit 1
      fi
    `;
    
    console.log('🚀 Executing tmux attach command...');
    
    const exec = await container.exec({
      Cmd: ['/bin/bash', '-c', tmuxCommand],
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      Tty: true,
      WorkingDir: session.working_directory
    });
    
    const stream = await exec.start({
      hijack: true,
      stdin: true
    });
    
    console.log('📡 Connected to exec stream');
    
    let dataReceived = false;
    let outputBuffer = '';
    
    // Set up data handler
    stream.on('data', (chunk: Buffer) => {
      dataReceived = true;
      const data = chunk.toString();
      outputBuffer += data;
      
      // Log first few chunks to see what we're getting
      if (outputBuffer.length < 500) {
        console.log(`📥 Received data (${chunk.length} bytes):`, JSON.stringify(data));
      }
    });
    
    // Send a simple command after a delay
    setTimeout(() => {
      console.log('📤 Sending test command: echo "Hello World"');
      stream.write('echo "Hello World"\n');
    }, 1000);
    
    // Send ls command
    setTimeout(() => {
      console.log('📤 Sending ls command');
      stream.write('ls -la\n');
    }, 2000);
    
    // Wait and then close
    setTimeout(() => {
      console.log('📊 Final output buffer length:', outputBuffer.length);
      if (outputBuffer.length > 0) {
        console.log('📋 Output preview (first 200 chars):');
        console.log(JSON.stringify(outputBuffer.substring(0, 200)));
      }
      
      if (!dataReceived) {
        console.log('❌ No data received from tmux session');
      } else {
        console.log('✅ Data was received from tmux session');
      }
      
      stream.destroy();
      process.exit(0);
    }, 4000);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testWebSocketOutput().catch(console.error);