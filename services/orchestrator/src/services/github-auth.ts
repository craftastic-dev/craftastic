import crypto from 'crypto';
import { getDatabase } from '../lib/kysely';

// GitHub Device Flow constants
const GITHUB_DEVICE_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Ov23liz42T3AzHtmASDC'; // Craftastic shared OAuth app
const GITHUB_API_BASE = 'https://api.github.com';
const REQUIRED_SCOPES = ['repo', 'read:user', 'user:email'];

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export class GitHubAuthService {
  private encryptionKey: Buffer;

  constructor() {
    // Initialize encryption key from environment or generate one
    const keyString = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    this.encryptionKey = Buffer.from(keyString, 'hex');
    
    if (!process.env.ENCRYPTION_KEY) {
      console.warn('⚠️  No ENCRYPTION_KEY set, using random key (tokens will not persist between restarts)');
    }
  }

  /**
   * Initiate GitHub Device Flow
   */
  async initiateDeviceFlow(): Promise<DeviceAuthResponse> {
    try {
      const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_DEVICE_CLIENT_ID,
          scope: REQUIRED_SCOPES.join(' '),
        }),
      });

      if (!response.ok) {
        let errorDetails = response.statusText;
        try {
          const errorBody = await response.json();
          errorDetails = errorBody.error_description || errorBody.error || response.statusText;
        } catch {
          // If we can't parse the error body, use the status text
        }
        throw new Error(`GitHub device flow initiation failed: ${errorDetails}`);
      }

      const data = await response.json();
      
      console.log(`✅ GitHub device flow initiated: ${data.user_code}`);
      return data;
    } catch (error) {
      console.error('❌ Failed to initiate GitHub device flow:', error);
      throw new Error(`Device flow initiation failed: ${error.message}`);
    }
  }

  /**
   * Poll for device authorization completion
   */
  async pollForToken(deviceCode: string, interval: number = 5): Promise<GitHubTokenResponse> {
    const maxAttempts = 60; // 5 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: GITHUB_DEVICE_CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        if (!response.ok) {
          let errorDetails = response.statusText;
          try {
            const errorBody = await response.json();
            errorDetails = errorBody.error_description || errorBody.error || response.statusText;
          } catch {
            // If we can't parse the error body, use the status text
          }
          throw new Error(`GitHub token polling failed: ${errorDetails}`);
        }

        let data;
        try {
          data = await response.json();
        } catch (parseError) {
          console.error('❌ Failed to parse GitHub response as JSON:', parseError);
          // Can't read response text after trying JSON - log the parse error instead
          console.error('Parse error details:', parseError.message);
          throw new Error('GitHub returned invalid JSON response');
        }

        if (data.access_token) {
          console.log('✅ GitHub device authorization completed');
          return data;
        }

        if (data.error === 'authorization_pending') {
          // Continue polling
          await this.sleep(interval * 1000);
          attempts++;
          continue;
        }

        if (data.error === 'slow_down') {
          // Increase interval and continue
          interval += 5;
          await this.sleep(interval * 1000);
          attempts++;
          continue;
        }

        // Other errors (expired_token, unsupported_grant_type, etc.)
        throw new Error(data.error_description || data.error);

      } catch (error) {
        console.error('❌ Error polling for GitHub token:', error);
        throw new Error(`Token polling failed: ${error.message}`);
      }
    }

    throw new Error('Device authorization timeout - user did not complete the flow');
  }

  /**
   * Save encrypted GitHub token for user
   */
  async saveUserToken(userId: string, tokenResponse: GitHubTokenResponse): Promise<void> {
    try {
      // Get user info from GitHub to validate token and get username
      const userInfo = await this.getGitHubUser(tokenResponse.access_token);
      
      // Encrypt the token
      const encryptedToken = this.encryptString(tokenResponse.access_token);
      const encryptedRefreshToken = tokenResponse.refresh_token 
        ? this.encryptString(tokenResponse.refresh_token)
        : null;

      // Calculate expiration if provided
      const expiresAt = tokenResponse.expires_in 
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : null;

      // Save to database
      await getDatabase()
        .updateTable('users')
        .set({
          github_access_token: encryptedToken,
          github_refresh_token: encryptedRefreshToken,
          github_username: userInfo.login,
          github_token_expires_at: expiresAt,
          updated_at: new Date(),
        })
        .where('id', '=', userId)
        .execute();

      console.log(`✅ Saved GitHub token for user ${userId} (${userInfo.login})`);
    } catch (error) {
      console.error('❌ Failed to save GitHub token:', error);
      throw new Error(`Token save failed: ${error.message}`);
    }
  }

  /**
   * Get decrypted GitHub token for user
   */
  async getUserToken(userId: string): Promise<string | null> {
    try {
      const user = await getDatabase()
        .selectFrom('users')
        .select(['github_access_token', 'github_token_expires_at'])
        .where('id', '=', userId)
        .executeTakeFirst();

      if (!user?.github_access_token) {
        return null;
      }

      // Check if token is expired
      if (user.github_token_expires_at && user.github_token_expires_at < new Date()) {
        console.warn(`⚠️  GitHub token expired for user ${userId}`);
        return null;
      }

      // Decrypt and return token
      return this.decryptString(user.github_access_token);
    } catch (error) {
      console.error('❌ Failed to get GitHub token:', error);
      return null;
    }
  }

  /**
   * Revoke GitHub token for user
   */
  async revokeUserToken(userId: string): Promise<void> {
    try {
      const token = await this.getUserToken(userId);
      
      if (token) {
        // Revoke token with GitHub
        try {
          await fetch(`${GITHUB_API_BASE}/applications/${GITHUB_DEVICE_CLIENT_ID}/token`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github.v3+json',
            },
            body: JSON.stringify({ access_token: token }),
          });
        } catch (revokeError) {
          console.warn('⚠️  Failed to revoke token with GitHub:', revokeError.message);
        }
      }

      // Clear from database
      await getDatabase()
        .updateTable('users')
        .set({
          github_access_token: null,
          github_refresh_token: null,
          github_username: null,
          github_token_expires_at: null,
          updated_at: new Date(),
        })
        .where('id', '=', userId)
        .execute();

      console.log(`✅ Revoked GitHub token for user ${userId}`);
    } catch (error) {
      console.error('❌ Failed to revoke GitHub token:', error);
      throw new Error(`Token revocation failed: ${error.message}`);
    }
  }

  /**
   * Get GitHub user info using token
   */
  async getGitHubUser(token: string): Promise<GitHubUser> {
    try {
      const response = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const user = await response.json();
      
      // Get primary email if not public
      if (!user.email) {
        const emailResponse = await fetch(`${GITHUB_API_BASE}/user/emails`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });

        if (emailResponse.ok) {
          const emails = await emailResponse.json();
          const primaryEmail = emails.find((email: any) => email.primary);
          user.email = primaryEmail?.email || null;
        }
      }

      return {
        id: user.id,
        login: user.login,
        name: user.name || user.login,
        email: user.email,
        avatar_url: user.avatar_url,
      };
    } catch (error) {
      console.error('❌ Failed to get GitHub user info:', error);
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  /**
   * Check if user has valid GitHub token
   */
  async hasValidToken(userId: string): Promise<boolean> {
    const token = await this.getUserToken(userId);
    if (!token) return false;

    try {
      // Validate token by making a simple API call
      const response = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Encryption helpers
   */
  private encryptString(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Return iv:tag:encrypted
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  }

  private decryptString(encryptedText: string): string {
    const [ivHex, tagHex, encrypted] = encryptedText.split(':');
    
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const gitHubAuthService = new GitHubAuthService();