import { getDocker } from './docker';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

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
  const docker = getDocker();
  // Use tmux for persistent sessions
  // Use provided tmux session name or fallback to session ID
  const actualTmuxName = tmuxSessionName || `session-${sessionId.substring(0, 8)}`;
  
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
          tmux attach-session -t ${actualTmuxName}
        else
          echo "[Terminal] Creating new tmux session: ${actualTmuxName}"
          tmux new-session -d -s ${actualTmuxName} -c "${workingDirectory}"
          tmux attach-session -t ${actualTmuxName}
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
        tmux attach-session -t ${actualTmuxName}
      else
        echo "[Terminal] Creating new tmux session: ${actualTmuxName}"
        tmux new-session -d -s ${actualTmuxName}
        tmux attach-session -t ${actualTmuxName}
      fi
    `;
  }
  
  console.log(`[Terminal] Full command to execute: ${tmuxCommand}`);
  
  // First, let's test with a simple command to verify the Docker exec works
  const testCommand = workingDirectory 
    ? `cd "${workingDirectory}" && echo "Directory changed successfully" && pwd`
    : `echo "No working directory" && pwd`;
  
  console.log(`[Terminal] Testing with simple command first: ${testCommand}`);
  
  // DEBUG: Temporarily use test command to diagnose the issue
  const DEBUG_MODE = false;
  const commandToRun = DEBUG_MODE ? testCommand : tmuxCommand;
  
  const tmuxCmd = ['/bin/bash', '-c', commandToRun];
  console.log(`[Terminal] Docker exec command array:`, tmuxCmd);
  
  if (DEBUG_MODE) {
    console.warn(`[Terminal] DEBUG MODE ENABLED - Running test command instead of tmux`);
  }

  let exec;
  try {
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
  } catch (error) {
    console.error(`Failed to create exec for container ${containerId}:`, error);
    throw new Error(`Failed to create terminal session: Container not available`);
  }

  let stream;
  try {
    console.log(`[Terminal] Starting Docker exec for session ${sessionId}`);
    stream = await exec.start({
      hijack: true,
      stdin: true,
    });
    console.log(`[Terminal] Docker exec stream started successfully`);
  } catch (error) {
    console.error(`[Terminal] Failed to start exec for container ${containerId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to start terminal session: ${errorMessage}`);
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
      console.log(`[Terminal] stdout (${sessionId}):`, data.substring(0, 100) + (data.length > 100 ? '...' : ''));
      
      // Check for our echo messages to confirm successful connection
      if (!isConnected && data.includes('[Terminal]')) {
        isConnected = true;
        if (data.includes('ERROR:')) {
          console.error(`[Terminal] Session error: ${data}`);
          session.emit('error', new Error(data));
        }
      }
      
      session.emit('data', data);
      callback();
    }
  });
  
  const stderr = new Writable({
    write(chunk, encoding, callback) {
      const data = chunk.toString();
      console.error(`[Terminal] stderr (${sessionId}):`, data);
      
      // Collect stderr for error reporting
      errorBuffer += data;
      
      // Check for specific error patterns
      if (data.includes('exit 1') || data.includes('ERROR:')) {
        session.emit('error', new Error(`Terminal error: ${data}`));
      }
      
      session.emit('data', data);
      callback();
    }
  });
  
  console.log(`[Terminal] Setting up stream demultiplexing for session ${sessionId}`);
  // Demultiplex the Docker stream
  docker.modem.demuxStream(stream, stdout, stderr);

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
  
  // Set a timeout to check if we successfully connected
  setTimeout(() => {
    if (!isConnected && errorBuffer) {
      console.error(`[Terminal] Session ${sessionId} failed to connect properly. Error buffer: ${errorBuffer}`);
      session.emit('error', new Error(`Failed to establish terminal session: ${errorBuffer}`));
    }
  }, 5000);
  
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