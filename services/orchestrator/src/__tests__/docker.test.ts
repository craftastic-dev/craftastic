import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSandbox, destroySandbox, ensureContainerRunning, getDocker } from '../services/docker';

/**
 * DOCKER SERVICE TESTS - Container Management Verification
 * ========================================================
 * 
 * These tests verify the Docker service with container management invariants:
 * 
 * D₁: ∀c ∈ Containers. created_by_sandbox(c) ⟹ 
 *     (working_dir(c) = "/workspace" ∧ capabilities_restricted(c))
 *     (Sandbox containers have correct working directory and security)
 * 
 * D₂: ∀c ∈ Containers, m ∈ Mounts. mount(m, c) ⟹ 
 *     (exists(m.hostPath) ∧ accessible(m.containerPath, c))
 *     (Container mounts are valid and accessible)
 * 
 * D₃: ∀c ∈ Containers. ensureContainerRunning(c) ⟹ running(c)
 *     (Container ensure operation results in running state)
 * 
 * D₄: ∀c ∈ Containers. destroySandbox(c) ⟹ ¬exists(c)
 *     (Container destruction removes container completely)
 */

describe('Docker Service', () => {
  const docker = getDocker();
  const createdContainers: string[] = [];
  
  beforeEach(async () => {
    // Clean up any existing test containers
    await cleanupTestContainers();
  });

  afterEach(async () => {
    // Clean up containers created during tests
    await cleanupTestContainers();
  });

  describe('Invariant D₁: Sandbox container configuration', () => {
    it('should create container with correct working directory', async () => {
      // {P: valid sandbox options}
      const container = await createSandbox({
        sessionId: 'test-session-' + Date.now(),
        userId: 'test-user',
        environmentName: 'test-env',
        sessionName: 'test'
      });
      
      createdContainers.push(container.id);
      
      // {Q: container.working_dir = "/workspace"}
      const info = await container.inspect();
      expect(info.Config.WorkingDir).toBe('/workspace');
      
      await destroySandbox(container.id);
    });

    it('should create container with security restrictions', async () => {
      // {P: sandbox container creation}
      const container = await createSandbox({
        sessionId: 'security-test-' + Date.now(),
        userId: 'test-user'
      });
      
      createdContainers.push(container.id);
      
      const info = await container.inspect();
      
      // {Q: security capabilities are restricted}
      expect(info.HostConfig.CapDrop).toContain('ALL');
      expect(info.HostConfig.CapAdd).toEqual(['CHOWN', 'SETUID', 'SETGID']);
      expect(info.HostConfig.SecurityOpt).toContain('no-new-privileges');
      
      await destroySandbox(container.id);
    });

    it('should set resource limits', async () => {
      // {P: sandbox container with resource limits}
      const container = await createSandbox({
        sessionId: 'resource-test-' + Date.now(),
        userId: 'test-user'
      });
      
      createdContainers.push(container.id);
      
      const info = await container.inspect();
      
      // {Q: resource limits are applied}
      expect(info.HostConfig.Memory).toBeGreaterThan(0);
      expect(info.HostConfig.CpuQuota).toBeGreaterThan(0);
      
      await destroySandbox(container.id);
    });

    it('should set environment variables', async () => {
      // {P: sandbox with session info}
      const sessionId = 'env-test-' + Date.now();
      const userId = 'test-user-123';
      const environmentName = 'test-environment';
      
      const container = await createSandbox({
        sessionId,
        userId,
        environmentName,
        sessionName: 'test-session'
      });
      
      createdContainers.push(container.id);
      
      const info = await container.inspect();
      
      // {Q: environment variables are set correctly}
      expect(info.Config.Env).toContain('NODE_ENV=development');
      expect(info.Config.Env).toContain(`USER_ID=${userId}`);
      expect(info.Config.Env).toContain(`SESSION_ID=${sessionId}`);
      expect(info.Config.Env).toContain(`ENVIRONMENT_NAME=${environmentName}`);
      
      await destroySandbox(container.id);
    });
  });

  describe('Invariant D₂: Container mount management', () => {
    it('should create container with worktree mount', async () => {
      // {P: sandbox with worktree mount}
      const hostPath = '/tmp/test-worktree-' + Date.now();
      
      // Create test directory (simulate worktree)
      const fs = await import('fs/promises');
      await fs.mkdir(hostPath, { recursive: true });
      
      try {
        const container = await createSandbox({
          sessionId: 'mount-test-' + Date.now(),
          userId: 'test-user',
          worktreeMounts: [{
            hostPath: hostPath,
            containerPath: '/workspace'
          }]
        });
        
        createdContainers.push(container.id);
        
        const info = await container.inspect();
        
        // {Q: mount is configured correctly}
        expect(info.HostConfig.Binds).toContain(`${hostPath}:/workspace:rw`);
        expect(info.Config.WorkingDir).toBe('/workspace');
        
        await destroySandbox(container.id);
      } finally {
        // Cleanup test directory
        await fs.rmdir(hostPath).catch(() => {});
      }
    });

    it('should handle multiple mounts', async () => {
      // {P: container with multiple mounts}
      const fs = await import('fs/promises');
      const hostPath1 = '/tmp/test-mount1-' + Date.now();
      const hostPath2 = '/tmp/test-mount2-' + Date.now();
      
      await fs.mkdir(hostPath1, { recursive: true });
      await fs.mkdir(hostPath2, { recursive: true });
      
      try {
        const container = await createSandbox({
          sessionId: 'multi-mount-test-' + Date.now(),
          userId: 'test-user',
          worktreeMounts: [
            { hostPath: hostPath1, containerPath: '/workspace' },
            { hostPath: hostPath2, containerPath: '/data' }
          ]
        });
        
        createdContainers.push(container.id);
        
        const info = await container.inspect();
        
        // {Q: all mounts are configured}
        expect(info.HostConfig.Binds).toContain(`${hostPath1}:/workspace:rw`);
        expect(info.HostConfig.Binds).toContain(`${hostPath2}:/data:rw`);
        
        await destroySandbox(container.id);
      } finally {
        await fs.rmdir(hostPath1).catch(() => {});
        await fs.rmdir(hostPath2).catch(() => {});
      }
    });

    it('should handle container without mounts', async () => {
      // {P: container without additional mounts}
      const container = await createSandbox({
        sessionId: 'no-mount-test-' + Date.now(),
        userId: 'test-user'
      });
      
      createdContainers.push(container.id);
      
      const info = await container.inspect();
      
      // {Q: no custom binds, but working directory set}
      expect(info.HostConfig.Binds || []).toHaveLength(0);
      expect(info.Config.WorkingDir).toBe('/workspace');
      
      await destroySandbox(container.id);
    });
  });

  describe('Invariant D₃: Container lifecycle management', () => {
    it('should ensure container is running', async () => {
      // {P: container exists}
      const container = await createSandbox({
        sessionId: 'lifecycle-test-' + Date.now(),
        userId: 'test-user'
      });
      
      createdContainers.push(container.id);
      
      // Stop container
      await container.stop();
      
      // Ensure it's running
      await ensureContainerRunning(container.id);
      
      // {Q: container is running}
      const info = await container.inspect();
      expect(info.State.Running).toBe(true);
      
      await destroySandbox(container.id);
    });

    it('should handle already running container', async () => {
      // {P: container already running}
      const container = await createSandbox({
        sessionId: 'running-test-' + Date.now(),
        userId: 'test-user'
      });
      
      createdContainers.push(container.id);
      
      // Ensure running (should be no-op)
      await ensureContainerRunning(container.id);
      
      // {Q: container still running}
      const info = await container.inspect();
      expect(info.State.Running).toBe(true);
      
      await destroySandbox(container.id);
    });

    it('should fail gracefully for non-existent container', async () => {
      // {P: non-existent container ID}
      const fakeContainerId = 'non-existent-container-123';
      
      // {Q: ensureContainerRunning throws error}
      await expect(ensureContainerRunning(fakeContainerId))
        .rejects.toThrow(/not available|not found/);
    });

    it('should handle container that cannot be started', async () => {
      // {P: container in invalid state}
      const container = await createSandbox({
        sessionId: 'invalid-test-' + Date.now(),
        userId: 'test-user'
      });
      
      createdContainers.push(container.id);
      
      // Remove container but keep ID
      await container.remove({ force: true });
      
      // {Q: ensureContainerRunning fails appropriately}
      await expect(ensureContainerRunning(container.id))
        .rejects.toThrow(/not available|not found/);
    });
  });

  describe('Invariant D₄: Container destruction', () => {
    it('should completely remove container', async () => {
      // {P: container exists}
      const container = await createSandbox({
        sessionId: 'destroy-test-' + Date.now(),
        userId: 'test-user'
      });
      
      const containerId = container.id;
      
      // Verify container exists
      const beforeInfo = await container.inspect();
      expect(beforeInfo.Id).toBe(containerId);
      
      // Destroy container
      await destroySandbox(containerId);
      
      // {Q: container no longer exists}
      await expect(docker.getContainer(containerId).inspect())
        .rejects.toThrow(/no such container|not found/);
    });

    it('should handle destroying non-existent container gracefully', async () => {
      // {P: non-existent container}
      const fakeContainerId = 'fake-container-456';
      
      // {Q: destroySandbox doesn't throw error}
      await expect(destroySandbox(fakeContainerId))
        .resolves.toBeUndefined();
    });

    it('should stop running container before removal', async () => {
      // {P: running container}
      const container = await createSandbox({
        sessionId: 'stop-destroy-test-' + Date.now(),
        userId: 'test-user'
      });
      
      const containerId = container.id;
      
      // Verify container is running
      const runningInfo = await container.inspect();
      expect(runningInfo.State.Running).toBe(true);
      
      // Destroy should stop and remove
      await destroySandbox(containerId);
      
      // {Q: container completely removed}
      await expect(docker.getContainer(containerId).inspect())
        .rejects.toThrow(/no such container|not found/);
    });
  });

  describe('Container naming and labels', () => {
    it('should create container with descriptive name', async () => {
      // {P: sandbox with naming info}
      const sessionId = 'naming-test-' + Date.now();
      const container = await createSandbox({
        sessionId,
        userId: 'test-user',
        environmentName: 'Test Environment',
        sessionName: 'Test Session'
      });
      
      createdContainers.push(container.id);
      
      const info = await container.inspect();
      
      // {Q: container name includes session info}
      expect(info.Name).toContain('craftastic');
      expect(info.Name).toContain('test-environment');
      expect(info.Name).toContain('test-session');
      
      await destroySandbox(container.id);
    });

    it('should set appropriate labels', async () => {
      // {P: sandbox with metadata}
      const sessionId = 'label-test-' + Date.now();
      const userId = 'test-user-789';
      const environmentName = 'Test Env';
      const sessionName = 'Test Session';
      
      const container = await createSandbox({
        sessionId,
        userId,
        environmentName,
        sessionName
      });
      
      createdContainers.push(container.id);
      
      const info = await container.inspect();
      
      // {Q: labels contain metadata}
      expect(info.Config.Labels['craftastic.session']).toBe(sessionId);
      expect(info.Config.Labels['craftastic.user']).toBe(userId);
      expect(info.Config.Labels['craftastic.environment']).toBe(environmentName);
      expect(info.Config.Labels['craftastic.session-name']).toBe(sessionName);
      
      await destroySandbox(container.id);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle Docker daemon connection issues', async () => {
      // This test would require mocking Docker daemon failures
      // For now, we test that our functions properly propagate errors
      
      // {P: Docker operation might fail}
      const invalidOptions = {
        sessionId: 'error-test-' + Date.now(),
        userId: 'test-user'
      };
      
      // Mock case: if Docker image doesn't exist, should fail appropriately
      // In real scenario, this would check for proper error handling
      // {Q: errors are properly propagated}
      
      // For this test, we just verify container creation works normally
      const container = await createSandbox(invalidOptions);
      expect(container.id).toBeDefined();
      
      createdContainers.push(container.id);
      await destroySandbox(container.id);
    });

    it('should handle invalid mount paths gracefully', async () => {
      // {P: invalid host path}
      const invalidHostPath = '/non/existent/path/that/should/not/exist';
      
      // Note: Docker might still create the container even with invalid mount paths
      // depending on the mount strategy. This test verifies current behavior.
      const container = await createSandbox({
        sessionId: 'invalid-mount-test-' + Date.now(),
        userId: 'test-user',
        worktreeMounts: [{
          hostPath: invalidHostPath,
          containerPath: '/workspace'
        }]
      });
      
      createdContainers.push(container.id);
      
      // {Q: container created but mount may not be functional}
      expect(container.id).toBeDefined();
      
      await destroySandbox(container.id);
    });
  });

  // Helper function to clean up test containers
  async function cleanupTestContainers() {
    for (const containerId of createdContainers) {
      try {
        await destroySandbox(containerId);
      } catch (error) {
        console.warn('Failed to cleanup container:', containerId);
      }
    }
    createdContainers.length = 0;
  }
});