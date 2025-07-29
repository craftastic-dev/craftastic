import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth';

// Request schemas
const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const PasswordResetRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const PasswordResetSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

const EmailVerificationSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

// Helper to get client context
function getClientContext(request: FastifyRequest) {
  return {
    userAgent: request.headers['user-agent'] || null,
    ipAddress: request.ip || null,
  };
}

export default async function authRoutes(fastify: FastifyInstance) {
  // Register new user
  fastify.post('/api/auth/register', async (request: FastifyRequest<{
    Body: z.infer<typeof RegisterSchema>;
  }>, reply: FastifyReply) => {
    try {
      const validatedData = RegisterSchema.parse(request.body);
      const context = getClientContext(request);
      
      const result = await authService.register(validatedData);
      
      // Generate proper JWT access token
      const accessToken = fastify.jwt.sign({
        sub: result.user.id,
        email: result.user.email,
        name: result.user.name,
        emailVerified: result.user.emailVerified,
      }, {
        expiresIn: '15m' // Short-lived access token
      });

      return reply.send({
        success: true,
        data: {
          ...result,
          accessToken,
        },
      });
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Login user
  fastify.post('/api/auth/login', async (request: FastifyRequest<{
    Body: z.infer<typeof LoginSchema>;
  }>, reply: FastifyReply) => {
    try {
      console.log('[Login] Request body:', request.body);
      const validatedData = LoginSchema.parse(request.body);
      console.log('[Login] Validated data:', validatedData);
      
      const context = getClientContext(request);
      
      console.log('[Login] Calling authService.login...');
      const result = await authService.login(validatedData, context);
      console.log('[Login] Auth service result:', { userId: result.user.id, email: result.user.email });
      
      // Generate proper JWT access token
      const accessToken = fastify.jwt.sign({
        sub: result.user.id,
        email: result.user.email,
        name: result.user.name,
        emailVerified: result.user.emailVerified,
      }, {
        expiresIn: '15m' // Short-lived access token
      });

      console.log('[Login] JWT token generated successfully');
      return reply.send({
        success: true,
        data: {
          ...result,
          accessToken,
        },
      });
    } catch (error) {
      console.error('[Login] Error:', error);
      return reply.status(401).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Refresh access token
  fastify.post('/api/auth/refresh', async (request: FastifyRequest<{
    Body: z.infer<typeof RefreshTokenSchema>;
  }>, reply: FastifyReply) => {
    try {
      const validatedData = RefreshTokenSchema.parse(request.body);
      
      const result = await authService.refreshToken(validatedData);
      
      // Generate proper JWT access token
      const accessToken = fastify.jwt.sign({
        sub: result.user.id,
        email: result.user.email,
        name: result.user.name,
        emailVerified: result.user.emailVerified,
      }, {
        expiresIn: '15m' // Short-lived access token
      });

      return reply.send({
        success: true,
        data: {
          ...result,
          accessToken,
        },
      });
    } catch (error) {
      return reply.status(401).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Logout (revoke refresh token)
  fastify.post('/api/auth/logout', async (request: FastifyRequest<{
    Body: z.infer<typeof RefreshTokenSchema>;
  }>, reply: FastifyReply) => {
    try {
      const validatedData = RefreshTokenSchema.parse(request.body);
      
      await authService.logout(validatedData.refreshToken);
      
      return reply.send({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Logout all sessions
  fastify.post('/api/auth/logout-all', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user.sub;
      
      await authService.logoutAll(userId);
      
      return reply.send({
        success: true,
        message: 'Logged out from all sessions',
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Get current user info
  fastify.get('/api/auth/me', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.send({
        success: true,
        data: {
          user: {
            id: request.user.sub,
            email: request.user.email,
            name: request.user.name,
            emailVerified: request.user.emailVerified,
          },
        },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Email verification
  fastify.post('/api/auth/verify-email', async (request: FastifyRequest<{
    Body: z.infer<typeof EmailVerificationSchema>;
  }>, reply: FastifyReply) => {
    try {
      const validatedData = EmailVerificationSchema.parse(request.body);
      
      await authService.verifyEmail(validatedData.token);
      
      return reply.send({
        success: true,
        message: 'Email verified successfully',
      });
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Request password reset
  fastify.post('/api/auth/request-password-reset', async (request: FastifyRequest<{
    Body: z.infer<typeof PasswordResetRequestSchema>;
  }>, reply: FastifyReply) => {
    try {
      const validatedData = PasswordResetRequestSchema.parse(request.body);
      
      const token = await authService.requestPasswordReset(validatedData.email);
      
      return reply.send({
        success: true,
        message: 'Password reset email sent if account exists',
        // In development, return the token for testing
        ...(process.env.NODE_ENV === 'development' && { resetToken: token }),
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Reset password
  fastify.post('/api/auth/reset-password', async (request: FastifyRequest<{
    Body: z.infer<typeof PasswordResetSchema>;
  }>, reply: FastifyReply) => {
    try {
      const validatedData = PasswordResetSchema.parse(request.body);
      
      await authService.resetPassword(validatedData.token, validatedData.password);
      
      return reply.send({
        success: true,
        message: 'Password reset successfully',
      });
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Change password (authenticated)
  fastify.post('/api/auth/change-password', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
    }
  }, async (request: FastifyRequest<{
    Body: z.infer<typeof ChangePasswordSchema>;
  }>, reply: FastifyReply) => {
    try {
      const validatedData = ChangePasswordSchema.parse(request.body);
      const userId = request.user.sub;
      
      await authService.changePassword(userId, validatedData.currentPassword, validatedData.newPassword);
      
      return reply.send({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  });
}