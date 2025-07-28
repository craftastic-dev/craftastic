import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { getDatabase } from '../lib/kysely';
import { encryptCredentials, decryptCredentials, testEncryption } from '../lib/encryption';

// Test configuration
const TEST_USER_ID = 'test-user-123';
const AGENT_API_BASE = 'http://localhost:3000/api/agents';

describe('Agent System Tests', () => {
  let db: ReturnType<typeof getDatabase>;
  let createdAgentIds: string[] = [];

  beforeAll(async () => {
    db = getDatabase();
    // Ensure encryption system is working
    expect(testEncryption()).toBe(true);
  });

  afterAll(async () => {
    // Clean up all created test agents
    for (const agentId of createdAgentIds) {
      try {
        await db.deleteFrom('agents').where('id', '=', agentId).execute();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  beforeEach(() => {
    createdAgentIds = [];
  });

  describe('Database Schema Tests', () => {
    it('should enforce single credential per agent constraint', async () => {
      // Create agent
      const agent = await db
        .insertInto('agents')
        .values({
          user_id: TEST_USER_ID,
          name: 'Test Agent',
          type: 'claude-code'
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      
      createdAgentIds.push(agent.id);

      // Insert first credential
      await db
        .insertInto('agent_credentials')
        .values({
          agent_id: agent.id,
          type: 'anthropic_api_key',
          encrypted_value: encryptCredentials('test-key-1')
        })
        .execute();

      // Try to insert second credential - should fail due to unique constraint
      await expect(
        db
          .insertInto('agent_credentials')
          .values({
            agent_id: agent.id,
            type: 'oauth',
            encrypted_value: encryptCredentials('test-oauth')
          })
          .execute()
      ).rejects.toThrow();
    });

    it('should cascade delete credentials when agent is deleted', async () => {
      // Create agent with credential
      const agent = await db
        .insertInto('agents')
        .values({
          user_id: TEST_USER_ID,
          name: 'Test Agent',
          type: 'claude-code'
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await db
        .insertInto('agent_credentials')
        .values({
          agent_id: agent.id,
          type: 'anthropic_api_key',
          encrypted_value: encryptCredentials('test-key')
        })
        .execute();

      // Verify credential exists
      const credential = await db
        .selectFrom('agent_credentials')
        .where('agent_id', '=', agent.id)
        .executeTakeFirstOrThrow();
      
      expect(credential).toBeDefined();

      // Delete agent
      await db.deleteFrom('agents').where('id', '=', agent.id).execute();

      // Verify credential is also deleted
      const deletedCredential = await db
        .selectFrom('agent_credentials')
        .where('agent_id', '=', agent.id)
        .executeTakeFirst();
      
      expect(deletedCredential).toBeUndefined();
    });
  });

  describe('Encryption Tests', () => {
    it('should encrypt and decrypt simple string credentials', () => {
      const testKey = 'sk-ant-test123456';
      const encrypted = encryptCredentials(testKey);
      const decrypted = decryptCredentials(encrypted);
      
      expect(decrypted).toBe(testKey);
      expect(encrypted).not.toBe(testKey);
      expect(encrypted).toContain(':'); // Should have IV:encrypted format
    });

    it('should encrypt and decrypt JSON credentials', () => {
      const testOAuth = {
        access_token: 'ya29.test',
        refresh_token: '1//test',
        scope: 'https://www.googleapis.com/auth/generative-language',
        token_type: 'Bearer',
        expiry_date: 1625097600000
      };
      
      const encrypted = encryptCredentials(JSON.stringify(testOAuth));
      const decrypted = JSON.parse(decryptCredentials(encrypted));
      
      expect(decrypted).toEqual(testOAuth);
    });

    it('should generate different encrypted values for same input', () => {
      const testValue = 'test-value';
      const encrypted1 = encryptCredentials(testValue);
      const encrypted2 = encryptCredentials(testValue);
      
      expect(encrypted1).not.toBe(encrypted2); // Different IVs
      expect(decryptCredentials(encrypted1)).toBe(testValue);
      expect(decryptCredentials(encrypted2)).toBe(testValue);
    });
  });

  describe('API Tests', () => {
    async function createAgent(agentData: any) {
      const response = await fetch(AGENT_API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create agent: ${response.status}`);
      }
      
      const agent = await response.json();
      createdAgentIds.push(agent.id);
      return agent;
    }

    it('should create agent with single credential', async () => {
      const agentData = {
        userId: TEST_USER_ID,
        name: 'Claude Code Test',
        type: 'claude-code',
        credential: {
          type: 'anthropic_api_key',
          value: 'sk-ant-test123'
        }
      };

      const agent = await createAgent(agentData);
      
      expect(agent.id).toBeDefined();
      expect(agent.user_id).toBe(TEST_USER_ID);
      expect(agent.name).toBe('Claude Code Test');
      expect(agent.type).toBe('claude-code');
    });

    it('should create agent without credential', async () => {
      const agentData = {
        userId: TEST_USER_ID,
        name: 'Agent Without Credential',
        type: 'gemini-cli'
      };

      const agent = await createAgent(agentData);
      
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Agent Without Credential');
      expect(agent.type).toBe('gemini-cli');
    });

    it('should retrieve user agents with credential types', async () => {
      // Create two agents - one with credential, one without
      await createAgent({
        userId: TEST_USER_ID,
        name: 'Agent With Cred',
        type: 'claude-code',
        credential: { type: 'anthropic_api_key', value: 'sk-test' }
      });

      await createAgent({
        userId: TEST_USER_ID,
        name: 'Agent Without Cred',
        type: 'gemini-cli'
      });

      const response = await fetch(`${AGENT_API_BASE}/user/${TEST_USER_ID}`);
      const { agents } = await response.json();
      
      expect(agents).toHaveLength(2);
      
      const agentWithCred = agents.find((a: any) => a.name === 'Agent With Cred');
      const agentWithoutCred = agents.find((a: any) => a.name === 'Agent Without Cred');
      
      expect(agentWithCred.credential_type).toBe('anthropic_api_key');
      expect(agentWithoutCred.credential_type).toBeNull();
    });

    it('should retrieve agent credentials (decrypted)', async () => {
      const testCredential = { type: 'anthropic_api_key', value: 'sk-ant-secret123' };
      
      const agent = await createAgent({
        userId: TEST_USER_ID,
        name: 'Test Agent',
        type: 'claude-code',
        credential: testCredential
      });

      const response = await fetch(`${AGENT_API_BASE}/${agent.id}/credentials`);
      const { credential } = await response.json();
      
      expect(credential.type).toBe(testCredential.type);
      expect(credential.value).toBe(testCredential.value);
    });

    it('should update agent name and credential', async () => {
      const agent = await createAgent({
        userId: TEST_USER_ID,
        name: 'Original Name',
        type: 'claude-code',
        credential: { type: 'anthropic_api_key', value: 'original-key' }
      });

      const updates = {
        name: 'Updated Name',
        credential: { type: 'anthropic_api_key', value: 'updated-key' }
      };

      const response = await fetch(`${AGENT_API_BASE}/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      const updatedAgent = await response.json();
      expect(updatedAgent.name).toBe('Updated Name');

      // Verify credential was updated
      const credResponse = await fetch(`${AGENT_API_BASE}/${agent.id}/credentials`);
      const { credential } = await credResponse.json();
      expect(credential.value).toBe('updated-key');
    });

    it('should delete agent and its credentials', async () => {
      const agent = await createAgent({
        userId: TEST_USER_ID,
        name: 'To Be Deleted',
        type: 'claude-code',
        credential: { type: 'anthropic_api_key', value: 'delete-me' }
      });

      const deleteResponse = await fetch(`${AGENT_API_BASE}/${agent.id}`, {
        method: 'DELETE'
      });

      expect(deleteResponse.ok).toBe(true);

      // Verify agent is deleted
      const getResponse = await fetch(`${AGENT_API_BASE}/${agent.id}`);
      expect(getResponse.status).toBe(404);

      // Remove from cleanup list since it's already deleted
      createdAgentIds = createdAgentIds.filter(id => id !== agent.id);
    });

    it('should handle OAuth JSON credentials correctly', async () => {
      const oauthData = {
        access_token: 'ya29.example',
        refresh_token: '1//example',
        scope: 'https://www.googleapis.com/auth/generative-language',
        token_type: 'Bearer',
        expiry_date: 1672531200000
      };

      const agent = await createAgent({
        userId: TEST_USER_ID,
        name: 'OAuth Agent',
        type: 'gemini-cli',
        credential: {
          type: 'oauth',
          value: JSON.stringify(oauthData)
        }
      });

      const response = await fetch(`${AGENT_API_BASE}/${agent.id}/credentials`);
      const { credential } = await response.json();
      
      expect(credential.type).toBe('oauth');
      
      const parsedOAuth = JSON.parse(credential.value);
      expect(parsedOAuth).toEqual(oauthData);
    });

    it('should validate agent creation input', async () => {
      // Test missing required fields
      const invalidData = {
        userId: TEST_USER_ID,
        // missing name and type
      };

      const response = await fetch(AGENT_API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidData)
      });

      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error.error).toBe('Invalid request data');
      expect(error.details).toBeDefined();
    });

    it('should validate credential structure', async () => {
      const invalidCredential = {
        userId: TEST_USER_ID,
        name: 'Test Agent',
        type: 'claude-code',
        credential: {
          type: 'anthropic_api_key'
          // missing value
        }
      };

      const response = await fetch(AGENT_API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidCredential)
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Integration Tests', () => {
    it('should support complete agent lifecycle', async () => {
      // 1. Create agent
      const agent = await createAgent({
        userId: TEST_USER_ID,
        name: 'Lifecycle Test',
        type: 'claude-code',
        credential: { type: 'anthropic_api_key', value: 'initial-key' }
      });

      // 2. Fetch and verify
      const getResponse = await fetch(`${AGENT_API_BASE}/${agent.id}`);
      const fetchedAgent = await getResponse.json();
      expect(fetchedAgent.name).toBe('Lifecycle Test');
      expect(fetchedAgent.credential_type).toBe('anthropic_api_key');

      // 3. Update name only
      await fetch(`${AGENT_API_BASE}/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Lifecycle Test' })
      });

      // 4. Update credential only  
      await fetch(`${AGENT_API_BASE}/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          credential: { type: 'anthropic_api_key', value: 'updated-key' }
        })
      });

      // 5. Verify both updates
      const finalResponse = await fetch(`${AGENT_API_BASE}/${agent.id}`);
      const finalAgent = await finalResponse.json();
      expect(finalAgent.name).toBe('Updated Lifecycle Test');

      const credResponse = await fetch(`${AGENT_API_BASE}/${agent.id}/credentials`);
      const { credential } = await credResponse.json();
      expect(credential.value).toBe('updated-key');

      // 6. Clean up
      await fetch(`${AGENT_API_BASE}/${agent.id}`, { method: 'DELETE' });
      createdAgentIds = createdAgentIds.filter(id => id !== agent.id);
    });
  });
});

// Test Data Documentation for Future Reference
export const AGENT_TEST_CASES = {
  database_schema: {
    single_credential_constraint: 'One credential per agent enforced by unique constraint on agent_id',
    cascade_delete: 'Credentials automatically deleted when agent is deleted',
    auto_generated_fields: 'id, created_at, updated_at are auto-generated by database'
  },
  
  encryption: {
    symmetric_aes_256_cbc: 'Uses AES-256-CBC with random IV for each encryption',
    json_support: 'Can encrypt/decrypt both simple strings and JSON objects',
    unique_encrypted_values: 'Same input produces different encrypted values due to random IV'
  },
  
  api_endpoints: {
    'POST /api/agents': 'Create agent with optional single credential',
    'GET /api/agents/user/:userId': 'List user agents with credential_type field',
    'GET /api/agents/:agentId': 'Get specific agent with credential_type',
    'GET /api/agents/:agentId/credentials': 'Get decrypted credential (internal use)',
    'PATCH /api/agents/:agentId': 'Update agent name and/or credential',
    'DELETE /api/agents/:agentId': 'Delete agent and cascade delete credential'
  },
  
  credential_types: {
    anthropic_api_key: 'Simple string API key for Claude Code agents',
    oauth: 'JSON string containing OAuth token data for Google/Gemini agents',
    gemini_api_key: 'Simple string API key for Gemini CLI agents'
  },
  
  agent_types: {
    'claude-code': 'Anthropic Claude Code CLI agent',
    'gemini-cli': 'Google Gemini CLI agent', 
    'qwen-coder': 'Qwen Coder agent (future support)'
  },
  
  validation: {
    required_create_fields: ['userId', 'name', 'type'],
    optional_create_fields: ['credential'],
    credential_structure: { type: 'string', value: 'string' },
    supported_agent_types: ['claude-code', 'gemini-cli', 'qwen-coder']
  }
};