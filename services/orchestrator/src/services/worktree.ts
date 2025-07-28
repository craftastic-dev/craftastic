import { execPromise } from '../lib/exec';
import { getDatabase } from '../lib/kysely';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export interface WorktreeConfig {
  environmentId: string;
  sessionId: string;
  repositoryUrl: string;
  branch?: string;
  isFeatureBranch?: boolean;
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
    const { environmentId, sessionId, repositoryUrl, branch = 'main', isFeatureBranch = false } = config;
    
    const repoPath = path.join(this.dataDir, 'repos', environmentId);
    const worktreePath = path.join(repoPath, 'worktrees', sessionId);

    try {
      // Ensure the repo exists (clone if first time)
      await this.ensureBareRepository(environmentId, repositoryUrl);

      // Create the worktree
      await this.createGitWorktree(repoPath, worktreePath, branch);

      // Update session with worktree info
      await getDatabase()
        .updateTable('sessions')
        .set({
          worktree_path: worktreePath,
          git_branch: branch,
          is_feature_branch: isFeatureBranch,
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

      console.log(`✅ Created worktree for session ${sessionId} at ${worktreePath}`);
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
    const worktreePath = path.join(repoPath, 'worktrees', sessionId);

    try {
      // Check if worktree exists
      if (await this.worktreeExists(repoPath, sessionId)) {
        // Remove the worktree
        await execPromise(`git -C "${repoPath}" worktree remove --force "worktrees/${sessionId}"`);
        console.log(`✅ Removed worktree for session ${sessionId}`);
      }

      // Clean up session worktree info
      await getDatabase()
        .updateTable('sessions')
        .set({
          worktree_path: null,
          git_branch: null,
          is_feature_branch: false,
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
  async listWorktrees(environmentId: string): Promise<Array<{ sessionId: string; branch: string; path: string }>> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);

    try {
      if (!await this.bareRepoExists(repoPath)) {
        return [];
      }

      const { stdout } = await execPromise(`git -C "${repoPath}" worktree list --porcelain`);
      const worktrees: Array<{ sessionId: string; branch: string; path: string }> = [];
      
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
          const sessionId = path.basename(currentWorktree.path);
          if (sessionId !== environmentId && currentWorktree.path.includes('/worktrees/')) {
            worktrees.push({
              sessionId,
              branch: currentWorktree.branch || 'unknown',
              path: currentWorktree.path,
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
      
      // Get active sessions for this environment
      const activeSessions = await getDatabase()
        .selectFrom('sessions')
        .select('id')
        .where('environment_id', '=', environmentId)
        .where('status', '!=', 'dead')
        .execute();

      const activeSessionIds = new Set(activeSessions.map(s => s.id));

      // Remove worktrees for inactive sessions
      for (const worktree of worktrees) {
        if (!activeSessionIds.has(worktree.sessionId)) {
          console.log(`🧹 Cleaning up orphaned worktree for session ${worktree.sessionId}`);
          await this.removeWorktree(environmentId, worktree.sessionId);
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

      // Get branches
      const { stdout: branchOutput } = await execPromise(`git -C "${repoPath}" branch -r`);
      const branches = branchOutput
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.includes('HEAD ->'))
        .map(line => line.replace('origin/', ''));

      // Get default branch
      const { stdout: defaultBranch } = await execPromise(`git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD`);
      const currentBranch = defaultBranch.trim().replace('refs/remotes/origin/', '') || 'main';

      // Get remote URL
      const { stdout: remoteUrl } = await execPromise(`git -C "${repoPath}" remote get-url origin`);

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
  private async ensureBareRepository(environmentId: string, repositoryUrl: string): Promise<void> {
    const repoPath = path.join(this.dataDir, 'repos', environmentId);

    if (await this.bareRepoExists(repoPath)) {
      // Repository already exists, fetch latest changes
      await execPromise(`git -C "${repoPath}" fetch origin`);
      return;
    }

    // Create parent directory
    await fs.mkdir(path.dirname(repoPath), { recursive: true });

    // Clone as bare repository
    await execPromise(`git clone --bare "${repositoryUrl}" "${repoPath}/.git"`);
    
    // Set up the repository as a bare repo in the main directory
    await execPromise(`git -C "${repoPath}" config --bool core.bare true`);

    console.log(`✅ Cloned bare repository for environment ${environmentId}`);
  }

  private async createGitWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    // Ensure worktrees directory exists
    const worktreesDir = path.dirname(worktreePath);
    await fs.mkdir(worktreesDir, { recursive: true });

    // Create the worktree
    try {
      // Try to create worktree with existing branch
      await execPromise(`git -C "${repoPath}" worktree add "${worktreePath}" "${branch}"`);
    } catch (error) {
      // If branch doesn't exist, create it from origin/main or origin/master
      const { stdout: remoteDefault } = await execPromise(`git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD`).catch(() => ({ stdout: '' }));
      const defaultBranch = remoteDefault.trim().replace('refs/remotes/origin/', '') || 'main';
      
      try {
        await execPromise(`git -C "${repoPath}" worktree add -b "${branch}" "${worktreePath}" "origin/${defaultBranch}"`);
      } catch (fallbackError) {
        // Last resort: try with master
        await execPromise(`git -C "${repoPath}" worktree add -b "${branch}" "${worktreePath}" "origin/master"`);
      }
    }
  }

  private async bareRepoExists(repoPath: string): Promise<boolean> {
    try {
      const gitDir = path.join(repoPath, '.git');
      await fs.access(gitDir);
      return true;
    } catch {
      return false;
    }
  }

  private async worktreeExists(repoPath: string, sessionId: string): Promise<boolean> {
    try {
      const { stdout } = await execPromise(`git -C "${repoPath}" worktree list --porcelain`);
      return stdout.includes(`worktrees/${sessionId}`);
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const worktreeService = new WorktreeService();