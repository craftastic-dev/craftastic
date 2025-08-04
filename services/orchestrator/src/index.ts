import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import { config } from './config';
import { containerRoutes } from './routes/containers';
import { environmentRoutes } from './routes/environments';
import { terminalRoutes } from './routes/terminal';
import gitRoutes from './routes/git';
import { deploymentRoutes } from './routes/deployment';
import { sessionRoutes } from './routes/sessions';
import agentRoutes from './routes/agents';
import authRoutes from './routes/auth';
import { cleanupRoutes } from './routes/cleanup';
import { setupDatabase } from './lib/database';
import { setupViteDev } from './lib/vite-dev';
import { cleanupStaleSessions, startPeriodicCleanup, stopPeriodicCleanup } from './services/session-cleanup';

const server = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
});

async function start() {
  try {
    await setupDatabase();

    await server.register(cors, {
      origin: config.CORS_ORIGIN,
    });

    await server.register(jwt, {
      secret: config.JWT_SECRET,
    });

    await server.register(websocket);

    // Authentication middleware (now using proper JWT)
    server.addHook('preHandler', async (request, reply) => {
      // Skip authentication for auth routes, static assets, and frontend routes
      const publicRoutes = [
        '/api/auth/register',
        '/api/auth/login', 
        '/api/auth/refresh',
        '/api/auth/verify-email',
        '/api/auth/request-password-reset',
        '/api/auth/reset-password'
      ];
      
      // Allow all non-API routes (frontend routes) and assets
      // WebSocket routes handle their own authentication
      if (publicRoutes.includes(request.routerPath) || 
          request.routerPath?.startsWith('/assets/') ||
          request.routerPath?.includes('/ws/') ||  // WebSocket routes handle auth internally
          !request.routerPath?.startsWith('/api/')) {
        return;
      }
      
      try {
        // Try to verify JWT token
        await request.jwtVerify();
        // Add compatibility with old user.id format
        request.user.id = request.user.sub;
      } catch (err) {
        // For now, allow development bypass during transition
        if (config.NODE_ENV === 'development' && request.headers['x-test-user-id']) {
          request.user = { 
            id: request.headers['x-test-user-id'],
            sub: request.headers['x-test-user-id'],
            email: `${request.headers['x-test-user-id']}@example.com`,
            name: `User ${request.headers['x-test-user-id']}`,
            emailVerified: false
          };
          return;
        }
        
        reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
    });

    if (config.NODE_ENV === 'production') {
      await server.register(fastifyStatic, {
        root: join(__dirname, '../frontend/dist'),
        prefix: '/',
      });
    } else {
      await setupViteDev(server);
    }

    server.register(authRoutes);
    server.register(containerRoutes, { prefix: '/api/containers' });
    server.register(environmentRoutes, { prefix: '/api' });
    server.register(terminalRoutes, { prefix: '/api/terminal' });
    server.register(gitRoutes);
    server.register(deploymentRoutes, { prefix: '/api/deployment' });
    server.register(sessionRoutes, { prefix: '/api/sessions' });
    server.register(agentRoutes, { prefix: '/api/agents' });
    server.register(cleanupRoutes, { prefix: '/api/cleanup' });

    await server.listen({ 
      port: config.PORT, 
      host: '0.0.0.0' 
    });

    server.log.info(`Server listening on ${config.PORT}`);
    
    // Start periodic cleanup of orphaned sessions
    startPeriodicCleanup(5 * 60 * 1000); // Run every 5 minutes
    
    // Graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down server...');
      
      // Stop periodic cleanup
      stopPeriodicCleanup();
      
      // Run final cleanup
      console.log('Running final session cleanup...');
      await cleanupStaleSessions();
      
      // Close server
      await server.close();
      console.log('Server shut down successfully');
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();