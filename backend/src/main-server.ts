import Fastify, { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyRedis from '@fastify/redis';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { setupRoutes } from './routes';
import { logger } from './utils/logger';
import { setupWebSocket } from './services/websocket';
import { uploadCleanupJob } from './services/cleanup';

// Initialize Prisma client
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Create Fastify instance with TypeBox
const server: FastifyInstance = Fastify({
  logger: logger,
  maxParamLength: 5000,
  bodyLimit: 1024 * 1024 * 100, // 100MB for chunk uploads
}).withTypeProvider<TypeBoxTypeProvider>();

async function buildServer(): Promise<FastifyInstance> {
  try {
    // Security middleware
    await server.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    });

    // CORS configuration
    await server.register(fastifyCors, {
      origin: process.env.NODE_ENV === 'production' 
        ? [config.frontend.url] 
        : true,
      credentials: true,
    });

    // Rate limiting
    await server.register(fastifyRateLimit, {
      max: 1000,
      timeWindow: '15 minutes',
      redis: server.redis,
    });

    // Redis connection
    await server.register(fastifyRedis, {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
    });

    // WebSocket support
    await server.register(fastifyWebsocket);

    // Multipart support for file uploads
    await server.register(fastifyMultipart, {
      limits: {
        fieldNameSize: 100,
        fieldSize: 1024 * 1024 * 10, // 10MB for chunk size
        fields: 10,
        fileSize: 1024 * 1024 * 100, // 100MB per chunk
        files: 1,
        headerPairs: 2000,
      },
    });

    // Static file serving
    await server.register(fastifyStatic, {
      root: path.join(__dirname, '../uploads'),
      prefix: '/uploads/',
      decorateReply: false,
    });

    await server.register(fastifyStatic, {
      root: path.join(__dirname, '../media'),
      prefix: '/media/',
      decorateReply: false,
    });

    // Setup WebSocket handlers
    setupWebSocket(server);

    // Register API routes
    await setupRoutes(server);

    // Health check endpoint
    server.get('/health', async (request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        await server.redis.ping();
        return { status: 'healthy', timestamp: new Date().toISOString() };
      } catch (error) {
        reply.status(503);
        return { status: 'unhealthy', error: error.message };
      }
    });

    // Global error handler
    server.setErrorHandler(async (error, request, reply) => {
      server.log.error(error);
      
      if (error.validation) {
        reply.status(400).send({
          error: 'Validation Error',
          message: error.message,
          details: error.validation,
        });
        return;
      }

      if (error.statusCode) {
        reply.status(error.statusCode).send({
          error: error.name,
          message: error.message,
        });
        return;
      }

      reply.status(500).send({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' 
          ? 'Something went wrong' 
          : error.message,
      });
    });

    return server;
  } catch (error) {
    server.log.error('Error building server:', error);
    throw error;
  }
}

async function startServer() {
  try {
    const app = await buildServer();
    
    // Start cleanup job
    uploadCleanupJob.start();
    
    // Connect to database
    await prisma.$connect();
    server.log.info('Connected to database');

    // Start server
    const address = await app.listen({
      port: config.server.port,
      host: config.server.host,
    });
    
    server.log.info(`Server listening at ${address}`);
    
    // Graceful shutdown
    const shutdown = async (signal: string) => {
      server.log.info(`Received ${signal}, shutting down gracefully`);
      
      uploadCleanupJob.stop();
      await app.close();
      await prisma.$disconnect();
      
      process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
  } catch (error) {
    server.log.error('Error starting server:', error);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

export { buildServer, startServer };