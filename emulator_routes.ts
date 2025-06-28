import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@prisma/client';
import { UniversalEmulatorService } from '../services/emulator';
import { logger } from '../utils/logger';
import { broadcastToAll } from '../services/websocket';

// =====================================================
// EMULATOR API SCHEMAS
// =====================================================

const EmulatorConfigSchema = Type.Object({
  platformConfig: Type.Object({
    fileExtensions: Type.Array(Type.String()),
    browserEmulators: Type.Array(Type.Object({
      name: Type.String(),
      core: Type.String(),
      wasm: Type.Boolean(),
      performance: Type.Union([
        Type.Literal('excellent'),
        Type.Literal('good'),
        Type.Literal('fair'),
        Type.Literal('poor')
      ])
    })),
    retroarchCores: Type.Array(Type.String()),
    biosRequired: Type.Boolean(),
    biosFiles: Type.Optional(Type.Array(Type.String())),
    controllerSupport: Type.Boolean(),
    saveStates: Type.Boolean(),
    defaultCore: Type.String(),
    requiresNative: Type.Optional(Type.Boolean()),
    mobileOptimized: Type.Optional(Type.Boolean())
  }),
  recommendedEmulator: Type.Union([Type.Literal('browser'), Type.Literal('native')]),
  availableEmulators: Type.Array(Type.Object({
    name: Type.String(),
    core: Type.String(),
    wasm: Type.Boolean(),
    performance: Type.Union([
      Type.Literal('excellent'),
      Type.Literal('good'),
      Type.Literal('fair'),
      Type.Literal('poor')
    ])
  })),
  requiredBios: Type.Array(Type.String())
});

const EmulatorSessionSchema = Type.Object({
  id: Type.String(),
  gameId: Type.String(),
  userId: Type.Optional(Type.String()),
  platform: Type.String(),
  core: Type.String(),
  emulatorType: Type.Union([Type.Literal('browser'), Type.Literal('native')]),
  status: Type.Union([
    Type.Literal('starting'),
    Type.Literal('running'),
    Type.Literal('paused'),
    Type.Literal('stopped'),
    Type.Literal('error')
  ]),
  startTime: Type.String(),
  lastActivity: Type.String(),
  metrics: Type.Object({
    fps: Type.Number(),
    frameSkip: Type.Number(),
    audioLatency: Type.Number(),
    inputLatency: Type.Number(),
    cpuUsage: Type.Number(),
    memoryUsage: Type.Number(),
    temperature: Type.Optional(Type.Number()),
    batteryLevel: Type.Optional(Type.Number())
  }),
  streamUrl: Type.Optional(Type.String()),
  vncUrl: Type.Optional(Type.String())
});

