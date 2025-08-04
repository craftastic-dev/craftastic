import { getDocker } from './docker';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

// Helper function to clean terminal output for logging
function cleanTerminalOutput(data: string): string {
  // Remove ANSI escape sequences and control characters
  return data
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape sequences
    .replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control characters except \t, \n, \r
    .trim();
}

export interface TerminalSession extends EventEmitter {
  id: string;
  containerId: string;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
  destroy: () => void;
}

const sessions = new Map<string, TerminalSession>();

export async function createTerminalSession(
  sessionId: string,
  containerId: string,
  tmuxSessionName?: string,
  workingDirectory?: string
): Promise<TerminalSession> {
  console.log('[terminal.ts] createTerminalSession called:', {
    sessionId,
    containerId,
    tmuxSessionName,
    workingDirectory
  });
  
  const docker = getDocker();
  
  // First verify container exists and is running
  console.log('[terminal.ts] Validating container:', containerId);
  try {
    const container = docker.getContainer(containerId);
    const containerInfo = await container.inspect();
    
    console.log('[terminal.ts] Container state:', {
      running: containerInfo.State.Running,
      status: containerInfo.State.Status,
      exitCode: containerInfo.State.ExitCode,
      error: containerInfo.State.Error
    });
    
    if (!containerInfo.State.Running) {
      throw new Error(`Container ${containerId} is not running (status: ${containerInfo.State.Status})`);
    }
  } catch (error) {
    console.error(`[terminal.ts] Container ${containerId} validation failed:`, error);
    throw new Error(`Container not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  // Use tmux for persistent sessions
  // IMPORTANT: Always use the provided tmux session name from the database
  if (!tmuxSessionName) {
    throw new Error(`No tmux session name provided for session ${sessionId}`);
  }
  const actualTmuxName = tmuxSessionName;
  
  // Before creating/attaching, clean up any other sessions with the same name prefix
  const sessionPrefix = actualTmuxName.split('-')[0]; // Get the name without timestamp
  console.log(`[Terminal] Checking for duplicate sessions with prefix: ${sessionPrefix}`);
  
  // Clean up orphaned tmux sessions with the same prefix
  try {
    const container = docker.getContainer(containerId);
    
    // List all tmux sessions
    const listExec = await container.exec({
      Cmd: ['/bin/bash', '-c', 'tmux list-sessions -F "#{session_name}" 2>/dev/null || true'],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const listStream = await listExec.start({ hijack: true });
    let sessionsList = '';
    
    await new Promise((resolve) => {
      listStream.on('data', (chunk: Buffer) => {
        sessionsList += chunk.toString();
      });
      listStream.on('end', resolve);
    });
    
    const existingSessions = sessionsList.split('\n').filter(s => s.trim());
    const orphanedSessions = existingSessions.filter(s => 
      s.startsWith(sessionPrefix + '-') && s !== actualTmuxName
    );
    
    if (orphanedSessions.length > 0) {
      console.log(`[Terminal] Found ${orphanedSessions.length} orphaned sessions to clean up:`, orphanedSessions);
      
      for (const orphanSession of orphanedSessions) {
        try {
          const killExec = await container.exec({
            Cmd: ['tmux', 'kill-session', '-t', orphanSession],
            AttachStdout: true,
            AttachStderr: true,
          });
          
          const killStream = await killExec.start({ hijack: true });
          await new Promise((resolve) => {
            killStream.on('end', resolve);
            killStream.on('error', resolve);
          });
          
          console.log(`[Terminal] Cleaned up orphaned session: ${orphanSession}`);
        } catch (err) {
          console.error(`[Terminal] Failed to clean up orphaned session ${orphanSession}:`, err);
        }
      }
    }
  } catch (error) {
    console.log(`[Terminal] Could not check for orphaned sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    // Continue anyway - this is just cleanup
  }
  
  // Build command with working directory if provided
  let tmuxCommand: string;
  if (workingDirectory) {
    console.log(`[Terminal] Creating/attaching session ${sessionId} in working directory: ${workingDirectory}`);
    console.log(`[Terminal] Using tmux session name: ${actualTmuxName}`);
    // First check if directory exists, then create or attach to tmux session
    tmuxCommand = `
      if [ -d "${workingDirectory}" ]; then
        cd "${workingDirectory}" || exit 1
        if tmux has-session -t ${actualTmuxName} 2>/dev/null; then
          echo "[Terminal] Attaching to existing tmux session: ${actualTmuxName}"
          # Use -x to create a new window size and force detach of other clients
          if ! tmux attach-session -d -x -t ${actualTmuxName}; then
            echo "[Terminal] ERROR: Failed to attach to tmux session ${actualTmuxName}"
            # Try to list sessions to debug
            echo "[Terminal] Current tmux sessions:"
            tmux list-sessions
            exit 1
          fi
        else
          echo "[Terminal] Creating new tmux session: ${actualTmuxName}"
          if ! tmux new-session -d -s ${actualTmuxName} -c "${workingDirectory}"; then
            echo "[Terminal] ERROR: Failed to create tmux session ${actualTmuxName}"
            exit 1
          fi
          # Immediately attach after creation
          if ! tmux attach-session -d -x -t ${actualTmuxName}; then
            echo "[Terminal] ERROR: Failed to attach to newly created tmux session ${actualTmuxName}"
            exit 1
          fi
        fi
      else
        echo "[Terminal] ERROR: Working directory does not exist: ${workingDirectory}"
        exit 1
      fi
    `;
  } else {
    console.log(`[Terminal] Creating/attaching session ${sessionId} in default directory`);
    console.log(`[Terminal] Using tmux session name: ${actualTmuxName}`);
    tmuxCommand = `
      if tmux has-session -t ${actualTmuxName} 2>/dev/null; then
        echo "[Terminal] Attaching to existing tmux session: ${actualTmuxName}"
        # Use -x to create a new window size and force detach of other clients
        if ! tmux attach-session -d -x -t ${actualTmuxName}; then
          echo "[Terminal] ERROR: Failed to attach to tmux session ${actualTmuxName}"
          # Try to list sessions to debug
          echo "[Terminal] Current tmux sessions:"
          tmux list-sessions
          exit 1
        fi
      else
        echo "[Terminal] Creating new tmux session: ${actualTmuxName}"
        if ! tmux new-session -d -s ${actualTmuxName}; then
          echo "[Terminal] ERROR: Failed to create tmux session ${actualTmuxName}"
          exit 1
        fi
        # Immediately attach after creation
        if ! tmux attach-session -d -x -t ${actualTmuxName}; then
          echo "[Terminal] ERROR: Failed to attach to newly created tmux session ${actualTmuxName}"
          exit 1
        fi
      fi
    `;
  }
  
  // Enable verbose logging to debug blank terminal issue
  console.log(`[Terminal] Full command to execute: ${tmuxCommand}`);
  
  // First, let's test with a simple command to verify the Docker exec works
  const testCommand = workingDirectory 
    ? `cd "${workingDirectory}" && echo "Directory changed successfully" && pwd`
    : `echo "No working directory" && pwd`;
  
  console.log(`[Terminal] Testing with simple command first: ${testCommand}`);
  
  // DEBUG: Disable debug mode - use actual tmux command
  const DEBUG_MODE = false;
  const commandToRun = DEBUG_MODE ? testCommand : tmuxCommand;
  
  const tmuxCmd = ['/bin/bash', '-c', commandToRun];
  // console.log(`[Terminal] Docker exec command array:`, tmuxCmd);
  
  if (DEBUG_MODE) {
    console.warn(`[Terminal] DEBUG MODE ENABLED - Running test command instead of tmux`);
  }

  let exec;
  let retries = 3;
  let lastError: Error | null = null;
  
  // Retry logic for exec creation
  while (retries > 0) {
    try {
      console.log(`[terminal.ts] Creating Docker exec (attempt ${4 - retries}/3)...`);
      console.log('[terminal.ts] Exec config:', {
        cmd: tmuxCmd,
        env: ['TERM=xterm-256color', 'LANG=en_US.UTF-8', 'LC_ALL=en_US.UTF-8', 'COLORTERM=truecolor']
      });
      
      exec = await docker.getContainer(containerId).exec({
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: tmuxCmd,
        Env: [
          'TERM=xterm-256color',   // Match frontend xterm.js terminal type
          'LANG=en_US.UTF-8',      // Set UTF-8 encoding
          'LC_ALL=en_US.UTF-8',
          'COLORTERM=truecolor'    // Enable true color support
        ]
      });
      console.log('[terminal.ts] Docker exec created successfully');
      break; // Success, exit retry loop
    } catch (error) {
      lastError = error as Error;
      retries--;
      console.error(`[terminal.ts] Failed to create exec for container ${containerId} (${retries} retries left):`, error);
      if (error instanceof Error) {
        console.error('[terminal.ts] Error details:', {
          message: error.message,
          stack: error.stack
        });
      }
      if (retries > 0) {
        console.log('[terminal.ts] Waiting 500ms before retry...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait before retry
      }
    }
  }
  
  if (!exec) {
    throw new Error(`Failed to create terminal session after 3 attempts: ${lastError?.message || 'Unknown error'}`);
  }

  let stream;
  retries = 3;
  lastError = null;
  
  // Retry logic for stream start
  while (retries > 0) {
    try {
      console.log(`[terminal.ts] Starting Docker exec stream for session ${sessionId} (attempt ${4 - retries})`);
      stream = await exec.start({
        hijack: true,
        stdin: true,
      });
      console.log(`[terminal.ts] Docker exec stream started successfully`);
      console.log('[terminal.ts] Stream info:', {
        readable: stream.readable,
        writable: stream.writable,
        destroyed: stream.destroyed
      });
      break; // Success, exit retry loop
    } catch (error) {
      lastError = error as Error;
      retries--;
      console.error(`[terminal.ts] Failed to start exec for container ${containerId} (${retries} retries left):`, error);
      if (error instanceof Error) {
        console.error('[terminal.ts] Stream start error details:', {
          message: error.message,
          stack: error.stack
        });
      }
      if (retries > 0) {
        console.log('[terminal.ts] Waiting 1s before retry...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait longer before retry
      }
    }
  }
  
  if (!stream) {
    const errorMessage = lastError instanceof Error ? lastError.message : 'Unknown error';
    throw new Error(`Failed to start terminal session after 3 attempts: ${errorMessage}`);
  }

  const session = new EventEmitter() as TerminalSession;
  session.id = sessionId;
  session.containerId = containerId;

  session.resize = async (cols: number, rows: number) => {
    try {
      console.log(`Resizing terminal to ${cols}x${rows}`);
      await exec.resize({ h: rows, w: cols });
      // Don't send manual resize escape sequence - Docker exec API handles this
    } catch (error) {
      console.error('Failed to resize terminal:', error);
    }
  };

  session.write = (data: string) => {
    stream.write(data);
  };

  session.destroy = () => {
    stream.end();
    sessions.delete(sessionId);
  };

  // Track if we've successfully connected
  let isConnected = false;
  let errorBuffer = '';

  // Use dockerode's demuxStream to handle Docker's multiplexed streams properly
  const stdout = new Writable({
    write(chunk, encoding, callback) {
      const data = chunk.toString();
      const cleanData = cleanTerminalOutput(data);
      
      // Only log if there's meaningful content after cleaning
      if (cleanData.length > 0) {
        console.log(`[terminal.ts] stdout (${sessionId}): ${cleanData.length} chars received`);
      }
      
      // Check for our echo messages to confirm successful connection
      if (!isConnected && data.includes('[Terminal]')) {
        isConnected = true;
        console.log('[terminal.ts] Terminal connection confirmed via stdout');
        if (data.includes('ERROR:')) {
          console.error(`[terminal.ts] Session error detected in stdout: ${cleanData}`);
          session.emit('error', new Error(data));
        }
        
        // Send a welcome message and prompt to ensure terminal shows something
        setTimeout(() => {
          const welcomeMsg = '\r\n🎉 Terminal connected successfully!\r\n';
          session.emit('data', welcomeMsg);
          
          // Send a command to refresh the prompt
          setTimeout(() => {
            session.write('\n'); // Send newline to trigger prompt
          }, 500);
        }, 1000);
      }
      
      session.emit('data', data);
      callback();
    }
  });
  
  const stderr = new Writable({
    write(chunk, encoding, callback) {
      const data = chunk.toString();
      const cleanData = cleanTerminalOutput(data);
      
      // Only log stderr if there's meaningful content after cleaning
      if (cleanData.length > 0) {
        console.error(`[terminal.ts] stderr (${sessionId}): ${cleanData.length} chars`);
      }
      
      // Collect stderr for error reporting
      errorBuffer += data;
      
      // Check for specific error patterns
      if (data.includes('exit 1') || data.includes('ERROR:')) {
        console.error('[terminal.ts] Terminal error pattern detected in stderr');
        session.emit('error', new Error(`Terminal error: ${data}`));
      }
      
      session.emit('data', data);
      callback();
    }
  });
  
  console.log(`[terminal.ts] Setting up stream demultiplexing for session ${sessionId}`);
  // Demultiplex the Docker stream
  try {
    docker.modem.demuxStream(stream, stdout, stderr);
    console.log('[terminal.ts] Stream demultiplexing setup complete');
  } catch (error) {
    console.error('[terminal.ts] Failed to setup stream demultiplexing:', error);
    throw error;
  }

  stream.on('error', (err: Error) => {
    console.error(`[Terminal] Stream error for session ${sessionId}:`, err);
    session.emit('error', err);
  });

  stream.on('end', () => {
    console.log(`[Terminal] Stream ended for session ${sessionId}`);
    session.emit('close');
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, session);
  console.log(`[terminal.ts] Terminal session ${sessionId} stored in sessions map`);
  
  // Set a timeout to check if we successfully connected
  const connectionTimeout = setTimeout(() => {
    if (!isConnected) {
      console.error(`[terminal.ts] Session ${sessionId} failed to connect properly after 5s timeout`);
      console.error('[terminal.ts] Error buffer contents:', errorBuffer);
      const errorMsg = errorBuffer || 'Terminal session did not respond within 5 seconds';
      session.emit('error', new Error(`Failed to establish terminal session: ${errorMsg}`));
      session.destroy();
    } else {
      console.log('[terminal.ts] Session connected successfully within timeout');
    }
  }, 5000);
  
  // Clear timeout if we connect successfully
  session.once('data', () => {
    console.log('[terminal.ts] First data received, clearing connection timeout');
    clearTimeout(connectionTimeout);
  });
  
  console.log('[terminal.ts] createTerminalSession completed, returning session');
  return session;
}

export function getTerminalSession(sessionId: string) {
  return sessions.get(sessionId);
}

export function destroyTerminalSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) {
    session.destroy();
  }
}