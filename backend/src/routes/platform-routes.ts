import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@prisma/client';
import { config, getAllPlatforms } from '../config';
import { logger } from '../utils/logger';

// Platform-specific schemas
const PlatformSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  shortName: Type.String(),
  manufacturer: Type.String(),
  releaseYear: Type.Optional(Type.Integer()),
  description: Type.Optional(Type.String()),
  icon: Type.Optional(Type.String()),
  supportedFormats: Type.Array(Type.String()),
  emulatorCores: Type.Array(Type.String()),
  biosRequired: Type.Boolean(),
  biosFiles: Type.Array(Type.String()),
  gameCount: Type.Optional(Type.Integer()),
  totalSize: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const PlatformListSchema = Type.Object({
  platforms: Type.Array(PlatformSchema),
  total: Type.Integer(),
});

const PlatformCreateSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  shortName: Type.String({ minLength: 1, maxLength: 50 }),
  manufacturer: Type.String({ minLength: 1, maxLength: 255 }),
  releaseYear: Type.Optional(Type.Integer({ minimum: 1970, maximum: 2030 })),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  icon: Type.Optional(Type.String()),
  supportedFormats: Type.Array(Type.String()),
  emulatorCores: Type.Array(Type.String()),
  biosRequired: Type.Boolean({ default: false }),
  biosFiles: Type.Optional(Type.Array(Type.String())),
});

const PlatformUpdateSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  shortName: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  manufacturer: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  releaseYear: Type.Optional(Type.Integer({ minimum: 1970, maximum: 2030 })),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  icon: Type.Optional(Type.String()),
  supportedFormats: Type.Optional(Type.Array(Type.String())),
  emulatorCores: Type.Optional(Type.Array(Type.String())),
  biosRequired: Type.Optional(Type.Boolean()),
  biosFiles: Type.Optional(Type.Array(Type.String())),
});

const PlatformStatsSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  gameCount: Type.Integer(),
  totalSize: Type.String(),
  averageRating: Type.Optional(Type.Number()),
  mostPlayedGame: Type.Optional(Type.Object({
    id: Type.String(),
    title: Type.String(),
    playCount: Type.Integer(),
  })),
  recentlyAdded: Type.Array(Type.Object({
    id: Type.String(),
    title: Type.String(),
    createdAt: Type.String(),
  })),
  genreDistribution: Type.Array(Type.Object({
    genre: Type.String(),
    count: Type.Integer(),
  })),
});

