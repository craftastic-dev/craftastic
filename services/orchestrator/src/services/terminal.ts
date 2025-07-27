import { spawn } from 'node-pty';
import { getDocker } from './docker';
import { EventEmitter } from 'events';

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
  tmuxSessionName?: string
): Promise<TerminalSession> {
  const docker = getDocker();
  // Use tmux for persistent sessions
  // Use provided tmux session name or fallback to session ID
  const actualTmuxName = tmuxSessionName || `session-${sessionId.substring(0, 8)}`;
  const tmuxCmd = [
    '/bin/bash', '-c',
    `tmux has-session -t ${actualTmuxName} 2>/dev/null && tmux attach-session -t ${actualTmuxName} || tmux new-session -s ${actualTmuxName}`
  ];

  const exec = await docker.getContainer(containerId).exec({
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: tmuxCmd,
    Env: [
      'TERM=xterm-256color', // Ensure proper terminal type
      'LANG=en_US.UTF-8',     // Set UTF-8 encoding
      'LC_ALL=en_US.UTF-8'
    ]
  });

  const stream = await exec.start({
    hijack: true,
    stdin: true,
  });

  const session = new EventEmitter() as TerminalSession;
  session.id = sessionId;
  session.containerId = containerId;

  session.resize = async (cols: number, rows: number) => {
    try {
      await exec.resize({ h: rows, w: cols });
      // Send terminal resize escape sequence to ensure the shell gets the update
      stream.write(`\x1b[8;${rows};${cols}t`);
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

  stream.on('data', (chunk: Buffer) => {
    session.emit('data', chunk.toString());
  });

  stream.on('error', (err: Error) => {
    session.emit('error', err);
  });

  stream.on('end', () => {
    session.emit('close');
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, session);
  
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