import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../lib/kysely';
import { gitHubAuthService } from '../services/github-auth';
import { worktreeService } from '../services/worktree';
import { userService } from '../services/user';
import { execCommand } from '../lib/exec';

// Request schemas
const CommitRequestSchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1),
  files: z.array(z.string()).optional(),
});

const PushRequestSchema = z.object({
  sessionId: z.string(),
  remote: z.string().default('origin'),
  branch: z.string().optional(),
});

const CreateBranchSchema = z.object({
  sessionId: z.string(),
  branchName: z.string().min(1),
  fromBranch: z.string().default('main'),
});

// Helper function to get session with user verification
async function getSessionWithUserVerification(sessionId: string, userId: string) {
  const resolvedUserId = await userService.resolveUserId(userId);
  
  const session = await getDatabase()
    .selectFrom('sessions')
    .innerJoin('environments', 'environments.id', 'sessions.environment_id')
    .selectAll('sessions')
    .select('environments.user_id')
    .where('sessions.id', '=', sessionId)
    .where('environments.user_id', '=', resolvedUserId)
    .executeTakeFirst();
    
  return session;
}

export default async function gitRoutes(fastify: FastifyInstance) {
  // GitHub Authentication Routes
  
  fastify.post('/api/auth/github/initiate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const deviceAuth = await gitHubAuthService.initiateDeviceFlow();
      
      return reply.send({
        success: true,
        data: deviceAuth,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.post('/api/auth/github/poll', async (request: FastifyRequest<{
    Body: { deviceCode: string; interval?: number };
  }>, reply: FastifyReply) => {
    try {
      const { deviceCode, interval = 5 } = request.body;
      const userId = request.user?.id;
      
      console.log(`[GitHub Poll] ============ STARTING POLL ATTEMPT ============`);
      console.log(`[GitHub Poll] User ID: ${userId}`);
      console.log(`[GitHub Poll] Device Code: ${deviceCode.substring(0, 8)}...`);
      console.log(`[GitHub Poll] Interval: ${interval}`);
      
      if (!userId) {
        console.log('[GitHub Poll] ❌ No user ID found in request');
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      const resolvedUserId = await userService.resolveUserId(userId);
      console.log(`[GitHub Poll] ✅ Resolved user ID: ${resolvedUserId}`);
      
      try {
        console.log('[GitHub Poll] 🔄 Calling gitHubAuthService.pollForToken...');
        console.log(`[GitHub Poll] GitHub API call starting at: ${new Date().toISOString()}`);
        
        const tokenResponse = await gitHubAuthService.pollForToken(deviceCode, interval);
        
        console.log('[GitHub Poll] ✅ TOKEN RECEIVED FROM GITHUB!');
        console.log(`[GitHub Poll] Token response type: ${typeof tokenResponse}`);
        console.log(`[GitHub Poll] Token response keys: ${Object.keys(tokenResponse)}`);
        console.log(`[GitHub Poll] Has access_token: ${!!tokenResponse.access_token}`);
        console.log(`[GitHub Poll] Token type: ${tokenResponse.token_type}`);
        console.log(`[GitHub Poll] Scope: ${tokenResponse.scope}`);
        
        console.log('[GitHub Poll] 💾 Saving token to database...');
        console.log(`[GitHub Poll] Saving for user ID: ${resolvedUserId}`);
        
        await gitHubAuthService.saveUserToken(resolvedUserId, tokenResponse);
        
        console.log('[GitHub Poll] ✅ TOKEN SAVED SUCCESSFULLY TO DATABASE!');
        console.log(`[GitHub Poll] Success response being sent at: ${new Date().toISOString()}`);
        
        return reply.send({
          success: true,
          message: 'GitHub authentication completed',
        });
      } catch (pollError: any) {
        // Check if it's an authorization_pending error (expected during device flow)
        if (pollError.message === 'authorization_pending') {
          console.log('[GitHub Poll] 🔄 Authorization still pending, returning pending status');
          return reply.send({
            success: false,
            pending: true,
            error: 'authorization_pending',
            message: 'Authorization is still pending',
          });
        }
        
        if (pollError.message === 'slow_down') {
          console.log('[GitHub Poll] 🐌 Slow down requested, returning slow down status');
          return reply.send({
            success: false,
            pending: true,
            error: 'slow_down',
            message: 'Please slow down polling',
          });
        }
        
        console.log(`[GitHub Poll] ❌ Unexpected error, re-throwing: ${pollError.message}`);
        throw pollError;
      }
    } catch (error) {
      console.error('[GitHub Poll] ❌ FINAL CATCH ERROR:', error);
      console.error('[GitHub Poll] Error type:', typeof error);
      console.error('[GitHub Poll] Error stack:', error.stack);
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.delete('/api/auth/github/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user?.id;
      
      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      const resolvedUserId = await userService.resolveUserId(userId);
      await gitHubAuthService.revokeUserToken(resolvedUserId);
      
      return reply.send({
        success: true,
        message: 'GitHub account disconnected',
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.get('/api/auth/github/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user?.id;
      console.log(`[GitHub Status] Raw user ID from request: ${userId}`);
      
      if (!userId) {
        console.log('[GitHub Status] No user ID found in request');
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      const resolvedUserId = await userService.resolveUserId(userId);
      console.log(`[GitHub Status] Resolved user ID: ${resolvedUserId}`);
      
      // Check what's actually in the database for this user
      const userRecord = await getDatabase()
        .selectFrom('users')
        .select(['id', 'github_username', 'github_access_token', 'github_token_expires_at'])
        .where('id', '=', resolvedUserId)
        .executeTakeFirst();
      
      console.log(`[GitHub Status] User record from DB:`, {
        id: userRecord?.id,
        github_username: userRecord?.github_username,
        has_token: !!userRecord?.github_access_token,
        token_expires_at: userRecord?.github_token_expires_at,
      });
      
      const hasValidToken = await gitHubAuthService.hasValidToken(resolvedUserId);
      console.log(`[GitHub Status] hasValidToken result: ${hasValidToken}`);
      
      let username = null;

      if (hasValidToken) {
        username = userRecord?.github_username;
      }

      const response = {
        success: true,
        data: {
          connected: hasValidToken,
          username,
        },
      };
      
      console.log(`[GitHub Status] Returning response:`, response);
      return reply.send(response);
    } catch (error) {
      console.error('[GitHub Status] Error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Git Operations Routes

  fastify.get('/api/git/status/:sessionId', async (request: FastifyRequest<{
    Params: { sessionId: string };
  }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      // Get session and verify ownership
      const session = await getSessionWithUserVerification(sessionId, userId);

      if (!session) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }

      if (!session.worktree_path) {
        return reply.status(400).send({ success: false, error: 'Session has no git worktree' });
      }

      // Get git status
      const { stdout } = await execCommand('git status --porcelain -b', {
        cwd: session.worktree_path,
      });

      // Parse git status output
      const lines = stdout.split('\n').filter(line => line.trim());
      const statusLine = lines[0] || '';
      const fileLines = lines.slice(1);

      // Parse branch info
      const branchMatch = statusLine.match(/## (.+?)(?:\.\.\.(.+?))?(?:\s+\[(.+?)\])?$/);
      const currentBranch = branchMatch?.[1] || session.git_branch || 'unknown';
      const upstreamBranch = branchMatch?.[2];
      const aheadBehind = branchMatch?.[3];

      let ahead = 0;
      let behind = 0;
      if (aheadBehind) {
        const aheadMatch = aheadBehind.match(/ahead (\d+)/);
        const behindMatch = aheadBehind.match(/behind (\d+)/);
        ahead = aheadMatch ? parseInt(aheadMatch[1]) : 0;
        behind = behindMatch ? parseInt(behindMatch[1]) : 0;
      }

      // Parse file changes
      const files = fileLines.map(line => {
        const status = line.substring(0, 2);
        const filename = line.substring(3);
        return {
          filename,
          status: status.trim(),
          staged: status[0] !== ' ' && status[0] !== '?',
          modified: status[1] !== ' ',
        };
      });

      return reply.send({
        success: true,
        data: {
          branch: currentBranch,
          upstream: upstreamBranch,
          ahead,
          behind,
          files,
          clean: files.length === 0,
        },
      });
    } catch (error) {
      console.error('Git status error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.get('/api/git/diff/:sessionId', async (request: FastifyRequest<{
    Params: { sessionId: string };
    Querystring: { file?: string; staged?: boolean };
  }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      const { file, staged } = request.query;
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      // Get session and verify ownership
      const session = await getSessionWithUserVerification(sessionId, userId);

      if (!session) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }

      if (!session.worktree_path) {
        return reply.status(400).send({ success: false, error: 'Session has no git worktree' });
      }

      // Build git diff command
      let command = 'git diff';
      if (staged) {
        command += ' --staged';
      }
      if (file) {
        command += ` -- "${file}"`;
      }

      const { stdout } = await execCommand(command, {
        cwd: session.worktree_path,
      });

      return reply.send({
        success: true,
        data: {
          diff: stdout,
          file: file || null,
          staged: staged || false,
        },
      });
    } catch (error) {
      console.error('Git diff error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.post('/api/git/commit/:sessionId', async (request: FastifyRequest<{
    Params: { sessionId: string };
    Body: z.infer<typeof CommitRequestSchema>;
  }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      
      // Validate request body with Zod
      const validatedBody = CommitRequestSchema.parse({
        sessionId,
        ...request.body
      });
      const { message, files } = validatedBody;
      
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      // Get session and verify ownership
      const session = await getSessionWithUserVerification(sessionId, userId);

      if (!session) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }

      if (!session.worktree_path) {
        return reply.status(400).send({ success: false, error: 'Session has no git worktree' });
      }

      // Set up git credentials
      const token = await gitHubAuthService.getUserToken(userId);
      if (!token) {
        return reply.status(400).send({ success: false, error: 'GitHub authentication required' });
      }

      // Add files if specified, otherwise add all
      if (files && files.length > 0) {
        for (const file of files) {
          await execCommand(`git add "${file}"`, {
            cwd: session.worktree_path,
          });
        }
      } else {
        await execCommand('git add .', {
          cwd: session.worktree_path,
        });
      }

      // Commit changes
      await execCommand(`git commit -m "${message}"`, {
        cwd: session.worktree_path,
      });

      // Log the operation
      await getDatabase()
        .insertInto('git_operations')
        .values({
          session_id: sessionId,
          operation_type: 'commit',
          status: 'success',
          metadata: { message, files },
        })
        .execute();

      return reply.send({
        success: true,
        message: 'Changes committed successfully',
      });
    } catch (error) {
      // Log failed operation
      await getDatabase()
        .insertInto('git_operations')
        .values({
          session_id: request.params.sessionId,
          operation_type: 'commit',
          status: 'error',
          error_message: error.message,
          metadata: request.body,
        })
        .execute()
        .catch(() => {}); // Ignore logging errors

      console.error('Git commit error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.post('/api/git/push/:sessionId', async (request: FastifyRequest<{
    Params: { sessionId: string };
    Body: z.infer<typeof PushRequestSchema>;
  }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      
      // Validate request body with Zod
      const validatedBody = PushRequestSchema.parse({
        sessionId,
        ...request.body
      });
      const { remote, branch } = validatedBody;
      
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      // Get session and verify ownership
      const session = await getDatabase()
        .selectFrom('sessions')
        .innerJoin('environments', 'environments.id', 'sessions.environment_id')
        .select(['sessions.worktree_path', 'sessions.git_branch', 'environments.user_id'])
        .where('sessions.id', '=', sessionId)
        .executeTakeFirst();

      if (!session || session.user_id !== userId) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }

      if (!session.worktree_path) {
        return reply.status(400).send({ success: false, error: 'Session has no git worktree' });
      }

      // Set up git credentials
      const token = await gitHubAuthService.getUserToken(userId);
      if (!token) {
        return reply.status(400).send({ success: false, error: 'GitHub authentication required' });
      }

      // Push changes
      const pushBranch = branch || session.git_branch || 'main';
      const { stdout, stderr } = await execCommand(`git push origin ${pushBranch}`, {
        cwd: session.worktree_path,
      });

      // Log the operation
      await getDatabase()
        .insertInto('git_operations')
        .values({
          session_id: sessionId,
          operation_type: 'push',
          status: 'success',
          metadata: { remote, branch: pushBranch, stdout, stderr },
        })
        .execute();

      return reply.send({
        success: true,
        message: `Changes pushed to ${remote}/${pushBranch}`,
        data: { stdout, stderr },
      });
    } catch (error) {
      // Log failed operation
      await getDatabase()
        .insertInto('git_operations')
        .values({
          session_id: request.params.sessionId,
          operation_type: 'push',
          status: 'error',
          error_message: error.message,
          metadata: request.body,
        })
        .execute()
        .catch(() => {}); // Ignore logging errors

      console.error('Git push error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  fastify.get('/api/git/log/:sessionId', async (request: FastifyRequest<{
    Params: { sessionId: string };
    Querystring: { limit?: number; offset?: number };
  }>, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params;
      const { limit = 10, offset = 0 } = request.query;
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      // Get session and verify ownership
      const session = await getSessionWithUserVerification(sessionId, userId);

      if (!session) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }

      if (!session.worktree_path) {
        return reply.status(400).send({ success: false, error: 'Session has no git worktree' });
      }

      // Get git log with JSON format
      const { stdout } = await execCommand(
        `git log --pretty=format:'{"hash":"%H","author":"%an","email":"%ae","date":"%ai","message":"%s"}' --skip=${offset} -n ${limit}`,
        { cwd: session.worktree_path }
      );

      const commits = stdout.split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(commit => commit !== null);

      return reply.send({
        success: true,
        data: {
          commits,
          limit,
          offset,
        },
      });
    } catch (error) {
      console.error('Git log error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // GitHub repository listing
  fastify.get('/api/auth/github/repos', async (request: FastifyRequest<{
    Querystring: { page?: number; per_page?: number; sort?: string };
  }>, reply: FastifyReply) => {
    try {
      const userId = request.user?.id;
      
      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      const resolvedUserId = await userService.resolveUserId(userId);
      const token = await gitHubAuthService.getUserToken(resolvedUserId);
      
      if (!token) {
        return reply.status(400).send({ success: false, error: 'GitHub authentication required' });
      }

      const { page = 1, per_page = 30, sort = 'updated' } = request.query;
      
      // Fetch user repositories from GitHub
      const response = await fetch(
        `https://api.github.com/user/repos?page=${page}&per_page=${per_page}&sort=${sort}&direction=desc`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const repos = await response.json();
      
      // Transform to simpler format
      const simplifiedRepos = repos.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        ssh_url: repo.ssh_url,
        private: repo.private,
        default_branch: repo.default_branch,
        updated_at: repo.updated_at,
        language: repo.language,
        stargazers_count: repo.stargazers_count,
        open_issues_count: repo.open_issues_count,
      }));

      return reply.send({
        success: true,
        data: {
          repositories: simplifiedRepos,
          page,
          per_page,
          total_count: repos.length,
        },
      });
    } catch (error) {
      console.error('List repositories error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Repository management routes

  fastify.get('/api/git/repo/:environmentId', async (request: FastifyRequest<{
    Params: { environmentId: string };
  }>, reply: FastifyReply) => {
    try {
      const { environmentId } = request.params;
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }

      // Resolve user ID and verify environment ownership
      const resolvedUserId = await userService.resolveUserId(userId);
      const environment = await getDatabase()
        .selectFrom('environments')
        .select('user_id')
        .where('id', '=', environmentId)
        .where('user_id', '=', resolvedUserId)
        .executeTakeFirst();

      if (!environment) {
        return reply.status(404).send({ success: false, error: 'Environment not found' });
      }

      const repoInfo = await worktreeService.getRepositoryInfo(environmentId);
      
      if (!repoInfo) {
        return reply.status(404).send({ 
          success: false, 
          error: 'No repository found for this environment' 
        });
      }

      return reply.send({
        success: true,
        data: repoInfo,
      });
    } catch (error) {
      console.error('Get repository error:', error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });
}