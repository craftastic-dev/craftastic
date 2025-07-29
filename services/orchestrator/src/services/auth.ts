import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getDatabase } from '../lib/kysely';
import { userService } from './user';

const SALT_ROUNDS = 12;
const REFRESH_TOKEN_EXPIRES_DAYS = 30;

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
  };
}

export interface RefreshTokenInput {
  refreshToken: string;
}

export class AuthService {
  /**
   * Register a new user
   */
  async register(input: RegisterInput): Promise<AuthTokens> {
    const { email, password, name } = input;
    console.log(`[AuthService] Registration attempt for email: ${email}`);

    // Check if user already exists
    const existingUser = await getDatabase()
      .selectFrom('users')
      .select(['id', 'password_hash'])
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();

    console.log('[AuthService] Existing user check:', { 
      found: !!existingUser, 
      hasPassword: !!existingUser?.password_hash 
    });

    if (existingUser) {
      if (existingUser.password_hash) {
        throw new Error('User with this email already exists');
      } else {
        // User exists but has no password - this is from old dev system
        // Update the existing user with password
        console.log('[AuthService] Updating existing user without password');
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        const updatedUser = await getDatabase()
          .updateTable('users')
          .set({
            password_hash: passwordHash,
            name,
            email_verified: false,
            email_verification_token: crypto.randomBytes(32).toString('hex'),
          })
          .where('id', '=', existingUser.id)
          .returning(['id', 'email', 'name', 'email_verified'])
          .executeTakeFirstOrThrow();

        console.log('[AuthService] User updated successfully');
        return await this.generateTokens(updatedUser.id, {
          userAgent: null,
          ipAddress: null,
        });
      }
    }

    // Hash password
    console.log('[AuthService] Creating new user');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const user = await getDatabase()
      .insertInto('users')
      .values({
        email: email.toLowerCase(),
        name,
        password_hash: passwordHash,
        email_verified: false,
        email_verification_token: crypto.randomBytes(32).toString('hex'),
      })
      .returning(['id', 'email', 'name', 'email_verified'])
      .executeTakeFirstOrThrow();

    console.log('[AuthService] New user created successfully');
    // Generate tokens
    return await this.generateTokens(user.id, {
      userAgent: null,
      ipAddress: null,
    });
  }

  /**
   * Login user
   */
  async login(input: LoginInput, context?: { userAgent?: string; ipAddress?: string }): Promise<AuthTokens> {
    const { email, password } = input;
    console.log(`[AuthService] Login attempt for email: ${email}`);

    // Get user with password hash
    const user = await getDatabase()
      .selectFrom('users')
      .select(['id', 'email', 'name', 'password_hash', 'email_verified'])
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();

    console.log('[AuthService] User lookup result:', { 
      found: !!user, 
      hasPassword: !!user?.password_hash,
      email: user?.email,
      userId: user?.id,
      passwordHashLength: user?.password_hash?.length || 0
    });

    if (!user || !user.password_hash) {
      console.log('[AuthService] User not found or no password hash');
      throw new Error('Invalid email or password');
    }

    // Verify password
    console.log('[AuthService] Verifying password...');
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    console.log('[AuthService] Password verification result:', isValidPassword);
    
    if (!isValidPassword) {
      console.log('[AuthService] Password verification failed');
      throw new Error('Invalid email or password');
    }

    // Update last login
    await getDatabase()
      .updateTable('users')
      .set({ last_login_at: new Date() })
      .where('id', '=', user.id)
      .execute();

    console.log('[AuthService] Login successful, generating tokens...');
    // Generate tokens
    return await this.generateTokens(user.id, context);
  }

  /**
   * Refresh access token
   */
  async refreshToken(input: RefreshTokenInput): Promise<AuthTokens> {
    const { refreshToken } = input;

    // Find and validate refresh token
    const tokenRecord = await getDatabase()
      .selectFrom('refresh_tokens')
      .select(['user_id', 'expires_at', 'revoked'])
      .where('token', '=', refreshToken)
      .executeTakeFirst();

    if (!tokenRecord || tokenRecord.revoked || tokenRecord.expires_at < new Date()) {
      throw new Error('Invalid or expired refresh token');
    }

    // Revoke the old token
    await getDatabase()
      .updateTable('refresh_tokens')
      .set({ revoked: true })
      .where('token', '=', refreshToken)
      .execute();

    // Generate new tokens
    return await this.generateTokens(tokenRecord.user_id);
  }

