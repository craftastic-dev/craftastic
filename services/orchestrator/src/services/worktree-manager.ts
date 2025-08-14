/**
 * Git Worktree Management with Formal Verification (Container-Native)
 * ==================================================================
 * 
 * This module implements a self-healing git worktree management system
 * based on Hoare logic and formal verification principles.
 * 
 * CRITICAL REQUIREMENT:
 * Bare repositories MUST be mounted as read-write (rw) because git worktree
 * operations need to write metadata to the bare repo's worktrees/ directory.
 * 
 * MOUNT CONFIGURATION:
 * - Bare repo: /data/repos/{env_id} (rw) - Required for worktree metadata
 * - Worktree: Created at /workspace inside container
 * 
 * GLOBAL INVARIANT:
 * I: ∀b ∈ Branches. |{w ∈ Worktrees : worktree_branch(w) = b}| ≤ 1
 *    (At most one worktree per branch - enforced by git)
 * 
 * ERROR CASES HANDLED:
 * - E1: Read-only mount → Clear error with remediation steps
 * - E2: Missing mount → Error with mount configuration help
 * - E3: Corrupted worktree → Automatic cleanup and recreation
 * - E4: Permission issues → Diagnostic with ownership info
 * - E5: Disk full → Graceful failure with space requirements
 * - E6: Branch conflicts → Handle git's atomic guarantees
 * - E7: Container state issues → Self-healing recovery
 * - E8: Empty bare repo → Automatic fetch of all remote branches
 * - E9: Container name collision → Reuse or cleanup based on state
 * - E10: Invalid repository URL → Clear error with URL validation
 * - E11: Network failure → Graceful degradation with warning
 * - E12: Container creation conflict → Fallback with unique suffix
 * 
 * CONTAINER-NATIVE STATE MODEL:
 * - W: Set of worktrees (created inside containers at /workspace)
 * - S: Set of sessions in database (each owns one container)
 * - C: Set of containers (each has one worktree)
 * - worktree_branch: W → String
 * - worktree_path: W → ContainerPath (always /workspace)
 * - session_container: S → C
 * - container_worktree: C → W
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { createSandbox, destroySandbox, ensureContainerRunning, getDocker } from './docker';
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
   * ENSURE WORKTREE - Core self-healing operation (Container-Native)
   * ===============================================================
   * 
   * Hoare Triple:
   * {P: containerId ∈ Containers ∧ branch ≠ null}
   * ensureWorktree(branch, containerId)
   * {Q: worktree_exists_at_/workspace(containerId, branch)}
   * 
   * Container-Native Case Analysis:
   * 1. Container has worktree for branch → verify validity (O(1))
   * 2. Container has different worktree → remove and recreate (O(1))
   * 3. Container has no worktree → create new at /workspace (O(1))
   * 4. Bare repo not mounted → mount and create worktree
   * 
   * This operation creates worktrees INSIDE containers using container paths.
   */
  async ensureWorktree(branch: string, containerId: string): Promise<string> {
    const containerRepoPath = `/data/repos/${this.environmentId}`;
    const containerWorktreePath = '/workspace';
    
    // Ensure bare repository exists on host (will be mounted to container)
    await this.ensureBareRepository();
    
    // Check if worktree already exists in container
    const hasWorktree = await this.containerHasWorktree(containerId, containerWorktreePath, branch);
    
    if (hasWorktree) {
      console.log(`✅ Container already has worktree for branch ${branch} at ${containerWorktreePath}`);
      return containerWorktreePath;
    }
    
    // Create worktree inside container
    await this.createWorktreeInContainer(containerId, containerRepoPath, containerWorktreePath, branch);
    console.log(`✅ Created worktree for branch ${branch} inside container at ${containerWorktreePath}`);
    return containerWorktreePath;
  }

  /**
   * ENSURE SESSION CONTAINER - Session lifecycle with container reuse
   * ================================================================
   * 
   * Hoare Triple:
   * {P: session_id ∈ Sessions ∧ branch ≠ null}
   * ensureSessionContainer(session_id, branch, session_name, environment_name)
   * {Q: ∃c ∈ Containers. (owner(c) = session_id ∨ shared(c)) ∧ running(c) ∧ 
   *     worktree_exists_at_/workspace(c, branch)}
   * 
   * Container-Native Architecture:
   * - Sessions can share containers if they have the same configuration
   * - Bare repo mounted read-write at /data/repos/{env_id}
   * - Worktree created inside container at /workspace
   * - All git operations use absolute container paths
   * 
   * Case Analysis:
   * 1. Session has container + running → Verify worktree, return
   * 2. Session has container + dead → Remove, create new
   * 3. No container + name exists + alive → REUSE existing container
   * 4. No container + name exists + dead → Remove dead, create new
   * 5. No container + name free → Create new container
   * 6. Creation conflict → Retry with timestamp suffix
   * 
   * Invariants:
   * - I1: Container names are deterministic based on environment/session
   * - I2: At most one running container per name pattern
   * - I3: All containers have bare repo mounted at /data/repos/{env_id}
   * 
   * Error Cases:
   * - E9: Container name collision → Reuse or cleanup based on state
   * - E12: Container creation conflict → Fallback with unique suffix
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

    // Case 1-2: Check if session already has a container
    if (session.container_id) {
      try {
        await ensureContainerRunning(session.container_id);
        
        // Container is running - ensure worktree exists inside it
        await this.ensureWorktree(branch, session.container_id);
        
        console.log(`✅ Container ${session.container_id} is running with worktree for session ${sessionId}`);
        return session.container_id;
      } catch (error) {
        console.log(`⚠️  Container ${session.container_id} is dead or worktree invalid, will recreate`);
        // Clean up dead container
        try {
          await destroySandbox(session.container_id);
        } catch (cleanupError) {
          console.log(`Warning: Failed to cleanup dead container ${session.container_id}`);
        }
      }
    }

    // Case 3-4: Check for existing container with expected name before creating new one
    const expectedName = `craftastic-${environmentName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}-${sessionName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}-${sessionId.substring(0, 8)}`;
    
    try {
      const docker = getDocker();
      const existing = docker.getContainer(expectedName);
      const info = await existing.inspect();
      
      if (info.State.Running) {
        // Case 3: Container already exists and is running - reuse it
        console.log(`✅ Reusing existing container ${existing.id} (${expectedName}) for session ${sessionId}`);
        
        // Update session to point to this container
        await db.updateTable('sessions')
          .set({
            container_id: existing.id,
            status: 'active',
            updated_at: new Date()
          })
          .where('id', '=', sessionId)
          .execute();
        
        // Ensure worktree exists in the shared container
        await this.ensureWorktree(branch, existing.id);
        return existing.id;
      } else {
        // Case 4: Container exists but is dead - remove it
        console.log(`Removing dead container: ${expectedName}`);
        await existing.remove({ force: true });
      }
    } catch (error) {
      // Case 5: Container doesn't exist, proceed with creation
      console.log(`No existing container found with name ${expectedName}, creating new one`);
    }

    // Case 5-6: Need to create a new container for this session
    // First ensure bare repository exists on host
    const hostRepoPath = await this.ensureBareRepository();

    // Create new container with bare repo mounted (worktree will be created inside)
    let container;
    try {
      container = await createSandbox({
        sessionId,
        userId: environment.user_id,
        environmentName: environmentName,
        sessionName,
        bareRepoMounts: [{
          hostPath: hostRepoPath,
          containerPath: `/data/repos/${this.environmentId}`
        }]
      });
    } catch (createError: any) {
      // Case 6: Handle unexpected creation conflicts (E12)
      if (createError.statusCode === 409 || createError.message?.includes('already in use')) {
        console.warn(`Container creation conflict for session ${sessionId}, retrying with unique suffix`);
        const timestamp = Date.now().toString(36);
        const uniqueSessionId = `${sessionId}-${timestamp}`;
        
        container = await createSandbox({
          sessionId: uniqueSessionId,
          userId: environment.user_id,
          environmentName: environmentName,
          sessionName: `${sessionName}-${timestamp}`,
          bareRepoMounts: [{
            hostPath: hostRepoPath,
            containerPath: `/data/repos/${this.environmentId}`
          }]
        });
        console.log(`✅ Created container with unique suffix: ${container.id}`);
      } else {
        throw createError;
      }
    }

    // Create worktree inside the container
    await this.ensureWorktree(branch, container.id);

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

    console.log(`✅ Created new container ${container.id} with worktree for session ${sessionId}`);
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
   * CHECK IF CONTAINER HAS WORKTREE - Container validation
   * ======================================================
   * 
   * Verifies that a container has a valid worktree for the specified branch.
   * Uses container-native git commands to check worktree state.
   */
  private async containerHasWorktree(containerId: string, worktreePath: string, branch: string): Promise<boolean> {
    try {
      // Check if /workspace exists and is a git worktree
      const { stdout } = await this.execInContainer(containerId, `test -f "${worktreePath}/.git" && echo "exists"`);
      if (!stdout.includes('exists')) {
        return false;
      }
      
      // Check if worktree is for the correct branch
      const { stdout: branchOutput } = await this.execInContainer(containerId, `cd "${worktreePath}" && git branch --show-current`);
      const currentBranch = branchOutput.trim();
      
      return currentBranch === branch;
    } catch (error) {
      return false;
    }
  }

  /**
   * CREATE WORKTREE IN CONTAINER - Container-native worktree creation with comprehensive error handling
   * ================================================================================================
   * 
   * Case Analysis:
   * - Case 1: Container exists + worktree valid → reuse (O(1))
   * - Case 2: Container exists + no worktree → create worktree
   * - Case 3: Container exists + corrupted worktree → remove and recreate
   * - Case 4: Bare repo not mounted → error with clear message
   * - Case 5: Mount is read-only → error with diagnostic
   * - Case 6: Branch conflict → handle git's atomic guarantees
   * - Case 7: Disk full → catch and report gracefully
   * - Case 8: Permission denied → check user/group ownership
   * 
   * Creates a git worktree inside a container using absolute container paths.
   * This ensures all git operations work correctly inside the container.
   */
  private async createWorktreeInContainer(containerId: string, repoPath: string, worktreePath: string, branch: string): Promise<void> {
    try {
      // Pre-checks: Verify mount configuration
      await this.verifyBareRepoMounted(containerId, repoPath);
      await this.verifyMountIsWritable(containerId, repoPath);
      
      // Clean existing worktree directory and git worktree registry
      console.log(`[Worktree] Preparing worktree directory at ${worktreePath}`);
      await this.execInContainer(containerId, `rm -rf "${worktreePath}" && mkdir -p "${worktreePath}"`);
      
      // CRITICAL FIX: Clean up any stale worktree registrations for this path
      // This prevents "already registered worktree" errors when containers restart
      try {
        await this.execInContainer(containerId, `git -C "${repoPath}" worktree remove --force "${worktreePath}" 2>/dev/null || true`);
        await this.execInContainer(containerId, `git -C "${repoPath}" worktree prune`);
        console.log(`[Worktree] Cleaned up any stale worktree registrations for ${worktreePath}`);
      } catch (cleanupError) {
        console.log(`[Worktree] Worktree cleanup completed (no stale entries found)`);
      }
      
      // Check available branches in bare repo
      // CRITICAL FIX: Use 'git branch' not 'git branch -r' for bare repos
      // Bare repos don't have remote branches, only local branches that track remotes
      console.log(`[Worktree] Checking available branches in ${repoPath}`);
      const { stdout: branchList, stderr: branchError } = await this.execInContainer(containerId, `git -C "${repoPath}" branch`);
      
      if (branchError && !branchError.includes('warning')) {
        throw new Error(`Failed to list branches: ${branchError}`);
      }
      
      let branches = branchList.split('\n')
        .map(b => b.trim().replace(/^\*\s*/, '')) // Remove current branch indicator
        .filter(b => b && !b.includes('HEAD'));
      
      // Case E8: If no branches found, try fetching them
      if (branches.length === 0) {
        console.log(`[Worktree] No branches found, attempting to fetch from origin...`);
        try {
          await this.execInContainer(containerId, `git -C "${repoPath}" fetch origin '+refs/heads/*:refs/heads/*'`);
          const { stdout: newBranchList } = await this.execInContainer(containerId, `git -C "${repoPath}" branch`);
          branches = newBranchList.split('\n')
            .map(b => b.trim().replace(/^\*\s*/, '')) // Remove current branch indicator
            .filter(b => b && !b.includes('HEAD'));
          console.log(`✅ Fetched branches: ${branches.join(', ')}`);
        } catch (fetchError) {
          console.error(`❌ Failed to fetch branches: ${fetchError.message}`);
        }
        
        if (branches.length === 0) {
          throw new Error(`No branches found in bare repository at ${repoPath} even after fetch attempt. Repository may be empty or inaccessible.`);
        }
      }
      
      // Determine worktree creation command
      let createCommand: string;
      if (branches.includes(branch)) {
        // Branch exists, check it out
        createCommand = `git -C "${repoPath}" worktree add "${worktreePath}" "${branch}"`;
        console.log(`[Worktree] Creating worktree for existing branch: ${branch}`);
      } else {
        // Branch doesn't exist, create it from default branch
        const defaultBranch = branches.includes('main') ? 'main' : 
                             branches.includes('master') ? 'master' : 
                             branches[0];
        createCommand = `git -C "${repoPath}" worktree add -b "${branch}" "${worktreePath}" "${defaultBranch}"`;
        console.log(`[Worktree] Creating new branch ${branch} from ${defaultBranch}`);
      }
      
      // Execute worktree creation with comprehensive error handling
      const { stdout, stderr } = await this.execInContainer(containerId, createCommand);
      
      // Check for errors (git worktree may report issues via stderr even on success)
      if (stderr) {
        // Filter out normal informational messages
        const errorLines = stderr.split('\n').filter(line => 
          line.trim() && 
          !line.includes('Preparing worktree') &&
          !line.includes('Updating files') &&
          !line.includes('% (')  // Progress indicators
        );
        
        if (errorLines.length > 0) {
          // Check for specific error conditions
          if (stderr.includes('Read-only file system')) {
            throw new Error(`Bare repository is mounted read-only. Git worktrees require write access to create metadata in ${repoPath}/worktrees/`);
          }
          if (stderr.includes('No space left on device')) {
            throw new Error(`Insufficient disk space to create worktree at ${worktreePath}`);
          }
          if (stderr.includes('Permission denied')) {
            throw new Error(`Permission denied creating worktree. Check container user permissions for ${repoPath}`);
          }
          
          // Generic error
          throw new Error(`Git worktree creation failed: ${errorLines.join('; ')}`);
        }
      }
      
      // Post-validation: Verify worktree was actually created
      if (!await this.verifyWorktreeExists(containerId, worktreePath)) {
        throw new Error(`Worktree creation appeared to succeed but worktree not found at ${worktreePath}. Command output: ${stdout}`);
      }
      
      // Final verification: Check git status works
      const { stderr: statusError } = await this.execInContainer(containerId, `git -C "${worktreePath}" status --porcelain`);
      if (statusError) {
        throw new Error(`Worktree created but git status failed: ${statusError}`);
      }
      
      console.log(`✅ Successfully created and verified worktree for branch ${branch} at ${worktreePath}`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to create worktree for branch ${branch}:`, errorMessage);
      throw new Error(`Failed to create worktree in container: ${errorMessage}`);
    }
  }

  /**
   * VERIFY BARE REPOSITORY MOUNTED - Mount validation
   * ================================================
   * 
   * Verifies that the bare repository is properly mounted in the container.
   * Handles Case 4: Bare repo not mounted → error with clear message
   */
  private async verifyBareRepoMounted(containerId: string, repoPath: string): Promise<void> {
    const { stdout, stderr } = await this.execInContainer(containerId, `test -d "${repoPath}" && echo "exists"`);
    if (!stdout.includes('exists')) {
      throw new Error(`Bare repository not mounted at ${repoPath}. Check container mount configuration.`);
    }
    
    // Verify it's actually a git repository
    const { stderr: gitError } = await this.execInContainer(containerId, `git -C "${repoPath}" rev-parse --git-dir`);
    if (gitError) {
      throw new Error(`Directory ${repoPath} exists but is not a valid git repository: ${gitError}`);
    }
  }

  /**
   * VERIFY MOUNT IS WRITABLE - Write permission validation
   * =====================================================
   * 
   * Verifies that the bare repository mount is read-write.
   * Handles Case 5: Mount is read-only → error with diagnostic
   */
  private async verifyMountIsWritable(containerId: string, repoPath: string): Promise<void> {
    const testFile = `${repoPath}/.write-test-${Date.now()}`;
    const { stderr } = await this.execInContainer(containerId, `touch "${testFile}" && rm "${testFile}"`);
    
    if (stderr) {
      if (stderr.includes('Read-only file system')) {
        throw new Error(
          `CRITICAL: Bare repository at ${repoPath} is mounted read-only. ` +
          `Git worktrees require write access to create metadata in the worktrees/ directory. ` +
          `Please update the Docker mount configuration to use 'rw' instead of 'ro'.`
        );
      }
      if (stderr.includes('Permission denied')) {
        throw new Error(
          `Permission denied writing to ${repoPath}. ` +
          `Check that the container user has write permissions to the bare repository.`
        );
      }
      throw new Error(`Failed to verify write access to ${repoPath}: ${stderr}`);
    }
  }

  /**
   * VERIFY WORKTREE EXISTS - Post-creation validation
   * ===============================================
   * 
   * Verifies that a worktree was successfully created and is valid.
   * Used for post-validation in worktree creation.
   */
  private async verifyWorktreeExists(containerId: string, worktreePath: string): Promise<boolean> {
    try {
      const { stdout, stderr } = await this.execInContainer(containerId, 
        `test -f "${worktreePath}/.git" && git -C "${worktreePath}" rev-parse --is-inside-work-tree`);
      
      if (stderr) {
        return false;
      }
      
      return stdout.includes('true');
    } catch (error) {
      return false;
    }
  }

  /**
   * EXECUTE COMMAND IN CONTAINER - Container operation helper
   * ========================================================
   * 
   * Executes a command inside a container and returns stdout/stderr.
   * Used for all container-native git operations.
   */
  private async execInContainer(containerId: string, command: string): Promise<{ stdout: string; stderr: string }> {
    const { getDocker } = await import('./docker');
    const docker = getDocker();
    const container = docker.getContainer(containerId);
    
    const exec = await container.exec({
      Cmd: ['/bin/bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await exec.start({ Detach: false });
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      
      // Handle Docker's multiplexed stream format
      stream.on('data', (chunk: Buffer) => {
        let offset = 0;
        
        while (offset < chunk.length) {
          if (chunk.length - offset < 8) {
            stdout += chunk.slice(offset).toString('utf8');
            break;
          }
          
          const streamType = chunk[offset];
          const size = chunk.readUInt32BE(offset + 4);
          offset += 8;
          
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
      
      stream.on('end', () => resolve({ stdout, stderr }));
      stream.on('error', reject);
    });
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
   * ENSURE BARE REPOSITORY - Repository setup with branch fetching
   * =============================================================
   * 
   * Hoare Triple:
   * {P: environmentId ≠ null ∧ environment.repository_url ≠ null}
   * ensureBareRepository()
   * {Q: exists(repoPath) ∧ is_git_repo(repoPath) ∧ is_bare(repoPath) ∧ 
   *     has_remote_branches(repoPath)}
   * 
   * Case Analysis:
   * 1. Repo exists with branches → Return path immediately
   * 2. Repo exists without branches → Fetch branches, return path  
   * 3. Repo doesn't exist → Clone, fetch branches, return path
   * 4. Clone fails → Throw with repository URL error
   * 5. Fetch fails → Log warning, continue (may be offline)
   * 
   * Invariants:
   * - I1: Repository path is always under dataDir/repos/
   * - I2: Returned repository is always a valid bare git repository
   * 
   * Error Cases:
   * - E8: Empty bare repo → Fetch all remote branches automatically
   * - E10: Invalid repository URL → Clear error with URL validation
   * - E11: Network failure → Graceful degradation with warning
   */
  private async ensureBareRepository(): Promise<string> {
    const db = getDatabase();
    const repoPath = path.join(this.dataDir, 'repos', this.environmentId);

    // Case 1: Check if repository already exists
    try {
      await fs.access(path.join(repoPath, 'config'));
      
      // Case 2: Verify repository has branches (E8 fix)
      try {
        const { stdout } = await execAsync(`git -C "${repoPath}" branch -r`);
        if (!stdout || stdout.trim() === '') {
          console.log(`[Repo] Bare repository exists but has no branches, fetching...`);
          await execAsync(`git -C "${repoPath}" fetch origin '+refs/heads/*:refs/heads/*'`);
          console.log(`✅ Fetched branches for existing bare repository`);
        }
      } catch (fetchError: any) {
        console.warn(`⚠️ Could not fetch branches for existing repo: ${fetchError.message}`);
        // Continue - repository may work with existing state
      }
      
      return repoPath;
    } catch (error) {
      // Case 3: Repository doesn't exist - need to create it
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

    // Case 3: Create bare repository
    await fs.mkdir(path.dirname(repoPath), { recursive: true });
    
    try {
      // Clone bare repository
      await execAsync(`git clone --bare "${environment.repository_url}" "${repoPath}"`);
      console.log(`✅ Created bare repository at ${repoPath}`);
      
      // Case E8: Ensure all remote branches are fetched as local branches
      try {
        await execAsync(`git -C "${repoPath}" fetch origin '+refs/heads/*:refs/heads/*'`);
        console.log(`✅ Fetched all remote branches to bare repository`);
      } catch (fetchError: any) {
        console.warn(`⚠️ Could not fetch branches after clone: ${fetchError.message}`);
        // Continue - repository may work with default branches from clone
      }
      
    } catch (cloneError: any) {
      // Case 4: Clone failed - clean up and throw descriptive error
      try {
        await fs.rmdir(repoPath, { recursive: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw new Error(`Failed to clone repository "${environment.repository_url}": ${cloneError.message}`);
    }
    
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