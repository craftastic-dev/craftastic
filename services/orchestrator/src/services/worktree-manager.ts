/**
 * Git Worktree Management with Formal Verification
 * ==============================================
 * 
 * This module implements a self-healing git worktree management system
 * based on Hoare logic and formal verification principles.
 * 
 * CORE PRINCIPLE:
 * Git worktrees on the host filesystem ARE the single source of truth.
 * The database tracks minimal state, all other state is derived from git.
 * 
 * GLOBAL INVARIANT:
 * I: ∀b ∈ Branches. |{w ∈ Worktrees : worktree_branch(w) = b}| ≤ 1
 *    (At most one worktree per branch - enforced by git)
 * 
 * STATE MODEL:
 * - W: Set of worktrees (from `git worktree list`)
 * - S: Set of sessions in database
 * - worktree_branch: W → String
 * - worktree_path: W → HostPath
 * - session_branch: S → String ∪ {null}
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { createSandbox, destroySandbox, ensureContainerRunning } from './docker';
import { getDatabase } from '../lib/kysely';

const execAsync = promisify(exec);

interface GitWorktree {
  path: string;
  branch: string;
  bare: boolean;
}

export class WorktreeManager {
  private readonly dataDir: string;
  private readonly environmentId: string;

  constructor(environmentId: string, dataDir = process.env.HOME + '/.craftastic') {
    this.environmentId = environmentId;
    this.dataDir = dataDir;
  }

  /**
   * ENSURE WORKTREE - Core self-healing operation
   * ============================================
   * 
   * Hoare Triple:
   * {P: true} // No preconditions - we handle all states
   * ensureWorktree(branch)
   * {Q: ∃w ∈ Worktrees. w.branch = branch ∧ exists(w.path)}
   * 
   * Case Analysis:
   * 1. Worktree exists and path is valid → reuse (O(1))
   * 2. Worktree exists but path is broken → remove and recreate (O(1))
   * 3. No worktree for branch → create new (O(1))
   * 4. Branch conflict → git handles atomically (impossible due to git invariant)
   * 
   * This operation is idempotent and self-healing.
   */
  async ensureWorktree(branch: string): Promise<string> {
    // RECOVERY PHASE: Always prune broken worktrees first
    // This is cheap (O(n) where n = number of worktrees) and ensures consistency
    await this.pruneWorktrees();

    const repoPath = await this.ensureBareRepository();
    
    // CHECK PHASE: Find existing worktree for branch
    const existingWorktree = await this.findWorktreeForBranch(branch);
    
    if (existingWorktree) {
      // Case 1: Worktree exists - verify path is valid
      try {
        await fs.access(existingWorktree.path);
        console.log(`✅ Reusing existing worktree for branch ${branch} at ${existingWorktree.path}`);
        return existingWorktree.path;
      } catch (error) {
        // Case 2: Worktree exists but path is broken - remove and recreate
        console.log(`⚠️  Worktree for branch ${branch} has broken path, recreating...`);
        await this.removeWorktree(existingWorktree.path);
      }
    }

    // Case 3: No valid worktree - create new one
    const worktreePath = await this.createWorktree(repoPath, branch);
    console.log(`✅ Created new worktree for branch ${branch} at ${worktreePath}`);
    return worktreePath;
  }

  /**
   * ENSURE SESSION CONTAINER - Session-owned container lifecycle
   * ===========================================================
   * 
   * Hoare Triple:
   * {P: session_id ∈ Sessions ∧ branch ≠ null}
   * ensureSessionContainer(session_id, branch, session_name, environment_name)
   * {Q: ∃c ∈ Containers. owner(c) = session_id ∧ 
   *     running(c) ∧ mounted(worktree(branch), "/workspace", c)}
   * 
   * Invariant: Each session owns at most one container
   * Architecture: Sessions own containers, environments are git mappings
   * 
   * Recovery Cases:
   * 1. Session has container + running → return container_id (O(1))
   * 2. Session has container + dead → destroy and recreate (O(1))
   * 3. Session has no container → create with worktree mount
   * 4. Worktree missing → create worktree then container
   */
  async ensureSessionContainer(sessionId: string, branch: string, sessionName: string, environmentName: string): Promise<string> {
    const db = getDatabase();

    // Get current session state from database
    const session = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Get environment info for metadata only (environments don't have containers)
    const environment = await db
      .selectFrom('environments')
      .selectAll()
      .where('id', '=', session.environment_id)
      .executeTakeFirst();

    if (!environment) {
      throw new Error(`Environment ${session.environment_id} not found`);
    }

    // Check if session already has a container
    if (session.container_id) {
      try {
        await ensureContainerRunning(session.container_id);
        console.log(`✅ Container ${session.container_id} is running for session ${sessionId}`);
        return session.container_id;
      } catch (error) {
        console.log(`⚠️  Container ${session.container_id} is dead, will recreate`);
        // Clean up dead container
        try {
          await destroySandbox(session.container_id);
        } catch (cleanupError) {
          console.log(`Warning: Failed to cleanup dead container ${session.container_id}`);
        }
      }
    }

    // Need to create a new container for this session
    // First ensure the worktree exists
    const worktreePath = await this.ensureWorktree(branch);

    // Create new container with worktree mounted
    const container = await createSandbox({
      sessionId,
      userId: environment.user_id,
      environmentName: environmentName,
      sessionName,
      worktreeMounts: [{
        hostPath: worktreePath,
        containerPath: '/workspace'
      }]
    });

    // Update SESSION (not environment) with container ID
    await db
      .updateTable('sessions')
      .set({
        container_id: container.id,
        status: 'active',
        updated_at: new Date()
      })
      .where('id', '=', sessionId)
      .execute();

    console.log(`✅ Created new container ${container.id} for session ${sessionId}`);
    return container.id;
  }

  /**
   * LEGACY METHOD - For backward compatibility during transition
   * =========================================================
   * 
   * @deprecated Use ensureSessionContainer instead
   * This method is kept for compatibility while we update all callers
   */
  async ensureContainer(sessionId: string, branch: string, sessionName: string, environmentName: string): Promise<string> {
    console.warn('⚠️  ensureContainer is deprecated, use ensureSessionContainer instead');
    return this.ensureSessionContainer(sessionId, branch, sessionName, environmentName);
  }

  /**
   * PRUNE WORKTREES - Cleanup operation
   * ==================================
   * 
   * Removes all worktrees that point to non-existent paths.
   * This is safe because git worktree prune only removes broken references.
   * 
   * {P: true}
   * pruneWorktrees()
   * {Q: ∀w ∈ Worktrees. exists(worktree_path(w))}
   */
  private async pruneWorktrees(): Promise<void> {
    const repoPath = path.join(this.dataDir, 'repos', this.environmentId);
    
    try {
      await fs.access(repoPath);
      await execAsync(`git -C "${repoPath}" worktree prune`);
      console.log(`🧹 Pruned broken worktrees for environment ${this.environmentId}`);
    } catch (error) {
      // Repository doesn't exist yet - this is fine
      console.log(`📁 Repository not found at ${repoPath} - will be created when needed`);
    }
  }

  /**
   * FIND WORKTREE FOR BRANCH - Query operation
   * =========================================
   * 
   * Returns the worktree for a given branch, or null if none exists.
   * This queries git directly (single source of truth).
   * 
   * {P: branch ≠ null}
   * findWorktreeForBranch(branch)
   * {Q: result = null ∨ (result.branch = branch ∧ result ∈ Worktrees)}
   */
  private async findWorktreeForBranch(branch: string): Promise<GitWorktree | null> {
    const repoPath = path.join(this.dataDir, 'repos', this.environmentId);
    
    try {
      const { stdout } = await execAsync(`git -C "${repoPath}" worktree list --porcelain`);
      const worktrees = this.parseWorktreeList(stdout);
      
      return worktrees.find(w => w.branch === branch && !w.bare) || null;
    } catch (error) {
      // Repository doesn't exist or no worktrees
      return null;
    }
  }

  /**
   * CREATE WORKTREE - Creation operation
   * ==================================
   * 
   * Creates a new worktree for the specified branch.
   * Path is deterministic based on environment and branch.
   * 
   * {P: repoPath exists ∧ ¬∃w ∈ Worktrees. w.branch = branch}
   * createWorktree(repoPath, branch)
   * {Q: ∃w ∈ Worktrees. w.branch = branch ∧ w.path = computed_path}
   */
  private async createWorktree(repoPath: string, branch: string): Promise<string> {
    // Use deterministic path: ~/.craftastic/worktrees/{env_id}/{branch}
    const worktreePath = path.join(this.dataDir, 'worktrees', this.environmentId, branch);
    
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    
    try {
      // Create worktree
      await execAsync(`git -C "${repoPath}" worktree add "${worktreePath}" "${branch}"`);
      return worktreePath;
    } catch (error) {
      // If branch doesn't exist, create it from default branch
      try {
        await execAsync(`git -C "${repoPath}" worktree add -b "${branch}" "${worktreePath}"`);
        return worktreePath;
      } catch (createError) {
        throw new Error(`Failed to create worktree for branch ${branch}: ${createError}`);
      }
    }
  }

  /**
   * REMOVE WORKTREE - Cleanup operation
   * ==================================
   * 
   * Removes a worktree at the specified path.
   * Safe to call on non-existent worktrees.
   * 
   * {P: true}
   * removeWorktree(path)
   * {Q: ¬∃w ∈ Worktrees. w.path = path}
   */
  private async removeWorktree(worktreePath: string): Promise<void> {
    const repoPath = path.join(this.dataDir, 'repos', this.environmentId);
    
    try {
      await execAsync(`git -C "${repoPath}" worktree remove --force "${worktreePath}"`);
    } catch (error) {
      // Worktree might not exist in git - try to remove directory
      try {
        await fs.rmdir(worktreePath, { recursive: true });
      } catch (dirError) {
        // Directory might not exist - this is fine
      }
    }
  }

  /**
   * ENSURE BARE REPOSITORY - Repository setup
   * ========================================
   * 
   * Ensures the bare repository exists for this environment.
   * Creates and clones if necessary.
   * 
   * {P: environmentId ≠ null}
   * ensureBareRepository()
   * {Q: exists(repoPath) ∧ is_git_repo(repoPath) ∧ is_bare(repoPath)}
   */
  private async ensureBareRepository(): Promise<string> {
    const db = getDatabase();
    const repoPath = path.join(this.dataDir, 'repos', this.environmentId);

    // Check if repository already exists
    try {
      await fs.access(path.join(repoPath, 'config'));
      return repoPath;
    } catch (error) {
      // Repository doesn't exist - need to create it
    }

    // Get environment info
    const environment = await db
      .selectFrom('environments')
      .selectAll()
      .where('id', '=', this.environmentId)
      .executeTakeFirst();

    if (!environment?.repository_url) {
      throw new Error(`Environment ${this.environmentId} has no repository URL`);
    }

    // Create bare repository
    await fs.mkdir(path.dirname(repoPath), { recursive: true });
    await execAsync(`git clone --bare "${environment.repository_url}" "${repoPath}"`);
    
    console.log(`✅ Created bare repository at ${repoPath}`);
    return repoPath;
  }

  /**
   * PARSE WORKTREE LIST - Utility function
   * =====================================
   * 
   * Parses the output of `git worktree list --porcelain` into structured data.
   */
  private parseWorktreeList(output: string): GitWorktree[] {
    const worktrees: GitWorktree[] = [];
    const lines = output.split('\n');
    
    let currentWorktree: Partial<GitWorktree> = {};
    
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const worktreePath = line.substring(9);
        currentWorktree.path = worktreePath;
        currentWorktree.bare = false;
      } else if (line.startsWith('branch ')) {
        const branch = line.substring(7);
        currentWorktree.branch = branch;
      } else if (line === 'bare') {
        currentWorktree.bare = true;
      } else if (line === '' && currentWorktree.path) {
        // End of worktree entry
        if (currentWorktree.path && currentWorktree.branch !== undefined) {
          worktrees.push(currentWorktree as GitWorktree);
        }
        currentWorktree = {};
      }
    }
    
    return worktrees;
  }

  /**
   * CLEANUP SESSION - Session lifecycle management
   * =============================================
   * 
   * Cleans up worktree when session is deleted.
   * Only removes worktree if no other sessions use the same branch.
   * 
   * {P: sessionId ∈ Sessions}
   * cleanupSession(sessionId)
   * {Q: (¬∃s ∈ Sessions. s ≠ sessionId ∧ session_branch(s) = old_branch) 
   *     ⟹ ¬∃w ∈ Worktrees. w.branch = old_branch}
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const db = getDatabase();

    // Get session info
    const session = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();

    if (!session?.git_branch) {
      console.log(`Session ${sessionId} has no git branch, nothing to clean up`);
      return;
    }

    // Check if any other active sessions use this branch
    const otherSessions = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '!=', sessionId)
      .where('git_branch', '=', session.git_branch)
      .where('environment_id', '=', session.environment_id)
      .where('status', 'in', ['active', 'inactive'])
      .execute();

    if (otherSessions.length === 0) {
      // No other sessions use this branch - safe to remove worktree
      const worktree = await this.findWorktreeForBranch(session.git_branch);
      if (worktree) {
        await this.removeWorktree(worktree.path);
        console.log(`🧹 Removed worktree for branch ${session.git_branch} (no other sessions)`);
      }
    } else {
      console.log(`⚠️  Keeping worktree for branch ${session.git_branch} (${otherSessions.length} other sessions)`);
    }
  }
}

/**
 * FACTORY FUNCTION - Convenience wrapper
 * =====================================
 * 
 * Creates a WorktreeManager instance for the given environment.
 * This is the main entry point for the worktree management system.
 */
export function createWorktreeManager(environmentId: string): WorktreeManager {
  return new WorktreeManager(environmentId);
}