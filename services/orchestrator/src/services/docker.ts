import Docker from 'dockerode';
import { config } from '../config';

const docker = new Docker({
  socketPath: config.DOCKER_HOST || '/var/run/docker.sock',
});

export interface SandboxOptions {
  sessionId: string;
  userId: string;
  environmentName?: string;
  sessionName?: string;
  worktreeMounts?: Array<{
    hostPath: string;
    containerPath: string;
  }>;
}

export async function createSandbox(options: SandboxOptions) {
  const { sessionId, userId, environmentName, sessionName, worktreeMounts = [] } = options;
  
  // Check if the Docker image exists
  try {
    const images = await docker.listImages({
      filters: {
        reference: [config.SANDBOX_IMAGE]
      }
    });
    
    if (images.length === 0) {
      throw new Error(
        `Docker image '${config.SANDBOX_IMAGE}' not found. Please build it first with:\n` +
        `docker build -f services/orchestrator/docker/sandbox.Dockerfile -t ${config.SANDBOX_IMAGE} .`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    console.error('Error checking for Docker image:', error);
    throw new Error(`Failed to check Docker image availability: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Build a descriptive container name
  const nameParts = ['craftastic'];
  if (environmentName) {
    nameParts.push(environmentName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase());
  }
  if (sessionName) {
    nameParts.push(sessionName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase());
  }
  nameParts.push(sessionId.substring(0, 8));
  
  const containerName = nameParts.join('-');
  
  // Prepare volume mounts
  const binds = worktreeMounts.map(mount => `${mount.hostPath}:${mount.containerPath}:rw`);
  
  const container = await docker.createContainer({
    Image: config.SANDBOX_IMAGE,
    name: containerName,
    Cmd: ['/bin/sh'],
    Tty: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: false,
    HostConfig: {
      Memory: parseInt(config.SANDBOX_MEMORY_LIMIT) * 1024 * 1024,
      CpuQuota: parseFloat(config.SANDBOX_CPU_LIMIT) * 100000,
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'SETUID', 'SETGID'],
      SecurityOpt: ['no-new-privileges'],
      Binds: binds.length > 0 ? binds : undefined,
    },
    Labels: {
      'craftastic.session': sessionId,
      'craftastic.user': userId,
      'craftastic.environment': environmentName || '',
      'craftastic.session-name': sessionName || '',
    },
    WorkingDir: '/workspace',
    Env: [
      'NODE_ENV=development',
      `USER_ID=${userId}`,
      `SESSION_ID=${sessionId}`,
    ],
  });

  await container.start();
  
  return container;
}

export async function destroySandbox(containerId: string) {
  try {
    const container = docker.getContainer(containerId);
    await container.stop();
    await container.remove();
  } catch (error) {
    console.error('Error destroying sandbox:', error);
  }
}

export async function listSandboxes(userId?: string) {
  const filters: any = {
    label: ['craftastic.session'],
  };
  
  if (userId) {
    filters.label.push(`craftastic.user=${userId}`);
  }
  
  const containers = await docker.listContainers({
    all: true,
    filters,
  });
  
  return containers;
}

export function getDocker() {
  return docker;
}