import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDocker } from '../services/docker';
import { getDatabase } from '../lib/kysely';

const gitCommitSchema = z.object({
  environmentId: z.string(),
  message: z.string(),
  files: z.array(z.string()).optional(),
});

const gitPushSchema = z.object({
  environmentId: z.string(),
  branch: z.string().default('main'),
});

export const gitRoutes: FastifyPluginAsync = async (server) => {
  const db = getDatabase();

  server.post('/commit', async (request, reply) => {
    const { environmentId, message, files } = gitCommitSchema.parse(request.body);
    
    try {
      // Get environment's container ID
      const environment = await db
        .selectFrom('environments')
        .select('container_id')
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }

      const containerId = environment.container_id;
      if (!containerId) {
        reply.code(400).send({ error: 'Environment container not available' });
        return;
      }

      const docker = getDocker();
      const container = docker.getContainer(containerId);
    
    const addCmd = files && files.length > 0 
      ? ['git', 'add', ...files]
      : ['git', 'add', '.'];
    
    const addExec = await container.exec({
      Cmd: addCmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const addStream = await addExec.start({});
    await new Promise((resolve) => addStream.on('end', resolve));
    
    const commitExec = await container.exec({
      Cmd: ['git', 'commit', '-m', message],
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const commitStream = await commitExec.start({});
    let output = '';
    
    commitStream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    
      await new Promise((resolve) => commitStream.on('end', resolve));
      
      return {
        success: true,
        output,
      };
    } catch (error) {
      console.error('Error in git commit:', error);
      reply.code(500).send({ error: 'Failed to commit' });
    }
  });

  server.post('/push', async (request, reply) => {
    const { environmentId, branch } = gitPushSchema.parse(request.body);
    
    try {
      // Get environment's container ID
      const environment = await db
        .selectFrom('environments')
        .select('container_id')
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }

      const containerId = environment.container_id;
      if (!containerId) {
        reply.code(400).send({ error: 'Environment container not available' });
        return;
      }

      const docker = getDocker();
      const container = docker.getContainer(containerId);
      
      const pushExec = await container.exec({
        Cmd: ['git', 'push', 'origin', branch],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const pushStream = await pushExec.start({});
      let output = '';
      
      pushStream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      
      await new Promise((resolve) => pushStream.on('end', resolve));
      
      return {
        success: true,
        output,
      };
    } catch (error) {
      console.error('Error in git push:', error);
      reply.code(500).send({ error: 'Failed to push' });
    }
  });

  server.get('/status/:environmentId', async (request, reply) => {
    const { environmentId } = request.params as { environmentId: string };
    
    try {
      // Get environment's container ID
      const environment = await db
        .selectFrom('environments')
        .select('container_id')
        .where('id', '=', environmentId)
        .executeTakeFirst();

      if (!environment) {
        reply.code(404).send({ error: 'Environment not found' });
        return;
      }

      const containerId = environment.container_id;
      if (!containerId) {
        reply.code(400).send({ error: 'Environment container not available' });
        return;
      }

      const docker = getDocker();
      const container = docker.getContainer(containerId);
      
      const statusExec = await container.exec({
        Cmd: ['git', 'status', '--porcelain'],
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const statusStream = await statusExec.start({});
      let output = '';
      
      statusStream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      
      await new Promise((resolve) => statusStream.on('end', resolve));
      
      const files = output
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [status, ...pathParts] = line.trim().split(' ');
          return {
            status,
            path: pathParts.join(' '),
          };
        });
      
      return { files };
    } catch (error) {
      console.error('Error in git status:', error);
      reply.code(500).send({ error: 'Failed to get git status' });
    }
  });
};