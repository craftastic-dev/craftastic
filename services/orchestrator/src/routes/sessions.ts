import { FastifyPluginAsync } from 'fastify';
import { getDatabase } from '../lib/kysely';
import { Session } from './environments';
import { worktreeService } from '../services/worktree';
import os from 'os';

export const sessionRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  // Create new session
  server.post('/', async (request, reply) => {
    const { 
      environmentId, 
      name, 
      workingDirectory = '/workspace',
      sessionType = 'terminal',
      agentId 
    } = request.body as {
      environmentId: string;
      name?: string;
      workingDirectory?: string;
      sessionType?: 'terminal' | 'agent';
      agentId?: string;
    };

    try {
      // Verify environment exists
      const environment = await db
        .selectFrom('environments')
        .select('id')
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
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

      // Generate unique tmux session name
      const timestamp = Date.now();
      const tmuxSessionName = name ? `${name}-${timestamp}` : 
        sessionType === 'agent' ? `agent-${timestamp}` : `session-${timestamp}`;

      // Create session record
      const sessionData = await db
        .insertInto('sessions')
        .values({
          environment_id: environmentId,
          name,
          tmux_session_name: tmuxSessionName,
          working_directory: workingDirectory,
          status: 'inactive',
          session_type: sessionType,
          agent_id: agentId || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // If environment has a repository, create a worktree for this session
      const environmentDetails = await db
        .selectFrom('environments')
        .select(['repository_url', 'branch'])
        .where('id', '=', environmentId)
        .executeTakeFirst();

      let finalWorkingDirectory = workingDirectory;
      let sessionBranch = environmentDetails?.branch || 'main';
      
      if (environmentDetails?.repository_url) {
        // Check if another session already exists for this branch
        const existingBranchSession = await db
          .selectFrom('sessions')
          .select(['id', 'name', 'created_at', 'last_activity'])
          .where('environment_id', '=', environmentId)
          .where('git_branch', '=', sessionBranch)
          .where('status', '!=', 'dead')
          .where('id', '!=', sessionData.id) // Exclude the session we just created
          .executeTakeFirst();
          
        if (existingBranchSession) {
          // Delete the session we just created since branch is already in use
          await db
            .deleteFrom('sessions')
            .where('id', '=', sessionData.id)
            .execute();
            
          reply.code(409).send({
            error: 'BRANCH_IN_USE',
            message: `A session already exists for branch '${sessionBranch}'`,
            existingSession: {
              id: existingBranchSession.id,
              name: existingBranchSession.name,
              createdAt: existingBranchSession.created_at.toISOString(),
              lastActivity: existingBranchSession.last_activity?.toISOString()
            }
          });
          return;
        }
        try {
          const worktreePath = await worktreeService.createWorktree({
            environmentId,
            sessionId: sessionData.id,
            repositoryUrl: environmentDetails.repository_url,
            branch: environmentDetails.branch || 'main',
          });
          // Convert host path to container path (data directory is mounted at /data)
          const dataDir = process.env.CRAFTASTIC_DATA_DIR || os.homedir() + '/.craftastic';
          const relativeWorktreePath = worktreePath.replace(dataDir, '');
          finalWorkingDirectory = `/data${relativeWorktreePath}`;
          
          // Update session with the container working directory and branch
          await db
            .updateTable('sessions')
            .set({
              working_directory: finalWorkingDirectory,
              git_branch: sessionBranch,
              updated_at: new Date(),
            })
            .where('id', '=', sessionData.id)
            .execute();
          
          console.log(`✅ Created worktree for session ${sessionData.id}: ${worktreePath} -> ${finalWorkingDirectory}`);
        } catch (error) {
          console.warn(`⚠️  Failed to create worktree for session ${sessionData.id}:`, error.message);
          // Don't fail session creation if worktree creation fails
        }
      }

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
  server.get('/check-branch', async (request, reply) => {
    const { environmentId, branch } = request.query as { environmentId: string; branch: string };
    
    if (!environmentId || !branch) {
      reply.code(400).send({ error: 'environmentId and branch are required' });
      return;
    }
    
    try {
      const existingSession = await db
        .selectFrom('sessions')
        .select(['id', 'name', 'created_at', 'last_activity'])
        .where('environment_id', '=', environmentId)
        .where('git_branch', '=', branch)
        .where('status', '!=', 'dead')
        .executeTakeFirst();
        
      reply.send({
        available: !existingSession,
        existingSession: existingSession ? {
          id: existingSession.id,
          name: existingSession.name,
          createdAt: existingSession.created_at.toISOString(),
          lastActivity: existingSession.last_activity?.toISOString()
        } : null
      });
    } catch (error) {
      console.error('Error checking branch availability:', error);
      reply.code(500).send({ error: 'Failed to check branch availability' });
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
        reply.code(404).send({ error: 'Session not found' });
        return;
      }

      // TODO: Kill the tmux session if it's running
      // This would require executing `tmux kill-session -t ${session.tmux_session_name}` 
      // in the environment's container

      // Clean up worktree if exists
      if (session.worktree_path) {
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

      reply.send({ success: true });
    } catch (error) {
      console.error('Error deleting session:', error);
      reply.code(500).send({ error: 'Failed to delete session' });
    }
  });
};