const SaveStateSchema = Type.Object({
  id: Type.String(),
  gameId: Type.String(),
  userId: Type.Optional(Type.String()),
  slotNumber: Type.Number(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  screenshot: Type.String(),
  metadata: Type.Object({
    platform: Type.String(),
    core: Type.String(),
    timestamp: Type.String(),
    gameTime: Type.Optional(Type.Number()),
    level: Type.Optional(Type.String()),
    score: Type.Optional(Type.Number())
  }),
  createdAt: Type.String(),
  fileSize: Type.Number()
});

const BrowserEmulatorRequestSchema = Type.Object({
  coreId: Type.String(),
  userId: Type.Optional(Type.String()),
  settings: Type.Optional(Type.Object({
    volume: Type.Optional(Type.Number()),
    speed: Type.Optional(Type.Number()),
    filters: Type.Optional(Type.Array(Type.String())),
    cheats: Type.Optional(Type.Boolean()),
    rewind: Type.Optional(Type.Boolean())
  }))
});

const NativeEmulatorRequestSchema = Type.Object({
  coreId: Type.String(),
  userId: Type.Optional(Type.String()),
  streamConfig: Type.Optional(Type.Object({
    resolution: Type.Union([
      Type.Literal('720p'),
      Type.Literal('1080p'),
      Type.Literal('1440p')
    ]),
    framerate: Type.Union([Type.Literal(30), Type.Literal(60)]),
    codec: Type.Union([Type.Literal('h264'), Type.Literal('h265')]),
    enableAudio: Type.Boolean()
  })),
  settings: Type.Optional(Type.Object({
    rewind: Type.Optional(Type.Boolean()),
    saveStates: Type.Optional(Type.Boolean()),
    cheats: Type.Optional(Type.Boolean()),
    fastForward: Type.Optional(Type.Boolean())
  }))
});

const SaveStateRequestSchema = Type.Object({
  slotNumber: Type.Number({ minimum: 0, maximum: 9 }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.Optional(Type.String({ maxLength: 500 }))
});

const SystemStatusSchema = Type.Object({
  activeSessions: Type.Number(),
  supportedPlatforms: Type.Array(Type.String()),
  availableCores: Type.Record(Type.String(), Type.Array(Type.String())),
  biosStatus: Type.Record(Type.String(), Type.Boolean()),
  performance: Type.Object({
    averageFps: Type.Number(),
    activeStreams: Type.Number(),
    systemLoad: Type.Number()
  })
});

// =====================================================
// EMULATOR ROUTES
// =====================================================

export async function emulatorRoutes(server: FastifyInstance) {
  const prisma = new PrismaClient();
  const emulatorService = new UniversalEmulatorService(prisma);

  // Rate limiting for emulator endpoints
  await server.register(import('@fastify/rate-limit'), {
    max: 50, // 50 requests per timeWindow
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  /**
   * Get emulator configuration for a game
   */
  server.get('/config/:gameId', {
    schema: {
      description: 'Get emulator configuration for a specific game',
      tags: ['Emulator'],
      params: Type.Object({
        gameId: Type.String()
      }),
      response: {
        200: EmulatorConfigSchema,
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { gameId } = request.params;

    try {
      const config = await emulatorService.getEmulatorConfig(gameId);
      return config;
    } catch (error) {
      server.log.error(`Failed to get emulator config for game ${gameId}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Start browser emulator session
   */
  server.post('/browser/:gameId', {
    schema: {
      description: 'Start a browser-based emulator session',
      tags: ['Emulator'],
      params: Type.Object({
        gameId: Type.String()
      }),
      body: BrowserEmulatorRequestSchema,
      response: {
        200: Type.Object({
          sessionId: Type.String(),
          config: Type.Any(),
          romUrl: Type.String(),
          biosUrls: Type.Array(Type.String()),
          coreUrl: Type.String()
        }),
        400: { $ref: 'ErrorSchema#' },
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { gameId } = request.params;
    const { coreId, userId, settings } = request.body;

    try {
      const result = await emulatorService.startBrowserEmulator(gameId, coreId, userId);
      
      // Broadcast session start event
      await broadcastToAll({
        type: 'emulator_session_started',
        data: {
          sessionId: result.sessionId,
          gameId,
          emulatorType: 'browser'
        },
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      server.log.error(`Failed to start browser emulator for game ${gameId}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else if (error.message.includes('not available')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Start native emulator session
   */
  server.post('/native/:gameId', {
    schema: {
      description: 'Start a native emulator session with optional streaming',
      tags: ['Emulator'],
      params: Type.Object({
        gameId: Type.String()
      }),
      body: NativeEmulatorRequestSchema,
      response: {
        200: Type.Object({
          sessionId: Type.String(),
          streamUrl: Type.Optional(Type.String()),
          vncUrl: Type.Optional(Type.String()),
          webrtcOffer: Type.Optional(Type.Any())
        }),
        400: { $ref: 'ErrorSchema#' },
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { gameId } = request.params;
    const { coreId, userId, streamConfig, settings } = request.body;

    try {
      const result = await emulatorService.startNativeEmulator(
        gameId, 
        coreId, 
        userId, 
        streamConfig
      );
      
      // Broadcast session start event
      await broadcastToAll({
        type: 'emulator_session_started',
        data: {
          sessionId: result.sessionId,
          gameId,
          emulatorType: 'native',
          streaming: !!streamConfig
        },
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      server.log.error(`Failed to start native emulator for game ${gameId}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else if (error.message.includes('not available')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get emulator session status
   */
  server.get('/session/:sessionId', {
    schema: {
      description: 'Get emulator session status and information',
      tags: ['Emulator'],
      params: Type.Object({
        sessionId: Type.String()
      }),
      response: {
        200: EmulatorSessionSchema,
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.params;

    try {
      const session = await emulatorService.getSession(sessionId);
      
      if (!session) {
        reply.status(404);
        throw new Error('Session not found');
      }

      return {
        id: session.id,
        gameId: session.gameId,
        userId: session.userId,
        platform: session.platform,
        core: session.core,
        emulatorType: session.emulatorType,
        status: session.status,
        startTime: session.startTime.toISOString(),
        lastActivity: session.lastActivity.toISOString(),
        metrics: session.metrics,
        streamUrl: session.streamUrl,
        vncUrl: session.streamUrl?.replace('rtmp://', 'ws://').replace('1935', '5900')
      };
    } catch (error) {
      server.log.error(`Failed to get session ${sessionId}:`, error);
      
      if (error.message === 'Session not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Stop emulator session
   */
  server.delete('/session/:sessionId', {
    schema: {
      description: 'Stop an active emulator session',
      tags: ['Emulator'],
      params: Type.Object({
        sessionId: Type.String()
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.params;

    try {
      await emulatorService.stopSession(sessionId);
      
      // Broadcast session stop event
      await broadcastToAll({
        type: 'emulator_session_stopped',
        data: { sessionId },
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        message: 'Session stopped successfully'
      };
    } catch (error) {
      server.log.error(`Failed to stop session ${sessionId}:`, error);
      
      if (error.message === 'Session not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Pause emulator session
   */
  server.post('/session/:sessionId/pause', {
    schema: {
      description: 'Pause an active emulator session',
      tags: ['Emulator'],
      params: Type.Object({
        sessionId: Type.String()
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.params;

    try {
      await emulatorService.pauseSession(sessionId);
      
      return {
        success: true,
        message: 'Session paused successfully'
      };
    } catch (error) {
      server.log.error(`Failed to pause session ${sessionId}:`, error);
      
      if (error.message === 'Session not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Resume emulator session
   */
  server.post('/session/:sessionId/resume', {
    schema: {
      description: 'Resume a paused emulator session',
      tags: ['Emulator'],
      params: Type.Object({
        sessionId: Type.String()
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.params;

    try {
      await emulatorService.resumeSession(sessionId);
      
      return {
        success: true,
        message: 'Session resumed successfully'
      };
    } catch (error) {
      server.log.error(`Failed to resume session ${sessionId}:`, error);
      
      if (error.message === 'Session not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get session metrics
   */
  server.get('/session/:sessionId/metrics', {
    schema: {
      description: 'Get real-time metrics for an emulator session',
      tags: ['Emulator'],
      params: Type.Object({
        sessionId: Type.String()
      }),
      response: {
        200: Type.Object({
          fps: Type.Number(),
          frameSkip: Type.Number(),
          audioLatency: Type.Number(),
          inputLatency: Type.Number(),
          cpuUsage: Type.Number(),
          memoryUsage: Type.Number(),
          temperature: Type.Optional(Type.Number()),
          batteryLevel: Type.Optional(Type.Number())
        }),
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.params;

    try {
      const metrics = await emulatorService.getSessionMetrics(sessionId);
      
      if (!metrics) {
        reply.status(404);
        throw new Error('Session not found or no metrics available');
      }

      return metrics;
    } catch (error) {
      server.log.error(`Failed to get metrics for session ${sessionId}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Create save state
   */
  server.post('/session/:sessionId/savestate', {
    schema: {
      description: 'Create a save state for the current emulator session',
      tags: ['Emulator'],
      params: Type.Object({
        sessionId: Type.String()
      }),
      body: SaveStateRequestSchema,
      response: {
        200: SaveStateSchema,
        404: { $ref: 'ErrorSchema#' },
        400: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.params;
    const { slotNumber, name, description } = request.body;

    try {
      const saveState = await emulatorService.createSaveState(
        sessionId,
        slotNumber,
        name,
        description
      );
      
      return {
        id: saveState.id,
        gameId: saveState.gameId,
        userId: saveState.userId,
        slotNumber: saveState.slotNumber,
        name: saveState.name,
        description: saveState.description,
        screenshot: saveState.screenshot,
        metadata: {
          platform: saveState.metadata.platform,
          core: saveState.metadata.core,
          timestamp: saveState.metadata.timestamp.toISOString(),
          gameTime: saveState.metadata.gameTime,
          level: saveState.metadata.level,
          score: saveState.metadata.score
        },
        createdAt: saveState.createdAt.toISOString(),
        fileSize: saveState.fileSize
      };
    } catch (error) {
      server.log.error(`Failed to create save state for session ${sessionId}:`, error);
      
      if (error.message === 'Session not found') {
        reply.status(404);
      } else if (error.message.includes('Browser save states')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Load save state
   */
  server.post('/session/:sessionId/savestate/:saveStateId/load', {
    schema: {
      description: 'Load a save state in the current emulator session',
      tags: ['Emulator'],
      params: Type.Object({
        sessionId: Type.String(),
        saveStateId: Type.String()
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' },
        400: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { sessionId, saveStateId } = request.params;

    try {
      await emulatorService.loadSaveState(sessionId, saveStateId);
      
      return {
        success: true,
        message: 'Save state loaded successfully'
      };
    } catch (error) {
      server.log.error(`Failed to load save state ${saveStateId} for session ${sessionId}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else if (error.message.includes('Browser save state')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get save states for a game
   */
  server.get('/games/:gameId/savestates', {
    schema: {
      description: 'Get all save states for a specific game',
      tags: ['Emulator'],
      params: Type.Object({
        gameId: Type.String()
      }),
      querystring: Type.Object({
        userId: Type.Optional(Type.String())
      }),
      response: {
        200: Type.Object({
          saveStates: Type.Array(SaveStateSchema),
          total: Type.Number()
        }),
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { gameId } = request.params;
    const { userId } = request.query as any;

    try {
      const saveStates = await emulatorService.getSaveStates(gameId, userId);
      
      const formattedSaveStates = saveStates.map(state => ({
        id: state.id,
        gameId: state.gameId,
        userId: state.userId,
        slotNumber: state.slotNumber,
        name: state.name,
        description: state.description,
        screenshot: state.screenshot,
        metadata: {
          platform: state.metadata.platform,
          core: state.metadata.core,
          timestamp: state.metadata.timestamp.toISOString(),
          gameTime: state.metadata.gameTime,
          level: state.metadata.level,
          score: state.metadata.score
        },
        createdAt: state.createdAt.toISOString(),
        fileSize: state.fileSize
      }));

      return {
        saveStates: formattedSaveStates,
        total: saveStates.length
      };
    } catch (error) {
      server.log.error(`Failed to get save states for game ${gameId}:`, error);
      reply.status(500);
      throw error;
    }
  });

  /**
   * Delete save state
   */
  server.delete('/savestates/:saveStateId', {
    schema: {
      description: 'Delete a save state',
      tags: ['Emulator'],
      params: Type.Object({
        saveStateId: Type.String()
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' }
      }
    }
  }, async (request, reply) => {
    const { saveStateId } = request.params;

    try {
      const saveState = await prisma.saveState.findUnique({
        where: { id: saveStateId }
      });

      if (!saveState) {
        reply.status(404);
        throw new Error('Save state not found');
      }

      await prisma.saveState.delete({
        where: { id: saveStateId }
      });

      // Clean up associated files
      const fs = require('fs').promises;
      const path = require('path');
      const saveStatePath = path.join(config.storage.tempDir, 'savestates', `${saveStateId}.state`);
      const screenshotPath = path.join(config.storage.tempDir, 'savestates', `${saveStateId}.png`);
      
      try {
        await fs.unlink(saveStatePath);
        await fs.unlink(screenshotPath);
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: true,
        message: 'Save state deleted successfully'
      };
    } catch (error) {
      server.log.error(`Failed to delete save state ${saveStateId}:`, error);
      
      if (error.message === 'Save state not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get ROM file for emulator
   */
  server.get('/games/:gameId/rom', {
    schema: {
      description: 'Get ROM file for emulator (streaming endpoint)',
      tags: ['Emulator'],
      params: Type.Object({
        gameId: Type.String()
      })
    }
  }, async (request, reply) => {
    const { gameId } = request.params;

    try {
      const game = await prisma.game.findUnique({
        where: { id: gameId }
      });

      if (!game) {
        reply.status(404);
        throw new Error('Game not found');
      }

      const fs = require('fs');
      const path = require('path');
      
      // Security check - ensure file path is within allowed directories
      const romPath = path.resolve(game.filePath);
      const allowedDir = path.resolve(config.storage.romDir);
      
      if (!romPath.startsWith(allowedDir)) {
        reply.status(403);
        throw new Error('Access denied');
      }

      const stream = fs.createReadStream(romPath);
      
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', game.fileSize.toString());
      reply.header('Content-Disposition', `attachment; filename="${game.fileName}"`);
      reply.header('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      
      return reply.send(stream);
    } catch (error) {
      server.log.error(`Failed to serve ROM for game ${gameId}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else if (error.message === 'Access denied') {
        reply.status(403);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get BIOS file
   */
  server.get('/bios/:biosFile', {
    schema: {
      description: 'Get BIOS file for emulator',
      tags: ['Emulator'],
      params: Type.Object({
        biosFile: Type.String()
      })
    }
  }, async (request, reply) => {
    const { biosFile } = request.params;

    try {
      const fs = require('fs');
      const path = require('path');
      
      // Security check - ensure filename is safe
      if (biosFile.includes('..') || biosFile.includes('/') || biosFile.includes('\\')) {
        reply.status(400);
        throw new Error('Invalid BIOS filename');
      }

      const biosPath = path.join(config.storage.biosDir, biosFile);
      
      // Check if file exists
      if (!fs.existsSync(biosPath)) {
        reply.status(404);
        throw new Error('BIOS file not found');
      }

      const stream = fs.createReadStream(biosPath);
      const stats = fs.statSync(biosPath);
      
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', stats.size.toString());
      reply.header('Content-Disposition', `attachment; filename="${biosFile}"`);
      reply.header('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      
      return reply.send(stream);
    } catch (error) {
      server.log.error(`Failed to serve BIOS file ${biosFile}:`, error);
      
      if (error.message === 'BIOS file not found') {
        reply.status(404);
      } else if (error.message === 'Invalid BIOS filename') {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get system status
   */
  server.get('/status', {
    schema: {
      description: 'Get emulator system status and capabilities',
      tags: ['Emulator'],
      response: {
        200: SystemStatusSchema
      }
    }
  }, async (request, reply) => {
    try {
      const status = await emulatorService.getSystemStatus();
      return status;
    } catch (error) {
      server.log.error('Failed to get emulator system status:', error);
      reply.status(500);
      throw error;
    }
  });

  /**
   * List active sessions
   */
  server.get('/sessions', {
    schema: {
      description: 'List all active emulator sessions',
      tags: ['Emulator'],
      querystring: Type.Object({
        status: Type.Optional(Type.String()),
        emulatorType: Type.Optional(Type.String()),
        userId: Type.Optional(Type.String())
      }),
      response: {
        200: Type.Object({
          sessions: Type.Array(EmulatorSessionSchema),
          total: Type.Number()
        })
      }
    }
  }, async (request, reply) => {
    const { status, emulatorType, userId } = request.query as any;

    try {
      // This would typically filter sessions based on query parameters
      const systemStatus = await emulatorService.getSystemStatus();
      
      // For now, return basic session info
      return {
        sessions: [], // Would implement session listing
        total: systemStatus.activeSessions
      };
    } catch (error) {
      server.log.error('Failed to list emulator sessions:', error);
      reply.status(500);
      throw error;
    }
  });

  /**
   * WebSocket endpoint for real-time emulator events
   */
  server.register(async function (server) {
    server.get('/ws/:sessionId', { websocket: true }, (socket, request) => {
      const { sessionId } = request.params as any;
      
      logger.info(`WebSocket connection established for emulator session ${sessionId}`);
      
      // Store socket reference in session
      emulatorService.getSession(sessionId).then(session => {
        if (session) {
          session.websocket = socket;
        }
      });

      // Handle WebSocket messages
      socket.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          handleEmulatorWebSocketMessage(sessionId, data, socket);
        } catch (error) {
          logger.error('Failed to parse WebSocket message:', error);
        }
      });

      socket.on('close', () => {
        logger.info(`WebSocket connection closed for session ${sessionId}`);
      });
    });
  });

  // Helper function to handle WebSocket messages
  async function handleEmulatorWebSocketMessage(
    sessionId: string, 
    message: any, 
    socket: any
  ): Promise<void> {
    switch (message.type) {
      case 'input':
        // Handle controller input for native emulator
        break;
      case 'save_state':
        // Handle save state creation from browser
        break;
      case 'load_state':
        // Handle save state loading from browser
        break;
      case 'metrics':
        // Update session metrics
        break;
      default:
        logger.warn(`Unknown WebSocket message type: ${message.type}`);
    }
  }
}

export { emulatorRoutes };