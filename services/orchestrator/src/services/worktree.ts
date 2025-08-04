import { execPromise } from '../lib/exec';
import { getDatabase } from '../lib/kysely';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { getDocker } from './docker';

export interface WorktreeConfig {
  environmentId: string;
  sessionId: string;
  repositoryUrl: string;
  branch?: string;
  containerId?: string;
}

export class WorktreeService {
  private dataDir: string;

  constructor() {
    // Use configurable data directory, default to ~/.craftastic
    this.dataDir = process.env.CRAFTASTIC_DATA_DIR || path.join(os.homedir(), '.craftastic');
  }

  /**
   * Create a new worktree for a session
   */
  async createWorktree(config: WorktreeConfig): Promise<string> {
    const { environmentId, sessionId, repositoryUrl, branch = 'main', containerId } = config;
    
    const repoPath = path.join(this.dataDir, 'repos', environmentId);
    // Use branch name for worktree path instead of session ID
    const worktreePath = path.join(repoPath, 'worktrees', branch);

    try {
      // Ensure the repo exists (clone if first time)
      await this.ensureBareRepository(environmentId, repositoryUrl, containerId);

      // Check if worktree already exists for this branch
      const existingWorktree = await this.findWorktreeForBranch(repoPath, branch);
      if (existingWorktree) {
        if (existingWorktree.path === worktreePath) {
          console.log(`✅ Reusing existing worktree for branch ${branch} at ${worktreePath}`);
        } else {
          // Branch is checked out elsewhere (likely legacy session-based path)
          console.log(`⚠️  Branch ${branch} is already checked out at ${existingWorktree.path}`);
          throw new Error(`Branch '${branch}' is already in use by another session. Only one session can use a branch at a time.`);
        }
      } else {
        // Create the worktree only if it doesn't exist
        await this.createGitWorktree(repoPath, worktreePath, branch, containerId);
        console.log(`✅ Created new worktree for branch ${branch} at ${worktreePath}`);
      }

      // Update session with worktree info
      await getDatabase()
        .updateTable('sessions')
        .set({
          worktree_path: worktreePath,
          git_branch: branch,
          updated_at: new Date(),
        })
        .where('id', '=', sessionId)
        .execute();

      // Update environment with clone path if not set
      await getDatabase()
        .updateTable('environments')
        .set({
          git_clone_path: repoPath,
          updated_at: new Date(),
        })
        .where('id', '=', environmentId)
        .where('git_clone_path', 'is', null)
        .execute();

      return worktreePath;

    } catch (error) {
      console.error(`❌ Failed to create worktree for session ${sessionId}:`, error);
      throw new Error(`Failed to create worktree: ${error.message}`);
    }
  }

