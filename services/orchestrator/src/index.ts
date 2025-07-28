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
import { gitRoutes } from './routes/git';
import { deploymentRoutes } from './routes/deployment';
import { sessionRoutes } from './routes/sessions';
import agentRoutes from './routes/agents';
import { setupDatabase } from './lib/database';
import { setupViteDev } from './lib/vite-dev';

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

    if (config.NODE_ENV === 'production') {
      await server.register(fastifyStatic, {
        root: join(__dirname, '../frontend/dist'),
        prefix: '/',
      });
    } else {
      await setupViteDev(server);
    }

    server.register(containerRoutes, { prefix: '/api/containers' });
    server.register(environmentRoutes, { prefix: '/api' });
    server.register(terminalRoutes, { prefix: '/api/terminal' });
    server.register(gitRoutes, { prefix: '/api/git' });
    server.register(deploymentRoutes, { prefix: '/api/deployment' });
    server.register(sessionRoutes, { prefix: '/api/sessions' });
    server.register(agentRoutes, { prefix: '/api/agents' });

    await server.listen({ 
      port: config.PORT, 
      host: '0.0.0.0' 
    });

    server.log.info(`Server listening on ${config.PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();