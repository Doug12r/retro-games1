import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@prisma/client';
import { uploadRoutes } from './upload';
import { gameRoutes } from './games';
import { platformRoutes } from './platforms';
import { config } from '../config';

// Common schemas
const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Any()),
});

const PaginationSchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  sortBy: Type.Optional(Type.String({ default: 'createdAt' })),
  sortOrder: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')], { default: 'desc' })),
});

const SuccessSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
  data: Type.Optional(Type.Any()),
});

// Main route setup function
export async function setupRoutes(server: FastifyInstance) {
  const prisma = new PrismaClient();

  // Add common schemas to the server
  server.addSchema({
    $id: 'ErrorSchema',
    ...ErrorSchema,
  });

  server.addSchema({
    $id: 'PaginationSchema',
    ...PaginationSchema,
  });

  server.addSchema({
    $id: 'SuccessSchema',
    ...SuccessSchema,
  });

  // API prefix
  await server.register(async function (server) {
    // Add Prisma to request context
    server.decorateRequest('prisma', prisma);
    
    // Health check
    server.get('/health', {
      schema: {
        description: 'Health check endpoint',
        tags: ['System'],
        response: {
          200: Type.Object({
            status: Type.String(),
            timestamp: Type.String(),
            version: Type.String(),
            database: Type.String(),
            redis: Type.String(),
          }),
          503: { $ref: 'ErrorSchema#' },
        },
      },
    }, async (request, reply) => {
      try {
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;
        const dbStatus = 'connected';

        // Check Redis connection
        await server.redis.ping();
        const redisStatus = 'connected';

        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: process.env.npm_package_version || '1.0.0',
          database: dbStatus,
          redis: redisStatus,
        };
      } catch (error) {
        reply.status(503);
        return {
          error: 'Service Unavailable',
          message: 'One or more services are unavailable',
          details: error.message,
        };
      }
    });

    // System info endpoint
    server.get('/info', {
      schema: {
        description: 'Get system information and supported formats',
        tags: ['System'],
        response: {
          200: Type.Object({
            supportedPlatforms: Type.Array(Type.Object({
              id: Type.String(),
              name: Type.String(),
              category: Type.String(),
              extensions: Type.Array(Type.String()),
              maxSize: Type.Number(),
              biosRequired: Type.Boolean(),
              description: Type.String(),
            })),
            uploadLimits: Type.Object({
              maxFileSize: Type.Number(),
              chunkSize: Type.Number(),
              timeout: Type.Number(),
            }),
            version: Type.String(),
          }),
        },
      },
    }, async (request, reply) => {
      const platformsData = [];
      
      for (const [category, platforms] of Object.entries(config.romFormats)) {
        for (const [platformId, platformConfig] of Object.entries(platforms)) {
          platformsData.push({
            id: platformId,
            name: platformConfig.description,
            category,
            extensions: platformConfig.extensions,
            maxSize: platformConfig.maxSize || config.upload.maxFileSize,
            biosRequired: platformConfig.biosRequired,
            description: platformConfig.description,
          });
        }
      }

      return {
        supportedPlatforms: platformsData,
        uploadLimits: {
          maxFileSize: config.upload.maxFileSize,
          chunkSize: config.upload.chunkSize,
          timeout: config.upload.timeout,
        },
        version: process.env.npm_package_version || '1.0.0',
      };
    });

    // Statistics endpoint
    server.get('/stats', {
      schema: {
        description: 'Get system statistics',
        tags: ['System'],
        response: {
          200: Type.Object({
            games: Type.Object({
              total: Type.Number(),
              byPlatform: Type.Record(Type.String(), Type.Number()),
              totalSize: Type.String(),
            }),
            uploads: Type.Object({
              active: Type.Number(),
              completed: Type.Number(),
              failed: Type.Number(),
            }),
            platforms: Type.Number(),
          }),
        },
      },
    }, async (request, reply) => {
      try {
        // Get game statistics
        const totalGames = await prisma.game.count();
        const gamesByPlatform = await prisma.game.groupBy({
          by: ['platformId'],
          _count: {
            id: true,
          },
        });

        const totalSizeResult = await prisma.game.aggregate({
          _sum: {
            fileSize: true,
          },
        });

        // Get upload statistics
        const uploadStats = await prisma.upload.groupBy({
          by: ['status'],
          _count: {
            id: true,
          },
        });

        // Get platform count
        const platformCount = await prisma.platform.count();

        const platformStats = gamesByPlatform.reduce((acc, item) => {
          acc[item.platformId] = item._count.id;
          return acc;
        }, {} as Record<string, number>);

        const uploadStatsFormatted = uploadStats.reduce((acc, item) => {
          acc[item.status.toLowerCase()] = item._count.id;
          return acc;
        }, {} as Record<string, number>);

        return {
          games: {
            total: totalGames,
            byPlatform: platformStats,
            totalSize: formatBytes(Number(totalSizeResult._sum.fileSize || 0)),
          },
          uploads: {
            active: uploadStatsFormatted.uploading || 0,
            completed: uploadStatsFormatted.completed || 0,
            failed: uploadStatsFormatted.failed || 0,
          },
          platforms: platformCount,
        };
      } catch (error) {
        server.log.error('Failed to get system stats:', error);
        reply.status(500);
        return {
          error: 'Internal Server Error',
          message: 'Failed to retrieve system statistics',
        };
      }
    });

    // Register feature routes
    await server.register(uploadRoutes, { prefix: '/upload' });
    await server.register(gameRoutes, { prefix: '/games' });
    await server.register(platformRoutes, { prefix: '/platforms' });

    // Search endpoint (cross-platform search)
    server.post('/search', {
      schema: {
        description: 'Search games across all platforms',
        tags: ['Search'],
        body: Type.Object({
          query: Type.String({ minLength: 1 }),
          platforms: Type.Optional(Type.Array(Type.String())),
          genres: Type.Optional(Type.Array(Type.String())),
          yearRange: Type.Optional(Type.Object({
            min: Type.Integer(),
            max: Type.Integer(),
          })),
          sortBy: Type.Optional(Type.String({ default: 'relevance' })),
          page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        }),
        response: {
          200: Type.Object({
            games: Type.Array(Type.Object({
              id: Type.String(),
              title: Type.String(),
              platform: Type.String(),
              genre: Type.Optional(Type.String()),
              year: Type.Optional(Type.Integer()),
              rating: Type.Optional(Type.Number()),
              boxArtUrl: Type.Optional(Type.String()),
              fileSize: Type.String(),
              relevanceScore: Type.Optional(Type.Number()),
            })),
            pagination: Type.Object({
              page: Type.Integer(),
              limit: Type.Integer(),
              total: Type.Integer(),
              totalPages: Type.Integer(),
            }),
            facets: Type.Object({
              platforms: Type.Array(Type.Object({
                id: Type.String(),
                name: Type.String(),
                count: Type.Integer(),
              })),
              genres: Type.Array(Type.Object({
                name: Type.String(),
                count: Type.Integer(),
              })),
              years: Type.Array(Type.Object({
                year: Type.Integer(),
                count: Type.Integer(),
              })),
            }),
          }),
        },
      },
    }, async (request, reply) => {
      const { query, platforms, genres, yearRange, sortBy, page, limit } = request.body;
      
      try {
        // Build search conditions
        const searchConditions: any = {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { alternativeTitles: { has: query } },
            { developer: { contains: query, mode: 'insensitive' } },
            { publisher: { contains: query, mode: 'insensitive' } },
          ],
        };

        if (platforms && platforms.length > 0) {
          searchConditions.platformId = { in: platforms };
        }

        if (genres && genres.length > 0) {
          searchConditions.genre = { in: genres };
        }

        if (yearRange) {
          searchConditions.releaseYear = {
            gte: yearRange.min,
            lte: yearRange.max,
          };
        }

        // Execute search
        const [games, totalCount] = await Promise.all([
          prisma.game.findMany({
            where: searchConditions,
            include: {
              platform: true,
            },
            orderBy: sortBy === 'relevance' 
              ? [{ title: 'asc' }] 
              : [{ [sortBy]: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.game.count({ where: searchConditions }),
        ]);

        // Get facets for filtering
        const [platformFacets, genreFacets, yearFacets] = await Promise.all([
          prisma.game.groupBy({
            by: ['platformId'],
            where: searchConditions,
            _count: { id: true },
          }),
          prisma.game.groupBy({
            by: ['genre'],
            where: searchConditions,
            _count: { id: true },
          }),
          prisma.game.groupBy({
            by: ['releaseYear'],
            where: searchConditions,
            _count: { id: true },
          }),
        ]);

        const platformInfo = await prisma.platform.findMany({
          where: { id: { in: platformFacets.map(p => p.platformId) } },
        });

        return {
          games: games.map(game => ({
            id: game.id,
            title: game.title,
            platform: game.platform?.name || game.platformId,
            genre: game.genre,
            year: game.releaseYear,
            rating: game.rating,
            boxArtUrl: game.boxArtUrl,
            fileSize: formatBytes(Number(game.fileSize)),
          })),
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
          facets: {
            platforms: platformFacets.map(pf => ({
              id: pf.platformId,
              name: platformInfo.find(p => p.id === pf.platformId)?.name || pf.platformId,
              count: pf._count.id,
            })),
            genres: genreFacets
              .filter(gf => gf.genre)
              .map(gf => ({
                name: gf.genre!,
                count: gf._count.id,
              })),
            years: yearFacets
              .filter(yf => yf.releaseYear)
              .map(yf => ({
                year: yf.releaseYear!,
                count: yf._count.id,
              }))
              .sort((a, b) => b.year - a.year),
          },
        };
      } catch (error) {
        server.log.error('Search failed:', error);
        reply.status(500);
        return {
          error: 'Internal Server Error',
          message: 'Search operation failed',
        };
      }
    });

  }, { prefix: '/api' });
}

// Utility function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export { ErrorSchema, PaginationSchema, SuccessSchema };