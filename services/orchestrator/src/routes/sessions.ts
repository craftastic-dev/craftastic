import { FastifyPluginAsync } from 'fastify';
import { getDatabase } from '../lib/kysely';
import { Session } from './environments';
import { worktreeService } from '../services/worktree';
import { createSandbox } from '../services/docker';
import { createWorktreeManager } from '../services/worktree-manager';
import os from 'os';

export const sessionRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  // Check session name availability
  server.get('/check-name/:environmentId/:name', async (request, reply) => {
    const { environmentId, name } = request.params as { environmentId: string; name: string };
    
    try {
      // Check for existing session with this name
      const existingSession = await db
        .selectFrom('sessions')
        .select(['id', 'name', 'created_at'])
        .where('environment_id', '=', environmentId)
        .where('name', '=', name)
        .where('status', '!=', 'dead')
        .executeTakeFirst();
      
      if (existingSession) {
        reply.send({
          available: false,
          name,
          message: `Session name "${name}" is already in use`,
          existingSession: {
            id: existingSession.id,
            name: existingSession.name,
            createdAt: existingSession.created_at.toISOString()
          }
        });
        return;
      }
      
      reply.send({
        available: true,
        name,
        message: 'Name is available'
      });
    } catch (error) {
      console.error('Error checking session name:', error);
      reply.code(500).send({ error: 'Failed to check session name' });
    }
  });

  // Create new session
  server.post('/', async (request, reply) => {
    const { 
      environmentId, 
      name, 
      branch,
      workingDirectory = '/workspace',
      sessionType = 'terminal',
      agentId 
    } = request.body as {
      environmentId: string;
      name?: string;
      branch?: string;
      workingDirectory?: string;
      sessionType?: 'terminal' | 'agent';
      agentId?: string;
    };

    try {
      // Verify environment exists
      const environment = await db
        .selectFrom('environments')
        .select(['id', 'status'])
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }

      // Check if environment is in error state (optional check)
      if (environment.status === 'error') {
        reply.code(400).send({ 
          error: 'Environment in error state',
          details: 'The environment is in an error state. Please check the environment configuration.'
        });
        return;
      }

      // If it's an agent session, verify the agent exists
      if (sessionType === 'agent' && agentId) {
        const agent = await db
          .selectFrom('agents')
          .select('id')
          .where('id', '=', agentId)
          .executeTakeFirst();

        if (!agent) {
          reply.code(404).send({ error: 'Agent not found' });
          return;
        }
      }

      // Get environment details early to determine branch
      const environmentDetails = await db
        .selectFrom('environments')
        .select(['repository_url', 'branch', 'name', 'user_id'])
        .where('id', '=', environmentId)
        .executeTakeFirst();

      // Use provided branch or fall back to environment's branch or 'main'
      let sessionBranch = branch || environmentDetails?.branch || 'main';
      
      // If name is not provided, default to the branch name
      const sessionName = name || sessionBranch;

      // Validate unique session name before creation
      if (sessionName) {
        console.log(`[Sessions] Checking for duplicate session name: ${sessionName} in environment ${environmentId}`);
        const existingNameSession = await db
          .selectFrom('sessions')
          .select(['id', 'name', 'created_at', 'last_activity', 'status'])
          .where('environment_id', '=', environmentId)
          .where('name', '=', sessionName)
          .where('status', '!=', 'dead')
          .executeTakeFirst();
        
        console.log(`[Sessions] Existing session check result:`, existingNameSession);
        
        if (existingNameSession) {
          console.log(`[Sessions] Duplicate session name found, returning 409`);
          reply.code(409).send({
            error: 'SESSION_NAME_IN_USE',
            message: `A session with name '${sessionName}' already exists in this environment`,
            existingSession: {
              id: existingNameSession.id,
              name: existingNameSession.name,
              createdAt: existingNameSession.created_at.toISOString(),
              lastActivity: existingNameSession.last_activity?.toISOString()
            }
          });
          return;
        }
      }

      // Validate unique branch before creation (for repository-based environments)
      if (environmentDetails?.repository_url) {
        const existingBranchSession = await db
          .selectFrom('sessions')
          .select(['id', 'name', 'created_at', 'last_activity'])
          .where('environment_id', '=', environmentId)
          .where('git_branch', '=', sessionBranch)
          .where('status', '!=', 'dead')
          .executeTakeFirst();
        
        if (existingBranchSession) {
          reply.code(409).send({
            error: 'BRANCH_IN_USE',
            message: `A session already exists for branch '${sessionBranch}' in this environment`,
            existingSession: {
              id: existingBranchSession.id,
              name: existingBranchSession.name,
              createdAt: existingBranchSession.created_at.toISOString(),
              lastActivity: existingBranchSession.last_activity?.toISOString()
            }
          });
          return;
        }
      }

      // Generate unique tmux session name
      const timestamp = Date.now();
      const tmuxSessionName = sessionName ? `${sessionName}-${timestamp}` : 
        sessionType === 'agent' ? `agent-${timestamp}` : `session-${timestamp}`;

      // Create session record
      const sessionData = await db
        .insertInto('sessions')
        .values({
          environment_id: environmentId,
          name: sessionName,
          tmux_session_name: tmuxSessionName,
          working_directory: workingDirectory,
          status: 'inactive',
          session_type: sessionType,
          agent_id: agentId || null,
          git_branch: environmentDetails?.repository_url ? sessionBranch : null, // Set branch immediately if it's a git environment
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      /**
       * SESSION CREATION WITH CONTAINER-NATIVE WORKTREES
       * ===============================================
       * 
       * Hoare Triple:
       * {P: environment_exists(environmentId) ∧ sessionBranch ≠ null}
       * create_session_with_container()
       * {Q: session_created ∧ session.container_id ≠ null ∧ 
       *     (repository_url ≠ null ⟹ worktree_created_at_/workspace)}
       * 
       * Container-Native Architecture:
       * - Sessions own containers (not environments)
       * - Bare repo mounted read-only at /data/repos/{env_id}
       * - Worktree created inside container at /workspace
       * - All git operations use absolute container paths
       * - Environments are pure git repository mappings
       */
      let finalWorkingDirectory = workingDirectory;
      let containerId: string | null = null;
      
      if (environmentDetails?.repository_url) {
        try {
          // Create worktree manager for this environment
          const worktreeManager = createWorktreeManager(environmentId);
          
          // Use new container-native approach - let worktreeManager handle everything
          containerId = await worktreeManager.ensureSessionContainer(
            sessionData.id,
            sessionBranch,
            sessionName || 'session',
            environmentDetails.name
          );
          
          finalWorkingDirectory = '/workspace';
          
          console.log(`✅ Created session ${sessionData.id} with container ${containerId} for branch ${sessionBranch}`);
        } catch (error) {
          console.error(`❌ Failed to create session ${sessionData.id} with container:`, error);
          // Mark session as failed but don't throw - let user see the error
          await db
            .updateTable('sessions')
            .set({
              status: 'dead',
              updated_at: new Date(),
            })
            .where('id', '=', sessionData.id)
            .execute();
          
          reply.code(500).send({ 
            error: 'Failed to create session with container',
            details: error.message 
          });
          return;
        }
      }
      
      // Update session with container and final details
      await db
        .updateTable('sessions')
        .set({
          container_id: containerId,
          working_directory: finalWorkingDirectory,
          git_branch: sessionBranch,
          status: containerId ? 'active' : 'inactive',
          updated_at: new Date(),
        })
        .where('id', '=', sessionData.id)
        .execute();

      // Refetch the session data to get the updated working directory
      const updatedSessionData = await db
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', sessionData.id)
        .executeTakeFirstOrThrow();

      const session: Session = {
        id: updatedSessionData.id,
        environmentId: updatedSessionData.environment_id,
        name: updatedSessionData.name,
        tmuxSessionName: updatedSessionData.tmux_session_name,
        workingDirectory: updatedSessionData.working_directory, // Use database value which may have been updated
        status: updatedSessionData.status,
        createdAt: updatedSessionData.created_at.toISOString(),
        updatedAt: updatedSessionData.updated_at.toISOString(),
        lastActivity: updatedSessionData.last_activity?.toISOString(),
        agentId: updatedSessionData.agent_id,
        sessionType: updatedSessionData.session_type,
        gitBranch: updatedSessionData.git_branch,
      };

      reply.send(session);
    } catch (error) {
      console.error('Error creating session:', error);
      reply.code(500).send({ error: 'Failed to create session' });
    }
  });

  // Get sessions for an environment
  server.get('/environment/:environmentId', async (request, reply) => {
    const { environmentId } = request.params as { environmentId: string };
    
    try {
      const sessions = await db
        .selectFrom('sessions')
        .selectAll()
        .where('environment_id', '=', environmentId)
        .orderBy('created_at', 'desc')
        .execute();
      
      const sessionList: Session[] = sessions.map(row => ({
        id: row.id,
        environmentId: row.environment_id,
        name: row.name,
        tmuxSessionName: row.tmux_session_name,
        workingDirectory: row.working_directory,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        lastActivity: row.last_activity?.toISOString(),
        agentId: row.agent_id,
        sessionType: row.session_type,
        gitBranch: row.git_branch,
      }));
      
      reply.send({ sessions: sessionList });
    } catch (error) {
      console.error('Error fetching sessions:', error);
      reply.code(500).send({ error: 'Failed to fetch sessions' });
    }
  });

  // Get a specific session
  server.get('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    
    try {
      const row = await db
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();
      
      if (!row) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }

      const session: Session = {
        id: row.id,
        environmentId: row.environment_id,
        name: row.name,
        tmuxSessionName: row.tmux_session_name,
        workingDirectory: row.working_directory,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        lastActivity: row.last_activity?.toISOString(),
        agentId: row.agent_id,
        sessionType: row.session_type,
        gitBranch: row.git_branch,
      };
      
      reply.send(session);
    } catch (error) {
      console.error('Error fetching session:', error);
      reply.code(500).send({ error: 'Failed to fetch session' });
    }
  });

  // Update session status
  server.patch('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { status } = request.body as { status: string };
    
    try {
      const row = await db
        .updateTable('sessions')
        .set({
          status: status as 'active' | 'inactive' | 'dead',
          updated_at: new Date(),
        })
        .where('id', '=', sessionId)
        .returningAll()
        .executeTakeFirst();
      
      if (!row) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }

      const session: Session = {
        id: row.id,
        environmentId: row.environment_id,
        name: row.name,
        tmuxSessionName: row.tmux_session_name,
        workingDirectory: row.working_directory,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        lastActivity: row.last_activity?.toISOString(),
        agentId: row.agent_id,
        sessionType: row.session_type,
        gitBranch: row.git_branch,
      };
      
      reply.send(session);
    } catch (error) {
      console.error('Error updating session:', error);
      reply.code(500).send({ error: 'Failed to update session' });
    }
  });

  // Check if a branch is available for a new session
  server.get('/check-branch/:environmentId/:branch', async (request, reply) => {
    const { environmentId, branch } = request.params as { environmentId: string; branch: string };
    
    try {
      const existingSession = await db
        .selectFrom('sessions')
        .select(['id', 'name', 'git_branch', 'created_at'])
        .where('environment_id', '=', environmentId)
        .where('git_branch', '=', branch)
        .where('status', '!=', 'dead')
        .executeTakeFirst();
      
      if (existingSession) {
        reply.send({
          available: false,
          branch,
          message: `Branch "${branch}" is already in use by session "${existingSession.name}"`,
          existingSession: {
            id: existingSession.id,
            name: existingSession.name,
            branch: existingSession.git_branch,
            createdAt: existingSession.created_at.toISOString()
          }
        });
        return;
      }
      
      reply.send({
        available: true,
        branch,
        message: 'Branch is available'
      });
    } catch (error) {
      console.error('Error checking branch availability:', error);
      reply.code(500).send({ error: 'Failed to check branch availability' });
    }
  });

  // Check real-time session status
  server.get('/:sessionId/status', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    
    try {
      // Get session with environment info
      const session = await db
        .selectFrom('sessions as s')
        .innerJoin('environments as e', 's.environment_id', 'e.id')
        .select([
          's.id',
          's.tmux_session_name',
          's.status as db_status',
          'e.container_id'
        ])
        .where('s.id', '=', sessionId)
        .executeTakeFirst();
      
      if (!session) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }
      
      // Default to database status
      let actualStatus = session.db_status;
      let isRealtime = false;
      
      // Check if container exists and is running
      if (session.container_id) {
        try {
          const { getDocker } = await import('../services/docker');
          const docker = getDocker();
          const container = docker.getContainer(session.container_id);
          const containerInfo = await container.inspect();
          
          if (!containerInfo.State.Running) {
            actualStatus = 'dead';
            isRealtime = true;
          } else {
            // Container is running, check if tmux session exists
            try {
              const exec = await container.exec({
                Cmd: ['tmux', 'has-session', '-t', session.tmux_session_name],
                AttachStdout: false,
                AttachStderr: false
              });
              
              const stream = await exec.start({ Detach: false });
              
              // Wait for command to complete
              await new Promise<void>((resolve) => {
                stream.on('end', () => resolve());
                // Set a timeout in case the command hangs
                setTimeout(() => resolve(), 2000);
              });
              
              // If we get here, tmux session exists
              // Status depends on whether it's currently connected (from database)
              actualStatus = session.db_status;
              isRealtime = true;
            } catch {
              // tmux has-session failed, session doesn't exist
              actualStatus = 'dead';
              isRealtime = true;
            }
          }
        } catch (error) {
          console.error(`Error checking real-time status for session ${sessionId}:`, error);
          // Fall back to database status
        }
      }
      
      // Update database if real-time status differs
      if (isRealtime && actualStatus !== session.db_status) {
        await db
          .updateTable('sessions')
          .set({ 
            status: actualStatus,
            updated_at: new Date()
          })
          .where('id', '=', sessionId)
          .execute();
      }
      
      reply.send({
        sessionId,
        status: actualStatus,
        isRealtime,
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error checking session status:', error);
      reply.code(500).send({ error: 'Failed to check session status' });
    }
  });

  // Delete session
  server.delete('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    
    try {
      // Get session details first
      const session = await db
        .selectFrom('sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();

      if (!session) {
        reply.code(404).send({ 
          error: 'Session not found',
          details: 'The session may have already been deleted or does not exist'
        });
        return;
      }

      // Kill the tmux session if it's running
      if (session.tmux_session_name && session.environment_id) {
        const environment = await db
          .selectFrom('environments')
          .select(['container_id'])
          .where('id', '=', session.environment_id)
          .executeTakeFirst();
          
        if (environment?.container_id) {
          const { killTmuxSession } = await import('../services/session-cleanup');
          await killTmuxSession(environment.container_id, session.tmux_session_name);
        }
      }

      // Clean up worktree if exists (check both worktree_path and git_branch)
      if (session.worktree_path || session.git_branch) {
        try {
          await worktreeService.removeWorktree(session.environment_id, sessionId);
          console.log(`🧹 Cleaned up worktree for session ${sessionId}`);
        } catch (error) {
          console.warn(`⚠️  Failed to cleanup worktree for session ${sessionId}:`, error.message);
          // Don't fail deletion if worktree cleanup fails
        }
      }

      // Delete session from database
      await db
        .deleteFrom('sessions')
        .where('id', '=', sessionId)
        .execute();

      reply.send({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
      console.error('Error deleting session:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete session';
      reply.code(500).send({ 
        error: 'Failed to delete session',
        details: errorMessage
      });
    }
  });
};