  /**
   * Remove a worktree for a session
   */
  async removeWorktree(environmentId: string, sessionId: string): Promise<void> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);

    try {
      // Get the session to find its branch
      const session = await getDatabase()
        .selectFrom('sessions')
        .select(['git_branch', 'worktree_path'])
        .where('id', '=', sessionId)
        .executeTakeFirst();

      if (session?.git_branch) {
        const worktreePath = path.join(repoPath, 'worktrees', session.git_branch);
        
        // Check if worktree exists for this branch
        if (await this.worktreeExists(repoPath, session.git_branch)) {
          // Only remove if no other sessions are using this branch
          const otherSessions = await getDatabase()
            .selectFrom('sessions')
            .select('id')
            .where('environment_id', '=', environmentId)
            .where('git_branch', '=', session.git_branch)
            .where('id', '!=', sessionId)
            .where('status', '!=', 'dead')
            .executeTakeFirst();

          if (!otherSessions) {
            // Remove the worktree since no other sessions use this branch
            await execPromise(`git -C "${repoPath}" worktree remove --force "worktrees/${session.git_branch}"`);
            console.log(`✅ Removed worktree for branch ${session.git_branch} (session ${sessionId})`);
          } else {
            console.log(`⚠️  Keeping worktree for branch ${session.git_branch} as other sessions still use it`);
          }
        }
      }

      // Clean up session worktree info
      await getDatabase()
        .updateTable('sessions')
        .set({
          worktree_path: null,
          git_branch: null,
          updated_at: new Date(),
        })
        .where('id', '=', sessionId)
        .execute();

    } catch (error) {
      console.error(`❌ Failed to remove worktree for session ${sessionId}:`, error);
      // Don't throw - this is cleanup, we want to be resilient
    }
  }

  /**
   * List all worktrees for an environment
   */
  async listWorktrees(environmentId: string): Promise<Array<{ branch: string; path: string; sessions: string[] }>> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);

    try {
      if (!await this.bareRepoExists(repoPath)) {
        return [];
      }

      const { stdout } = await execPromise(`git -C "${repoPath}" worktree list --porcelain`);
      const worktrees: Array<{ branch: string; path: string; sessions: string[] }> = [];
      
      const lines = stdout.split('\n');
      let currentWorktree: { path?: string; branch?: string } = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const worktreePath = line.substring(9);
          currentWorktree.path = worktreePath;
        } else if (line.startsWith('branch ')) {
          const branch = line.substring(7);
          currentWorktree.branch = branch;
        } else if (line === '' && currentWorktree.path) {
          // End of worktree info
          const pathBasename = path.basename(currentWorktree.path);
          if (pathBasename !== environmentId && currentWorktree.path.includes('/worktrees/')) {
            // Find sessions using this branch
            const sessions = await getDatabase()
              .selectFrom('sessions')
              .select('id')
              .where('environment_id', '=', environmentId)
              .where('git_branch', '=', currentWorktree.branch || pathBasename)
              .where('status', '!=', 'dead')
              .execute();

            worktrees.push({
              branch: currentWorktree.branch || pathBasename,
              path: currentWorktree.path,
              sessions: sessions.map(s => s.id),
            });
          }
          currentWorktree = {};
        }
      }

      return worktrees;
    } catch (error) {
      console.error(`❌ Failed to list worktrees for environment ${environmentId}:`, error);
      return [];
    }
  }

  /**
   * Clean up orphaned worktrees (worktrees with no corresponding session)
   */
  async cleanupOrphanedWorktrees(environmentId: string): Promise<void> {
    try {
      const worktrees = await this.listWorktrees(environmentId);
      const repoPath = path.join(this.dataDir, 'repos', environmentId);
      
      // Remove worktrees that have no active sessions
      for (const worktree of worktrees) {
        if (worktree.sessions.length === 0) {
          console.log(`🧹 Cleaning up orphaned worktree for branch ${worktree.branch}`);
          try {
            await execPromise(`git -C "${repoPath}" worktree remove --force "worktrees/${worktree.branch}"`);
            console.log(`✅ Removed orphaned worktree for branch ${worktree.branch}`);
          } catch (error) {
            console.error(`❌ Failed to remove orphaned worktree for branch ${worktree.branch}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Failed to cleanup orphaned worktrees for environment ${environmentId}:`, error);
    }
  }

  /**
   * Get repository information
   */
  async getRepositoryInfo(environmentId: string): Promise<{
    path: string;
    branches: string[];
    currentBranch: string;
    remoteUrl: string;
  } | null> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);

    try {
      if (!await this.bareRepoExists(repoPath)) {
        return null;
      }

      // Get branches from bare repository
      const { stdout: showRef } = await execPromise(`git -C "${repoPath}" show-ref --heads`);
      const branches = showRef
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.split(' ')[1])
        .map(ref => ref.replace('refs/heads/', ''))
        .filter(branch => branch);

      // Determine default branch
      let currentBranch = 'main';
      if (branches.includes('main')) {
        currentBranch = 'main';
      } else if (branches.includes('master')) {
        currentBranch = 'master';
      } else if (branches.length > 0) {
        currentBranch = branches[0];
      }

      // Get remote URL from config
      const { stdout: remoteUrl } = await execPromise(`git -C "${repoPath}" config --get remote.origin.url`);

      return {
        path: repoPath,
        branches,
        currentBranch,
        remoteUrl: remoteUrl.trim(),
      };
    } catch (error) {
      console.error(`❌ Failed to get repository info for environment ${environmentId}:`, error);
      return null;
    }
  }

  /**
   * Private helper methods
   */
  private async ensureBareRepository(environmentId: string, repositoryUrl: string, containerId?: string): Promise<void> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);
    
    // If containerId is provided, use container paths
    const containerRepoPath = containerId ? `/data/repos/${environmentId}` : repoPath;

    if (await this.bareRepoExists(repoPath)) {
      // Repository already exists, fetch latest changes
      if (containerId) {
        const { stderr } = await this.execInContainer(containerId, `git -C "${containerRepoPath}" fetch origin`);
        if (stderr && !stderr.includes('From ')) {
          console.error(`Git fetch error: ${stderr}`);
        }
      } else {
        await execPromise(`git -C "${repoPath}" fetch origin`);
      }
      return;
    }

    // Create parent directory
    await fs.mkdir(path.dirname(repoPath), { recursive: true });

    // Clone as bare repository
    if (containerId) {
      // Ensure directory exists in container
      await this.execInContainer(containerId, `mkdir -p /data/repos`);
      
      // Clone inside container
      const { stderr } = await this.execInContainer(containerId, `git clone --bare "${repositoryUrl}" "${containerRepoPath}"`);
      if (stderr && !stderr.includes('Cloning into')) {
        console.error(`Git clone error: ${stderr}`);
        throw new Error(`Failed to clone repository: ${stderr}`);
      }
    } else {
      await execPromise(`git clone --bare "${repositoryUrl}" "${repoPath}"`);
    }

    console.log(`✅ Cloned bare repository for environment ${environmentId}`);
  }

  private async createGitWorktree(repoPath: string, worktreePath: string, branch: string, containerId?: string): Promise<void> {
    // Ensure only the parent worktrees directory exists, not the branch directory itself
    // git worktree add will create the branch directory with proper .git file
    const worktreesParentDir = path.dirname(path.dirname(worktreePath)); // Get parent of worktrees dir
    await fs.mkdir(path.join(worktreesParentDir, 'worktrees'), { recursive: true });

    // Convert paths for container if needed
    const containerRepoPath = containerId ? repoPath.replace(this.dataDir, '/data') : repoPath;
    const containerWorktreePath = containerId ? worktreePath.replace(this.dataDir, '/data') : worktreePath;

    // Get available branches from bare repository
    let showRef: string;
    if (containerId) {
      const result = await this.execInContainer(containerId, `git -C "${containerRepoPath}" show-ref --heads`);
      showRef = result.stdout;
    } else {
      const result = await execPromise(`git -C "${repoPath}" show-ref --heads`);
      showRef = result.stdout;
    }
    
    const branches = showRef
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.split(' ')[1])  // Get ref name
      .map(ref => ref.replace('refs/heads/', ''))  // Remove refs/heads/ prefix
      .filter(branch => branch);

    console.log(`Available branches: ${branches.join(', ')}`);

    // Determine the default branch
    let defaultBranch = 'main';
    if (branches.includes('main')) {
      defaultBranch = 'main';
    } else if (branches.includes('master')) {
      defaultBranch = 'master';
    } else if (branches.length > 0) {
      defaultBranch = branches[0];
    }

    // Create the worktree
    try {
      let command: string;
      // If the requested branch exists, check it out
      if (branches.includes(branch)) {
        command = `git -C "${containerRepoPath}" worktree add "${containerWorktreePath}" "${branch}"`;
      } else {
        // Create new branch from default branch
        command = `git -C "${containerRepoPath}" worktree add -b "${branch}" "${containerWorktreePath}" "${defaultBranch}"`;
      }
      
      if (containerId) {
        const { stderr } = await this.execInContainer(containerId, command);
        if (stderr && !stderr.includes('Preparing worktree')) {
          console.error(`Git worktree error: ${stderr}`);
          throw new Error(`Failed to create worktree: ${stderr}`);
        }
      } else {
        await execPromise(command);
      }
    } catch (error) {
      console.error(`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async bareRepoExists(repoPath: string): Promise<boolean> {
    try {
      // For bare repositories, check for HEAD file directly in the repo path
      const headFile = path.join(repoPath, 'HEAD');
      await fs.access(headFile);
      return true;
    } catch {
      return false;
    }
  }

  private async worktreeExists(repoPath: string, branchOrSessionId: string): Promise<boolean> {
    try {
      const { stdout } = await execPromise(`git -C "${repoPath}" worktree list --porcelain`);
      return stdout.includes(`worktrees/${branchOrSessionId}`);
    } catch {
      return false;
    }
  }

  private async findWorktreeForBranch(repoPath: string, branch: string): Promise<{ path: string; branch: string } | null> {
    try {
      const { stdout } = await execPromise(`git -C "${repoPath}" worktree list --porcelain`);
      const lines = stdout.split('\n');
      let currentWorktree: { path?: string; branch?: string } = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentWorktree.path = line.substring(9);
        } else if (line.startsWith('branch ')) {
          currentWorktree.branch = line.substring(7);
        } else if (line === '' && currentWorktree.path && currentWorktree.branch === `refs/heads/${branch}`) {
          return {
            path: currentWorktree.path,
            branch: branch
          };
        } else if (line === '') {
          currentWorktree = {};
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Execute a command inside a container
   */
  private async execInContainer(containerId: string, command: string): Promise<{ stdout: string; stderr: string }> {
    const docker = getDocker();
    const container = docker.getContainer(containerId);
    
    const exec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ['/bin/sh', '-c', command],
      Tty: false, // Don't use TTY for non-interactive commands
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      
      // Docker multiplexes stdout and stderr with 8-byte headers when Tty is false
      stream.on('data', (chunk: Buffer) => {
        let offset = 0;
        
        while (offset < chunk.length) {
          // Check if we have enough bytes for a header
          if (chunk.length - offset < 8) {
            // Incomplete header, treat remaining as stdout
            stdout += chunk.slice(offset).toString('utf8');
            break;
          }
          
          // Parse header: [stream_type, 0, 0, 0, size1, size2, size3, size4]
          const streamType = chunk[offset];
          const size = chunk.readUInt32BE(offset + 4);
          
          // Skip the 8-byte header
          offset += 8;
          
          // Extract the payload
          const payloadEnd = Math.min(offset + size, chunk.length);
          const payload = chunk.slice(offset, payloadEnd).toString('utf8');
          
          if (streamType === 1) {
            stdout += payload;
          } else if (streamType === 2) {
            stderr += payload;
          }
          
          offset = payloadEnd;
        }
      });
      
      stream.on('end', () => {
        resolve({ stdout, stderr });
      });
      
      stream.on('error', reject);
    });
  }
}

// Export singleton instance
export const worktreeService = new WorktreeService();