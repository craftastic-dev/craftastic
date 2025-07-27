import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';

// Load environment variables from .env file
dotenvConfig({ path: join(__dirname, '../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  DATABASE_URL: z.string(),
  
  JWT_SECRET: z.string(),
  CORS_ORIGIN: z.string().default('*'),
  
  DOCKER_HOST: z.string().optional(),
  SANDBOX_IMAGE: z.string().default('node:20-alpine'),
  SANDBOX_MEMORY_LIMIT: z.string().default('512m'),
  SANDBOX_CPU_LIMIT: z.string().default('0.5'),
  
  COOLIFY_API_URL: z.string().optional(),
  COOLIFY_API_TOKEN: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;