#!/usr/bin/env tsx

import { createDatabase } from '../lib/kysely';
import { getDocker } from '../services/docker';

async function debugTerminalConnection() {
  const db = createDatabase();
  const docker = getDocker();
  
  console.log('🔍 Debugging Terminal Connection for niall69\n');
  
  const sessionId = '57745f2f-0e1c-4d77-b829-f6aa3eca8998'; // niall69 session ID
  
  try {
    // Get session details
    const session = await db
      .selectFrom('sessions as s')
      .innerJoin('environments as e', 's.environment_id', 'e.id')
      .select([
        's.id',
        's.name',
        's.tmux_session_name',
        's.working_directory',
        's.status',
        'e.container_id'
      ])
      .where('s.id', '=', sessionId)
      .executeTakeFirst();
    
    if (!session) {
      console.log('❌ Session not found');
      return;
    }
    
    console.log('📋 Session Details:');
    console.log(`   Name: ${session.name}`);
    console.log(`   Tmux Session: ${session.tmux_session_name}`);
    console.log(`   Working Directory: ${session.working_directory}`);
    console.log(`   Status: ${session.status}`);
    console.log(`   Container: ${session.container_id}`);
    console.log('');
    
    if (!session.container_id) {
      console.log('❌ No container ID');
      return;
    }
    
    const container = docker.getContainer(session.container_id);
    
    // Test 1: Check container status
    console.log('🧪 Test 1: Container Status');
    const info = await container.inspect();
    console.log(`   Running: ${info.State.Running}`);
    console.log(`   Status: ${info.State.Status}`);
    console.log('');
    
    if (!info.State.Running) {
      console.log('❌ Container not running');
      return;
    }
    
    // Test 2: List tmux sessions
    console.log('🧪 Test 2: List Tmux Sessions');
    const listExec = await container.exec({
      Cmd: ['tmux', 'list-sessions', '-F', '#{session_name}:#{session_attached}'],
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
      setTimeout(() => resolve(), 3000);
    });
    
    const sessions = tmuxOutput.split('\n').filter(s => s.trim());
    console.log(`   Found ${sessions.length} tmux sessions:`);
    sessions.forEach(s => console.log(`   - ${s}`));
    console.log('');
    
    // Test 3: Check specific tmux session
    console.log('🧪 Test 3: Check Target Session');
    const targetSession = sessions.find(s => s.startsWith(session.tmux_session_name));
    if (targetSession) {
      console.log(`   ✅ Found: ${targetSession}`);
    } else {
      console.log(`   ❌ Session ${session.tmux_session_name} not found`);
      console.log('   📝 Attempting to recreate session...');
      
      // Try to create the session
      const createExec = await container.exec({
        Cmd: ['tmux', 'new-session', '-d', '-s', session.tmux_session_name, '-c', session.working_directory || '/workspace'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const createStream = await createExec.start({ Detach: false });
      
      let createOutput = '';
      createStream.on('data', (chunk: Buffer) => {
        createOutput += chunk.toString();
      });
      
      await new Promise<void>((resolve) => {
        createStream.on('end', () => resolve());
        setTimeout(() => resolve(), 2000);
      });
      
      console.log(`   Create output: ${createOutput.trim() || 'No output'}`);
    }
    
    // Test 4: Test simple exec
    console.log('🧪 Test 4: Simple Exec Test');
    const simpleExec = await container.exec({
      Cmd: ['echo', 'Hello from container'],
      AttachStdout: true,
      AttachStderr: true
    });
    
    const simpleStream = await simpleExec.start({ Detach: false });
    
    let simpleOutput = '';
    simpleStream.on('data', (chunk: Buffer) => {
      simpleOutput += chunk.toString();
    });
    
    await new Promise<void>((resolve) => {
      simpleStream.on('end', () => resolve());
      setTimeout(() => resolve(), 2000);
    });
    
    console.log(`   Simple exec output: "${simpleOutput.trim()}"`);
    console.log('');
    
    // Test 5: Test tmux attach simulation
    console.log('🧪 Test 5: Test Tmux Attach');
    const attachCmd = session.working_directory 
      ? `cd "${session.working_directory}" && tmux has-session -t ${session.tmux_session_name} && echo "Session exists" || echo "Session missing"`
      : `tmux has-session -t ${session.tmux_session_name} && echo "Session exists" || echo "Session missing"`;
    
    const attachExec = await container.exec({
      Cmd: ['bash', '-c', attachCmd],
      AttachStdout: true,
      AttachStderr: true
    });
    
    const attachStream = await attachExec.start({ Detach: false });
    
    let attachOutput = '';
    attachStream.on('data', (chunk: Buffer) => {
      attachOutput += chunk.toString();
    });
    
    await new Promise<void>((resolve) => {
      attachStream.on('end', () => resolve());
      setTimeout(() => resolve(), 2000);
    });
    
    console.log(`   Attach test output: "${attachOutput.trim()}"`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugTerminalConnection().catch(console.error);