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
    const keyString = process.env.SERVER_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    
    // Handle both hex and plain text keys
    if (keyString.match(/^[0-9a-fA-F]{64}$/)) {
      // It's a 64-char hex string
      this.encryptionKey = Buffer.from(keyString, 'hex');
    } else {
      // It's a plain text key, hash it to get consistent 32 bytes
      this.encryptionKey = crypto.createHash('sha256').update(keyString).digest();
    }
    
    if (!process.env.SERVER_ENCRYPTION_KEY) {
      console.warn('⚠️  No SERVER_ENCRYPTION_KEY set, using random key (tokens will not persist between restarts)');
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
   * Poll for device authorization completion (single attempt)
   */
  async pollForToken(deviceCode: string, interval: number = 5): Promise<GitHubTokenResponse> {
    console.log(`[GitHubAuth] ============ POLLING GITHUB ============`);
    console.log(`[GitHubAuth] Device Code: ${deviceCode.substring(0, 8)}...${deviceCode.substring(deviceCode.length - 4)}`);
    console.log(`[GitHubAuth] Client ID: ${GITHUB_DEVICE_CLIENT_ID}`);
    console.log(`[GitHubAuth] Interval: ${interval}s`);
    console.log(`[GitHubAuth] Current time: ${new Date().toISOString()}`);
    
    try {
      console.log('[GitHubAuth] 📡 Making request to GitHub OAuth API...');
      
      const requestBody = {
        client_id: GITHUB_DEVICE_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      };
      
      console.log('[GitHubAuth] Request body:', requestBody);
      
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Craftastic-Orchestrator/1.0.0',
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[GitHubAuth] 📥 GitHub API response received:`);
      console.log(`[GitHubAuth] Status: ${response.status} ${response.statusText}`);
      console.log(`[GitHubAuth] Headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        let errorDetails = response.statusText;
        try {
          const errorBody = await response.json();
          console.log(`[GitHubAuth] Error response body:`, errorBody);
          errorDetails = errorBody.error_description || errorBody.error || response.statusText;
        } catch (parseError) {
          console.error('[GitHubAuth] Failed to parse error response as JSON:', parseError);
        }
        console.error(`[GitHubAuth] ❌ GitHub API HTTP error: ${errorDetails}`);
        throw new Error(`GitHub token polling failed: ${errorDetails}`);
      }

      let data;
      try {
        const responseText = await response.text();
        console.log(`[GitHubAuth] Raw response text: ${responseText}`);
        data = JSON.parse(responseText);
        console.log('[GitHubAuth] ✅ Parsed GitHub API response:');
        console.log('[GitHubAuth] Response data:', JSON.stringify(data, null, 2));
      } catch (parseError) {
        console.error('❌ Failed to parse GitHub response as JSON:', parseError);
        throw new Error('GitHub returned invalid JSON response');
      }

      // Check for successful authentication
      if (data.access_token) {
        console.log('[GitHubAuth] 🎉 SUCCESS! GitHub device authorization completed!');
        console.log(`[GitHubAuth] Token type: ${data.token_type}`);
        console.log(`[GitHubAuth] Scope: ${data.scope}`);
        console.log(`[GitHubAuth] Access token length: ${data.access_token.length}`);
        console.log(`[GitHubAuth] Has refresh token: ${!!data.refresh_token}`);
        console.log(`[GitHubAuth] Expires in: ${data.expires_in || 'No expiration'}`);
        return data;
      }

      // Handle pending/error states
      console.log(`[GitHubAuth] No access token in response. Checking error status...`);
      
      if (data.error === 'authorization_pending') {
        console.log('[GitHubAuth] 🔄 Authorization still pending - user has not completed authorization yet');
        throw new Error('authorization_pending');
      }

      if (data.error === 'slow_down') {
        console.log('[GitHubAuth] 🐌 GitHub rate limiting - slow down requested');
        throw new Error('slow_down');
      }
      
      if (data.error === 'expired_token') {
        console.log('[GitHubAuth] ⏰ Device code expired - user took too long to authorize');
        throw new Error('expired_token');
      }
      
      if (data.error === 'unsupported_grant_type') {
        console.log('[GitHubAuth] ❌ Unsupported grant type - configuration error');
        throw new Error('unsupported_grant_type');
      }
      
      if (data.error === 'incorrect_client_credentials') {
        console.log('[GitHubAuth] ❌ Incorrect client credentials - OAuth app configuration error');
        throw new Error('incorrect_client_credentials');
      }
      
      if (data.error === 'incorrect_device_code') {
        console.log('[GitHubAuth] ❌ Incorrect device code - device code is invalid');
        throw new Error('incorrect_device_code');
      }
      
      if (data.error === 'access_denied') {
        console.log('[GitHubAuth] ❌ Access denied - user rejected the authorization');
        throw new Error('access_denied');
      }

      // Other/unknown errors
      console.error(`[GitHubAuth] ❌ Unknown/unexpected error from GitHub:`, data);
      throw new Error(data.error_description || data.error || 'Unknown GitHub API error');

    } catch (error) {
      // Don't log expected GitHub device flow states as errors
      if (error.message === 'authorization_pending' || error.message === 'slow_down' || error.message === 'expired_token') {
        // These are expected states in the device flow, just re-throw without noisy logging
        throw error;
      }
      
      // Only log unexpected errors
      console.error('[GitHubAuth] ❌ Unexpected exception in pollForToken:', error);
      console.error('[GitHubAuth] Error type:', typeof error);
      console.error('[GitHubAuth] Error message:', error.message);
      if (error.stack) {
        console.error('[GitHubAuth] Error stack:', error.stack);
      }
      throw error;
    }
  }

  /**
   * Save encrypted GitHub token for user
   */
  async saveUserToken(userId: string, tokenResponse: GitHubTokenResponse): Promise<void> {
    console.log(`[GitHubAuth] ============ SAVING TOKEN ============`);
    console.log(`[GitHubAuth] User ID: ${userId}`);
    console.log(`[GitHubAuth] Token response received:`, {
      has_access_token: !!tokenResponse.access_token,
      token_type: tokenResponse.token_type,
      scope: tokenResponse.scope,
      expires_in: tokenResponse.expires_in,
      has_refresh_token: !!tokenResponse.refresh_token,
      access_token_length: tokenResponse.access_token?.length
    });
    
    try {
      // Get user info from GitHub to validate token and get username
      console.log('[GitHubAuth] 👤 Fetching GitHub user info to validate token...');
      const userInfo = await this.getGitHubUser(tokenResponse.access_token);
      console.log(`[GitHubAuth] ✅ GitHub user info received:`, {
        id: userInfo.id,
        login: userInfo.login,
        name: userInfo.name,
        email: userInfo.email
      });
      
      // Encrypt the token
      console.log('[GitHubAuth] 🔒 Encrypting tokens...');
      const encryptedToken = this.encryptString(tokenResponse.access_token);
      const encryptedRefreshToken = tokenResponse.refresh_token 
        ? this.encryptString(tokenResponse.refresh_token)
        : null;

      console.log(`[GitHubAuth] ✅ Tokens encrypted successfully`);
      console.log(`[GitHubAuth] Encrypted token length: ${encryptedToken.length}`);
      console.log(`[GitHubAuth] Has encrypted refresh token: ${!!encryptedRefreshToken}`);

      // Calculate expiration if provided
      const expiresAt = tokenResponse.expires_in 
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : null;

      console.log(`[GitHubAuth] Token expiration: ${expiresAt ? expiresAt.toISOString() : 'No expiration'}`);

      console.log('[GitHubAuth] 💾 Updating database...');
      console.log(`[GitHubAuth] Updating user: ${userId}`);
      console.log(`[GitHubAuth] Setting github_username: ${userInfo.login}`);
      
      // Save to database
      const result = await getDatabase()
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

      console.log(`[GitHubAuth] ✅ Database update completed!`);
      console.log(`[GitHubAuth] Update result:`, result);
      console.log(`[GitHubAuth] Rows affected: ${result.length}`);
      
      if (result.length === 0) {
        console.error(`[GitHubAuth] ❌ NO ROWS UPDATED! User ${userId} may not exist in database.`);
        throw new Error(`User ${userId} not found in database`);
      }
      
      console.log(`[GitHubAuth] ✅ SUCCESS! Token saved for user ${userId} (GitHub: @${userInfo.login})`);
      
      // Verify the save by reading back
      console.log('[GitHubAuth] 🔍 Verifying save by reading back from database...');
      const verification = await getDatabase()
        .selectFrom('users')
        .select(['github_username', 'github_access_token', 'github_token_expires_at'])
        .where('id', '=', userId)
        .executeTakeFirst();
        
      console.log(`[GitHubAuth] Verification result:`, {
        github_username: verification?.github_username,
        has_encrypted_token: !!verification?.github_access_token,
        expires_at: verification?.github_token_expires_at
      });
      
    } catch (error) {
      console.error('[GitHubAuth] ❌ FAILED TO SAVE TOKEN:', error);
      console.error('[GitHubAuth] Error type:', typeof error);
      console.error('[GitHubAuth] Error stack:', error.stack);
      throw new Error(`Token save failed: ${error.message}`);
    }
  }

  /**
   * Get decrypted GitHub token for user
   */
  async getUserToken(userId: string): Promise<string | null> {
    try {
      console.log(`[GitHubAuth] getUserToken called for user: ${userId}`);
      
      const user = await getDatabase()
        .selectFrom('users')
        .select(['github_access_token', 'github_token_expires_at'])
        .where('id', '=', userId)
        .executeTakeFirst();

      console.log(`[GitHubAuth] Database query result:`, {
        user_found: !!user,
        has_token: !!user?.github_access_token,
        expires_at: user?.github_token_expires_at,
      });

      if (!user?.github_access_token) {
        console.log('[GitHubAuth] No access token found in database');
        return null;
      }

      // Check if token is expired
      if (user.github_token_expires_at && user.github_token_expires_at < new Date()) {
        console.warn(`⚠️  GitHub token expired for user ${userId}`);
        return null;
      }

      console.log('[GitHubAuth] Decrypting token...');
      // Decrypt and return token
      const decryptedToken = this.decryptString(user.github_access_token);
      console.log(`[GitHubAuth] Token decrypted successfully: ${decryptedToken ? 'yes' : 'no'}`);
      
      return decryptedToken;
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
    console.log(`[GitHubAuth] hasValidToken called for user: ${userId}`);
    
    const token = await this.getUserToken(userId);
    console.log(`[GitHubAuth] getUserToken returned: ${token ? 'token found' : 'no token'}`);
    
    if (!token) return false;

    try {
      console.log('[GitHubAuth] Validating token with GitHub API...');
      // Validate token by making a simple API call
      const response = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      console.log(`[GitHubAuth] GitHub API validation response: ${response.status} ${response.statusText}`);
      return response.ok;
    } catch (error) {
      console.error('[GitHubAuth] Error validating token:', error);
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