export async function platformRoutes(server: FastifyInstance) {
  const prisma = new PrismaClient();

  /**
   * Get all platforms
   */
  server.get('/', {
    schema: {
      description: 'Get all platforms',
      tags: ['Platforms'],
      querystring: Type.Object({
        includeStats: Type.Optional(Type.Boolean({ default: false })),
        manufacturer: Type.Optional(Type.String()),
        biosRequired: Type.Optional(Type.Boolean()),
      }),
      response: {
        200: PlatformListSchema,
      },
    },
  }, async (request, reply) => {
    const { includeStats = false, manufacturer, biosRequired } = request.query as any;

    try {
      // Build where clause
      const where: any = {};
      if (manufacturer) {
        where.manufacturer = { contains: manufacturer, mode: 'insensitive' };
      }
      if (biosRequired !== undefined) {
        where.biosRequired = biosRequired;
      }

      // Get platforms from database
      let platforms = await prisma.platform.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      // If no platforms in database, initialize from config
      if (platforms.length === 0) {
        await initializePlatforms();
        platforms = await prisma.platform.findMany({
          where,
          orderBy: { name: 'asc' },
        });
      }

      // Include statistics if requested
      let formattedPlatforms = platforms;
      if (includeStats) {
        const platformStats = await Promise.all(
          platforms.map(async (platform) => {
            const [gameCount, totalSizeResult] = await Promise.all([
              prisma.game.count({
                where: { platformId: platform.id },
              }),
              prisma.game.aggregate({
                where: { platformId: platform.id },
                _sum: { fileSize: true },
              }),
            ]);

            const totalSize = Number(totalSizeResult._sum.fileSize || 0);

            return {
              ...platform,
              gameCount,
              totalSize: formatFileSize(totalSize),
            };
          })
        );
        formattedPlatforms = platformStats;
      }

      const result = formattedPlatforms.map(platform => ({
        id: platform.id,
        name: platform.name,
        shortName: platform.shortName,
        manufacturer: platform.manufacturer,
        releaseYear: platform.releaseYear,
        description: platform.description,
        icon: platform.icon,
        supportedFormats: platform.supportedFormats,
        emulatorCores: platform.emulatorCores,
        biosRequired: platform.biosRequired,
        biosFiles: platform.biosFiles,
        gameCount: platform.gameCount,
        totalSize: platform.totalSize,
        createdAt: platform.createdAt.toISOString(),
        updatedAt: platform.updatedAt.toISOString(),
      }));

      return {
        platforms: result,
        total: result.length,
      };
    } catch (error) {
      server.log.error('Failed to get platforms:', error);
      reply.status(500);
      throw error;
    }
  });

  /**
   * Get a specific platform by ID
   */
  server.get('/:id', {
    schema: {
      description: 'Get a specific platform by ID',
      tags: ['Platforms'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: PlatformSchema,
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const platform = await prisma.platform.findUnique({
        where: { id },
      });

      if (!platform) {
        reply.status(404);
        throw new Error('Platform not found');
      }

      // Get game statistics
      const [gameCount, totalSizeResult] = await Promise.all([
        prisma.game.count({
          where: { platformId: platform.id },
        }),
        prisma.game.aggregate({
          where: { platformId: platform.id },
          _sum: { fileSize: true },
        }),
      ]);

      const totalSize = Number(totalSizeResult._sum.fileSize || 0);

      return {
        id: platform.id,
        name: platform.name,
        shortName: platform.shortName,
        manufacturer: platform.manufacturer,
        releaseYear: platform.releaseYear,
        description: platform.description,
        icon: platform.icon,
        supportedFormats: platform.supportedFormats,
        emulatorCores: platform.emulatorCores,
        biosRequired: platform.biosRequired,
        biosFiles: platform.biosFiles,
        gameCount,
        totalSize: formatFileSize(totalSize),
        createdAt: platform.createdAt.toISOString(),
        updatedAt: platform.updatedAt.toISOString(),
      };
    } catch (error) {
      server.log.error(`Failed to get platform ${id}:`, error);
      
      if (error.message === 'Platform not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Create a new platform
   */
  server.post('/', {
    schema: {
      description: 'Create a new platform',
      tags: ['Platforms'],
      body: PlatformCreateSchema,
      response: {
        201: PlatformSchema,
        409: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const platformData = request.body;

    try {
      // Check if platform with same name or shortName already exists
      const existingPlatform = await prisma.platform.findFirst({
        where: {
          OR: [
            { name: platformData.name },
            { shortName: platformData.shortName },
          ],
        },
      });

      if (existingPlatform) {
        reply.status(409);
        throw new Error('Platform with this name or short name already exists');
      }

      // Create the platform
      const platform = await prisma.platform.create({
        data: {
          ...platformData,
          biosFiles: platformData.biosFiles || [],
        },
      });

      logger.info(`Platform created: ${platform.name} (${platform.id})`);

      reply.status(201);
      return {
        id: platform.id,
        name: platform.name,
        shortName: platform.shortName,
        manufacturer: platform.manufacturer,
        releaseYear: platform.releaseYear,
        description: platform.description,
        icon: platform.icon,
        supportedFormats: platform.supportedFormats,
        emulatorCores: platform.emulatorCores,
        biosRequired: platform.biosRequired,
        biosFiles: platform.biosFiles,
        gameCount: 0,
        totalSize: '0 Bytes',
        createdAt: platform.createdAt.toISOString(),
        updatedAt: platform.updatedAt.toISOString(),
      };
    } catch (error) {
      server.log.error('Failed to create platform:', error);
      
      if (error.message.includes('already exists')) {
        reply.status(409);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Update a platform
   */
  server.put('/:id', {
    schema: {
      description: 'Update a platform',
      tags: ['Platforms'],
      params: Type.Object({
        id: Type.String(),
      }),
      body: PlatformUpdateSchema,
      response: {
        200: PlatformSchema,
        404: { $ref: 'ErrorSchema#' },
        409: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const updates = request.body;

    try {
      // Check if platform exists
      const existingPlatform = await prisma.platform.findUnique({
        where: { id },
      });

      if (!existingPlatform) {
        reply.status(404);
        throw new Error('Platform not found');
      }

      // Check for name/shortName conflicts if updating those fields
      if (updates.name || updates.shortName) {
        const conflictingPlatform = await prisma.platform.findFirst({
          where: {
            AND: [
              { id: { not: id } },
              {
                OR: [
                  updates.name ? { name: updates.name } : {},
                  updates.shortName ? { shortName: updates.shortName } : {},
                ].filter(condition => Object.keys(condition).length > 0),
              },
            ],
          },
        });

        if (conflictingPlatform) {
          reply.status(409);
          throw new Error('Platform with this name or short name already exists');
        }
      }

      // Update the platform
      const platform = await prisma.platform.update({
        where: { id },
        data: {
          ...updates,
          updatedAt: new Date(),
        },
      });

      logger.info(`Platform updated: ${platform.name} (${id})`);

      // Get game statistics
      const [gameCount, totalSizeResult] = await Promise.all([
        prisma.game.count({
          where: { platformId: platform.id },
        }),
        prisma.game.aggregate({
          where: { platformId: platform.id },
          _sum: { fileSize: true },
        }),
      ]);

      const totalSize = Number(totalSizeResult._sum.fileSize || 0);

      return {
        id: platform.id,
        name: platform.name,
        shortName: platform.shortName,
        manufacturer: platform.manufacturer,
        releaseYear: platform.releaseYear,
        description: platform.description,
        icon: platform.icon,
        supportedFormats: platform.supportedFormats,
        emulatorCores: platform.emulatorCores,
        biosRequired: platform.biosRequired,
        biosFiles: platform.biosFiles,
        gameCount,
        totalSize: formatFileSize(totalSize),
        createdAt: platform.createdAt.toISOString(),
        updatedAt: platform.updatedAt.toISOString(),
      };
    } catch (error) {
      server.log.error(`Failed to update platform ${id}:`, error);
      
      if (error.message === 'Platform not found') {
        reply.status(404);
      } else if (error.message.includes('already exists')) {
        reply.status(409);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Delete a platform
   */
  server.delete('/:id', {
    schema: {
      description: 'Delete a platform',
      tags: ['Platforms'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' },
        409: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      // Check if platform exists
      const existingPlatform = await prisma.platform.findUnique({
        where: { id },
      });

      if (!existingPlatform) {
        reply.status(404);
        throw new Error('Platform not found');
      }

      // Check if platform has any games
      const gameCount = await prisma.game.count({
        where: { platformId: id },
      });

      if (gameCount > 0) {
        reply.status(409);
        throw new Error(`Cannot delete platform with ${gameCount} games. Delete games first.`);
      }

      // Delete the platform
      await prisma.platform.delete({
        where: { id },
      });

      logger.info(`Platform deleted: ${existingPlatform.name} (${id})`);

      return {
        success: true,
        message: 'Platform deleted successfully',
      };
    } catch (error) {
      server.log.error(`Failed to delete platform ${id}:`, error);
      
      if (error.message === 'Platform not found') {
        reply.status(404);
      } else if (error.message.includes('Cannot delete')) {
        reply.status(409);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get platform statistics
   */
  server.get('/:id/stats', {
    schema: {
      description: 'Get detailed platform statistics',
      tags: ['Platforms'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: PlatformStatsSchema,
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const platform = await prisma.platform.findUnique({
        where: { id },
      });

      if (!platform) {
        reply.status(404);
        throw new Error('Platform not found');
      }

      // Get comprehensive statistics
      const [
        gameCount,
        totalSizeResult,
        averageRatingResult,
        mostPlayedGame,
        recentlyAdded,
        genreDistribution,
      ] = await Promise.all([
        // Game count
        prisma.game.count({
          where: { platformId: id },
        }),
        
        // Total file size
        prisma.game.aggregate({
          where: { platformId: id },
          _sum: { fileSize: true },
        }),
        
        // Average rating
        prisma.game.aggregate({
          where: { 
            platformId: id,
            rating: { not: null },
          },
          _avg: { rating: true },
        }),
        
        // Most played game
        prisma.game.findFirst({
          where: { platformId: id },
          orderBy: { playCount: 'desc' },
          select: { id: true, title: true, playCount: true },
        }),
        
        // Recently added games
        prisma.game.findMany({
          where: { platformId: id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, createdAt: true },
        }),
        
        // Genre distribution
        prisma.game.groupBy({
          by: ['genre'],
          where: { 
            platformId: id,
            genre: { not: null },
          },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
        }),
      ]);

      const totalSize = Number(totalSizeResult._sum.fileSize || 0);

      return {
        id: platform.id,
        name: platform.name,
        gameCount,
        totalSize: formatFileSize(totalSize),
        averageRating: averageRatingResult._avg.rating,
        mostPlayedGame: mostPlayedGame ? {
          id: mostPlayedGame.id,
          title: mostPlayedGame.title,
          playCount: mostPlayedGame.playCount,
        } : undefined,
        recentlyAdded: recentlyAdded.map(game => ({
          id: game.id,
          title: game.title,
          createdAt: game.createdAt.toISOString(),
        })),
        genreDistribution: genreDistribution.map(genre => ({
          genre: genre.genre!,
          count: genre._count.id,
        })),
      };
    } catch (error) {
      server.log.error(`Failed to get platform stats ${id}:`, error);
      
      if (error.message === 'Platform not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get games for a specific platform
   */
  server.get('/:id/games', {
    schema: {
      description: 'Get games for a specific platform',
      tags: ['Platforms'],
      params: Type.Object({
        id: Type.String(),
      }),
      querystring: Type.Object({
        page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        search: Type.Optional(Type.String()),
        genre: Type.Optional(Type.String()),
        sortBy: Type.Optional(Type.String({ default: 'title' })),
        sortOrder: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')], { default: 'asc' })),
      }),
      response: {
        200: Type.Object({
          games: Type.Array(Type.Object({
            id: Type.String(),
            title: Type.String(),
            genre: Type.Optional(Type.String()),
            releaseYear: Type.Optional(Type.Integer()),
            rating: Type.Optional(Type.Number()),
            fileSize: Type.String(),
            playCount: Type.Integer(),
            isFavorite: Type.Boolean(),
            createdAt: Type.String(),
          })),
          pagination: Type.Object({
            page: Type.Integer(),
            limit: Type.Integer(),
            total: Type.Integer(),
            totalPages: Type.Integer(),
          }),
        }),
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      page = 1,
      limit = 20,
      search,
      genre,
      sortBy = 'title',
      sortOrder = 'asc',
    } = request.query as any;

    try {
      // Check if platform exists
      const platform = await prisma.platform.findUnique({
        where: { id },
      });

      if (!platform) {
        reply.status(404);
        throw new Error('Platform not found');
      }

      // Build where clause
      const where: any = { platformId: id };
      
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { alternativeTitles: { has: search } },
        ];
      }
      
      if (genre) {
        where.genre = { contains: genre, mode: 'insensitive' };
      }

      // Build orderBy clause
      const orderBy: any = {};
      orderBy[sortBy] = sortOrder;

      // Execute queries
      const [games, total] = await Promise.all([
        prisma.game.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            title: true,
            genre: true,
            releaseYear: true,
            rating: true,
            fileSize: true,
            playCount: true,
            isFavorite: true,
            createdAt: true,
          },
        }),
        prisma.game.count({ where }),
      ]);

      return {
        games: games.map(game => ({
          id: game.id,
          title: game.title,
          genre: game.genre,
          releaseYear: game.releaseYear,
          rating: game.rating,
          fileSize: formatFileSize(Number(game.fileSize)),
          playCount: game.playCount,
          isFavorite: game.isFavorite,
          createdAt: game.createdAt.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      server.log.error(`Failed to get games for platform ${id}:`, error);
      
      if (error.message === 'Platform not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Initialize platforms from configuration
   */
  async function initializePlatforms(): Promise<void> {
    logger.info('Initializing platforms from configuration...');

    const configPlatforms = getAllPlatforms();
    
    for (const { id, config: platformConfig, category } of configPlatforms) {
      try {
        await prisma.platform.upsert({
          where: { shortName: id },
          create: {
            name: platformConfig.description,
            shortName: id,
            manufacturer: getManufacturerFromCategory(category),
            releaseYear: getReleaseYearFromPlatform(id),
            description: platformConfig.description,
            icon: getPlatformIcon(id),
            supportedFormats: platformConfig.extensions,
            emulatorCores: platformConfig.cores,
            biosRequired: platformConfig.biosRequired,
            biosFiles: platformConfig.biosFiles || [],
          },
          update: {
            supportedFormats: platformConfig.extensions,
            emulatorCores: platformConfig.cores,
            biosRequired: platformConfig.biosRequired,
            biosFiles: platformConfig.biosFiles || [],
          },
        });
      } catch (error) {
        logger.error(`Failed to initialize platform ${id}:`, error);
      }
    }

    logger.info(`Initialized ${configPlatforms.length} platforms`);
  }

  /**
   * Helper functions
   */
  function getManufacturerFromCategory(category: string): string {
    const manufacturers: Record<string, string> = {
      nintendo: 'Nintendo',
      sega: 'Sega',
      sony: 'Sony',
      arcade: 'Various',
      computer: 'Various',
    };
    return manufacturers[category] || 'Unknown';
  }

  function getReleaseYearFromPlatform(platformId: string): number | null {
    const releaseYears: Record<string, number> = {
      nes: 1985,
      snes: 1991,
      n64: 1996,
      gameboy: 1989,
      gbc: 1998,
      gba: 2001,
      genesis: 1989,
      mastersystem: 1986,
      saturn: 1995,
      dreamcast: 1999,
      psx: 1995,
      ps2: 2000,
      psp: 2005,
    };
    return releaseYears[platformId] || null;
  }

  function getPlatformIcon(platformId: string): string {
    const icons: Record<string, string> = {
      nes: '🎮',
      snes: '🎮',
      n64: '🎮',
      gameboy: '📱',
      gbc: '📱',
      gba: '📱',
      genesis: '🎮',
      mastersystem: '🎮',
      saturn: '🎮',
      dreamcast: '🎮',
      psx: '💿',
      ps2: '💿',
      psp: '📱',
      mame: '🕹️',
      neogeo: '🕹️',
      cps: '🕹️',
    };
    return icons[platformId] || '🎮';
  }
}

// Utility function to format file sizes
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export { platformRoutes };