  /**
   * Logout user (revoke refresh token)
   */
  async logout(refreshToken: string): Promise<void> {
    await getDatabase()
      .updateTable('refresh_tokens')
      .set({ revoked: true })
      .where('token', '=', refreshToken)
      .execute();
  }

  /**
   * Logout all sessions for a user
   */
  async logoutAll(userId: string): Promise<void> {
    await getDatabase()
      .updateTable('refresh_tokens')
      .set({ revoked: true })
      .where('user_id', '=', userId)
      .execute();
  }

  /**
   * Verify email address
   */
  async verifyEmail(token: string): Promise<void> {
    const user = await getDatabase()
      .selectFrom('users')
      .select('id')
      .where('email_verification_token', '=', token)
      .where('email_verified', '=', false)
      .executeTakeFirst();

    if (!user) {
      throw new Error('Invalid or expired verification token');
    }

    await getDatabase()
      .updateTable('users')
      .set({
        email_verified: true,
        email_verification_token: null,
      })
      .where('id', '=', user.id)
      .execute();
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<string> {
    const user = await getDatabase()
      .selectFrom('users')
      .select('id')
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();

    if (!user) {
      // Don't reveal if user exists or not
      return 'Password reset email sent if account exists';
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    await getDatabase()
      .updateTable('users')
      .set({
        password_reset_token: resetToken,
        password_reset_expires: expiresAt,
      })
      .where('id', '=', user.id)
      .execute();

    return resetToken; // In production, you'd send this via email
  }

  /**
   * Reset password
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await getDatabase()
      .selectFrom('users')
      .select('id')
      .where('password_reset_token', '=', token)
      .where('password_reset_expires', '>', new Date())
      .executeTakeFirst();

    if (!user) {
      throw new Error('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await getDatabase()
      .updateTable('users')
      .set({
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_expires: null,
      })
      .where('id', '=', user.id)
      .execute();

    // Revoke all refresh tokens for security
    await this.logoutAll(user.id);
  }

  /**
   * Change password (authenticated)
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await getDatabase()
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user || !user.password_hash) {
      throw new Error('User not found');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await getDatabase()
      .updateTable('users')
      .set({ password_hash: passwordHash })
      .where('id', '=', userId)
      .execute();

    // Revoke all other refresh tokens for security
    await this.logoutAll(userId);
  }

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(
    userId: string,
    context?: { userAgent?: string | null; ipAddress?: string | null }
  ): Promise<AuthTokens> {
    // Get user info
    const user = await getDatabase()
      .selectFrom('users')
      .select(['id', 'email', 'name', 'email_verified'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();

    // Generate refresh token
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    // Store refresh token in database
    await getDatabase()
      .insertInto('refresh_tokens')
      .values({
        user_id: userId,
        token: refreshToken,
        expires_at: expiresAt,
        user_agent: context?.userAgent || null,
        ip_address: context?.ipAddress || null,
      })
      .execute();

    // Generate JWT access token (this will use Fastify's JWT plugin)
    const accessToken = await this.generateAccessToken(user);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.email_verified,
      },
    };
  }

  /**
   * Generate JWT access token
   * Note: This will be replaced with Fastify's JWT plugin in the routes
   */
  private async generateAccessToken(user: { id: string; email: string; name: string }): Promise<string> {
    // This is a placeholder - the actual JWT generation will happen in the routes
    // using Fastify's JWT plugin
    return `temp-access-token-${user.id}`;
  }

  /**
   * Clean up expired refresh tokens
   */
  async cleanupExpiredTokens(): Promise<void> {
    await getDatabase()
      .deleteFrom('refresh_tokens')
      .where('expires_at', '<', new Date())
      .execute();
  }
}

// Export singleton instance
export const authService = new AuthService();