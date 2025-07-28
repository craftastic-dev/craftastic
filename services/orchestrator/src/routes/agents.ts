import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../lib/kysely';
import { encryptCredentials, decryptCredentials } from '../lib/encryption.js';

// Validation schemas
const CreateAgentSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(255),
  type: z.enum(['claude-code', 'gemini-cli', 'qwen-coder']),
  credential: z.object({
    type: z.string().min(1), // oauth, anthropic_api_key, etc.
    value: z.string().min(1) // credential value
  }).optional()
});

const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  credential: z.object({
    type: z.string().min(1),
    value: z.string().min(1)
  }).optional()
});

const agents: FastifyPluginAsync = async function (fastify) {
  const db = getDatabase();
  
  // Get all agents for a user
  fastify.get('/user/:userId', async function (request, reply) {
    const { userId } = request.params as { userId: string };

    try {
      const agents = await db
        .selectFrom('agents')
        .leftJoin('agent_credentials', 'agents.id', 'agent_credentials.agent_id')
        .select([
          'agents.id',
          'agents.user_id',
          'agents.name',
          'agents.type',
          'agents.created_at',
          'agents.updated_at',
          'agent_credentials.type as credential_type'
        ])
        .where('agents.user_id', '=', userId)
        .execute();

      // Transform to include single credential type per agent
      const agentsMap = new Map();
      agents.forEach((row: any) => {
        if (!agentsMap.has(row.id)) {
          agentsMap.set(row.id, {
            id: row.id,
            user_id: row.user_id,
            name: row.name,
            type: row.type,
            created_at: row.created_at,
            updated_at: row.updated_at,
            credential_type: row.credential_type || null
          });
        }
      });

      reply.send({ agents: Array.from(agentsMap.values()) });
    } catch (error) {
      fastify.log.error('Error fetching agents:', error);
      reply.status(500).send({ error: 'Failed to fetch agents' });
    }
  });

  // Get a specific agent with credentials
  fastify.get('/:agentId', async function (request, reply) {
    const { agentId } = request.params as { agentId: string };

    try {
      const agent = await db
        .selectFrom('agents')
        .select(['id', 'user_id', 'name', 'type', 'created_at', 'updated_at'])
        .where('id', '=', agentId)
        .executeTakeFirst();

      if (!agent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      // Get credential type (not value for security)
      const credential = await db
        .selectFrom('agent_credentials')
        .select(['type'])
        .where('agent_id', '=', agentId)
        .executeTakeFirst();

      reply.send({
        id: agent.id,
        user_id: agent.user_id,
        name: agent.name,
        type: agent.type,
        created_at: agent.created_at,
        updated_at: agent.updated_at,
        credential_type: credential?.type || null
      });
    } catch (error) {
      fastify.log.error('Error fetching agent:', error);
      reply.status(500).send({ error: 'Failed to fetch agent' });
    }
  });

  // Create a new agent
  fastify.post('/', async function (request, reply) {
    const validation = CreateAgentSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({ 
        error: 'Invalid request data',
        details: validation.error.issues
      });
    }

    const { userId, name, type, credential } = validation.data;

    try {
      // Start a transaction
      const result = await db.transaction().execute(async (trx) => {
        // Create the agent
        const agent = await trx
          .insertInto('agents')
          .values({
            user_id: userId,
            name,
            type
          })
          .returning(['id', 'user_id', 'name', 'type', 'created_at', 'updated_at'])
          .executeTakeFirstOrThrow();

        // Store single credential if provided
        if (credential) {
          const encryptedValue = encryptCredentials(credential.value);
          
          await trx
            .insertInto('agent_credentials')
            .values({
              agent_id: agent.id,
              type: credential.type,
              encrypted_value: encryptedValue
            })
            .execute();
        }

        return agent;
      });

      reply.status(201).send(result);
    } catch (error) {
      fastify.log.error('Error creating agent:', error);
      reply.status(500).send({ error: 'Failed to create agent' });
    }
  });

  // Update an agent
  fastify.patch('/:agentId', async function (request, reply) {
    const { agentId } = request.params as { agentId: string };
    const validation = UpdateAgentSchema.safeParse(request.body);
    
    if (!validation.success) {
      return reply.status(400).send({ 
        error: 'Invalid request data',
        details: validation.error.issues
      });
    }

    const { name, credential } = validation.data;

    try {
      const result = await db.transaction().execute(async (trx) => {
        // Check if agent exists
        const existingAgent = await trx
          .selectFrom('agents')
          .select(['id', 'type'])
          .where('id', '=', agentId)
          .executeTakeFirst();

        if (!existingAgent) {
          throw new Error('Agent not found');
        }

        // Update agent if name is provided
        if (name) {
          await trx
            .updateTable('agents')
            .set({ name })
            .where('id', '=', agentId)
            .execute();
        }

        // Update credential if provided
        if (credential) {
          // Delete existing credential
          await trx
            .deleteFrom('agent_credentials')
            .where('agent_id', '=', agentId)
            .execute();

          // Insert new credential
          const encryptedValue = encryptCredentials(credential.value);
          
          await trx
            .insertInto('agent_credentials')
            .values({
              agent_id: agentId,
              type: credential.type,
              encrypted_value: encryptedValue
            })
            .execute();
        }

        // Return updated agent
        return await trx
          .selectFrom('agents')
          .select(['id', 'user_id', 'name', 'type', 'created_at', 'updated_at'])
          .where('id', '=', agentId)
          .executeTakeFirstOrThrow();
      });

      reply.send(result);
    } catch (error: any) {
      fastify.log.error('Error updating agent:', error);
      if (error.message === 'Agent not found') {
        reply.status(404).send({ error: 'Agent not found' });
      } else {
        reply.status(500).send({ error: 'Failed to update agent' });
      }
    }
  });

  // Delete an agent
  fastify.delete('/:agentId', async function (request, reply) {
    const { agentId } = request.params as { agentId: string };

    try {
      const deletedAgent = await db
        .deleteFrom('agents')
        .where('id', '=', agentId)
        .returning(['id'])
        .executeTakeFirst();

      if (!deletedAgent) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      reply.send({ message: 'Agent deleted successfully' });
    } catch (error) {
      fastify.log.error('Error deleting agent:', error);
      reply.status(500).send({ error: 'Failed to delete agent' });
    }
  });

  // Get agent credentials (for internal use by session creation)
  fastify.get('/:agentId/credentials', async function (request, reply) {
    const { agentId } = request.params as { agentId: string };

    try {
      const credentials = await db
        .selectFrom('agent_credentials')
        .select(['type', 'encrypted_value'])
        .where('agent_id', '=', agentId)
        .execute();

      if (credentials.length === 0) {
        return reply.status(404).send({ error: 'Agent credentials not found' });
      }

      // Since we only have one credential per agent, return single credential object
      const credential = credentials[0];
      const decryptedCredential = {
        type: credential.type,
        value: decryptCredentials(credential.encrypted_value)
      };
      
      reply.send({ credential: decryptedCredential });
    } catch (error) {
      fastify.log.error('Error fetching agent credentials:', error);
      reply.status(500).send({ error: 'Failed to fetch agent credentials' });
    }
  });
};

export default agents;