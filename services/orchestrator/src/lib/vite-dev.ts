import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'path';
import { FastifyInstance } from 'fastify';

export async function setupViteDev(server: FastifyInstance) {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const frontendRoot = join(__dirname, '../../frontend');
  
  const vite = await createServer({
    root: frontendRoot,
    server: { 
      middlewareMode: true,
      hmr: false // Completely disable HMR to fix the duplicate injection issue
    },
    plugins: [react()] as any,
    appType: 'spa',
    resolve: {
      alias: {
        '@': join(frontendRoot, 'src'),
      },
    },
    optimizeDeps: {
      // Force Vite to look in the frontend directory for dependencies
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        '@tanstack/react-query',
        'react-router-dom',
        'xterm',
        'xterm-addon-fit',
        'xterm-addon-web-links'
      ]
    },
    clearScreen: false,
    logLevel: 'info' // Increase logging to debug issues
  });

  // Handle frontend routes with Vite (avoiding conflict with CORS)
  server.register(async function (fastify) {
    // Add a fallback handler for non-API routes
    fastify.setNotFoundHandler(async (request, reply) => {
      // Only handle non-API routes
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 });
      }
      
      // Get the raw Node.js request and response objects
      const req = request.raw;
      const res = reply.raw;
      
      // Vite expects these properties to be set
      if (!req.url) req.url = request.url;
      if (!req.method) req.method = request.method;
      if (!req.headers) req.headers = request.headers;
      
      return new Promise((resolve, reject) => {
        vite.middlewares(req, res, (err: any) => {
          if (err) {
            reply.code(500).send({ error: 'Vite middleware error', message: err.message });
            reject(err);
          } else {
            reply.hijack();
            resolve(undefined);
          }
        });
      });
    });
  });

  server.addHook('onClose', async () => {
    await vite.close();
  });
}