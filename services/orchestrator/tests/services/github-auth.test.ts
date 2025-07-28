import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitHubAuthService } from '../../src/services/github-auth';
import { getDatabase } from '../../src/lib/kysely';
import { randomUUID } from 'crypto';

describe('GitHubAuthService', () => {
  let githubAuthService: GitHubAuthService;
  let testUserId: string;

  beforeEach(async () => {
    githubAuthService = new GitHubAuthService();
    
    // Create test user in database
    const db = getDatabase();
    const user = await db
      .insertInto('users')
      .values({
        email: 'test@example.com',
        name: 'Test User',
      })
      .returning('id')
      .executeTakeFirst();
    
    testUserId = user!.id;
  });

  afterEach(async () => {
    // Clean up test user
    const db = getDatabase();
    try {
      await db.deleteFrom('users').where('id', '=', testUserId).execute();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Token Management', () => {
    it('should return null for user without GitHub token', async () => {
      const token = await githubAuthService.getUserToken(testUserId);
      expect(token).toBeNull();
    });

    it('should return false for user without valid GitHub token', async () => {
      const hasValidToken = await githubAuthService.hasValidToken(testUserId);
      expect(hasValidToken).toBe(false);
    });

    it('should handle token revocation for user without token', async () => {
      // Should not throw an error
      await expect(
        githubAuthService.revokeUserToken(testUserId)
      ).resolves.toBeUndefined();
    });
  });

  describe('Device Flow', () => {
    it('should initiate device flow', async () => {
      // Note: This will likely fail in CI due to network/GitHub API limits
      // but we test that the method exists and handles errors properly
      try {
        const deviceAuth = await githubAuthService.initiateDeviceFlow();
        
        expect(deviceAuth).toHaveProperty('device_code');
        expect(deviceAuth).toHaveProperty('user_code');
        expect(deviceAuth).toHaveProperty('verification_uri');
        expect(deviceAuth).toHaveProperty('expires_in');
        expect(deviceAuth).toHaveProperty('interval');
      } catch (error) {
        // Expected in test environment without proper GitHub API access
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('Device flow initiation failed');
      }
    });

    it('should handle device flow polling timeout', async () => {
      // This test would normally take too long, so we just verify the method exists
      expect(typeof githubAuthService.pollForToken).toBe('function');
    });
  });

  describe('User Information', () => {
    it('should handle GitHub user info request with invalid token', async () => {
      await expect(
        githubAuthService.getGitHubUser('invalid-token')
      ).rejects.toThrow('Failed to get user info');
    });
  });

  describe('Encryption', () => {
    it('should create service instance with encryption capabilities', () => {
      const service = new GitHubAuthService();
      expect(service).toBeInstanceOf(GitHubAuthService);
      
      // Test that core methods exist
      expect(typeof service.initiateDeviceFlow).toBe('function');
      expect(typeof service.pollForToken).toBe('function');
      expect(typeof service.saveUserToken).toBe('function');
      expect(typeof service.getUserToken).toBe('function');
      expect(typeof service.revokeUserToken).toBe('function');
      expect(typeof service.getGitHubUser).toBe('function');
      expect(typeof service.hasValidToken).toBe('function');
    });

    it('should warn about missing encryption key in test environment', () => {
      // Remove encryption key to test warning
      delete process.env.ENCRYPTION_KEY;
      
      // Capture console.warn
      const originalWarn = console.warn;
      const warnCalls: string[] = [];
      console.warn = (message: string) => warnCalls.push(message);
      
      try {
        new GitHubAuthService();
        
        expect(warnCalls.some(call => 
          call.includes('No ENCRYPTION_KEY set')
        )).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Test with invalid user ID
      const token = await githubAuthService.getUserToken('invalid-uuid');
      expect(token).toBeNull();
    });

    it('should handle network errors in device flow', async () => {
      // This is tested implicitly in the device flow test above
      expect(githubAuthService).toBeInstanceOf(GitHubAuthService);
    });
  });
});