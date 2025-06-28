import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { formatFileSize } from '../utils/fileUtils';
import { logger } from '../utils/logger';

// Game-specific schemas
const GameSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  originalTitle: Type.Optional(Type.String()),
  alternativeTitles: Type.Array(Type.String()),
  fileName: Type.String(),
  filePath: Type.String(),
  fileSize: Type.String(),
  fileHash: Type.String(),
  fileExtension: Type.String(),
  platform: Type.Object({
    id: Type.String(),
    name: Type.String(),
    shortName: Type.String(),
  }),
  region: Type.Optional(Type.String()),
  language: Type.Optional(Type.String()),
  genre: Type.Optional(Type.String()),
  subGenre: Type.Optional(Type.String()),
  developer: Type.Optional(Type.String()),
  publisher: Type.Optional(Type.String()),
  releaseDate: Type.Optional(Type.String()),
  releaseYear: Type.Optional(Type.Integer()),
  rating: Type.Optional(Type.Number()),
  ratingCount: Type.Integer(),
  popularity: Type.Optional(Type.Number()),
  boxArtUrl: Type.Optional(Type.String()),
  screenshotUrls: Type.Array(Type.String()),
  videoUrl: Type.Optional(Type.String()),
  romVersion: Type.Optional(Type.String()),
  romChecksum: Type.Optional(Type.String()),
  headerInfo: Type.Optional(Type.Any()),
  players: Type.Optional(Type.Integer()),
  multiplayerType: Type.Optional(Type.String()),
  inputMethods: Type.Array(Type.String()),
  compatibleCores: Type.Array(Type.String()),
  emulationNotes: Type.Optional(Type.String()),
  isValidated: Type.Boolean(),
  validationError: Type.Optional(Type.String()),
  needsBios: Type.Boolean(),
  requiredBios: Type.Array(Type.String()),
  playCount: Type.Integer(),
  lastPlayed: Type.Optional(Type.String()),
  isFavorite: Type.Boolean(),
  userRating: Type.Optional(Type.Number()),
  userNotes: Type.Optional(Type.String()),
  isArchive: Type.Boolean(),
  archiveContents: Type.Array(Type.String()),
  extractedPath: Type.Optional(Type.String()),
  duplicateOf: Type.Optional(Type.String()),
  duplicates: Type.Array(Type.String()),
  igdbId: Type.Optional(Type.String()),
  thegamesdbId: Type.Optional(Type.String()),
  screenscrapeId: Type.Optional(Type.String()),
  mobygamesId: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const GameListSchema = Type.Object({
  games: Type.Array(GameSchema),
  pagination: Type.Object({
    page: Type.Integer(),
    limit: Type.Integer(),
    total: Type.Integer(),
    totalPages: Type.Integer(),
  }),
});

const GameUpdateSchema = Type.Object({
  title: Type.Optional(Type.String()),
  alternativeTitles: Type.Optional(Type.Array(Type.String())),
  genre: Type.Optional(Type.String()),
  subGenre: Type.Optional(Type.String()),
  developer: Type.Optional(Type.String()),
  publisher: Type.Optional(Type.String()),
  releaseDate: Type.Optional(Type.String()),
  releaseYear: Type.Optional(Type.Integer()),
  rating: Type.Optional(Type.Number()),
  players: Type.Optional(Type.Integer()),
  multiplayerType: Type.Optional(Type.String()),
  inputMethods: Type.Optional(Type.Array(Type.String())),
  emulationNotes: Type.Optional(Type.String()),
  isFavorite: Type.Optional(Type.Boolean()),
  userRating: Type.Optional(Type.Number()),
  userNotes: Type.Optional(Type.String()),
});

const GameStatsSchema = Type.Object({
  id: Type.String(),
  totalPlayTime: Type.Integer(),
  sessionCount: Type.Integer(),
  averageSession: Type.Integer(),
  averageFps: Type.Optional(Type.Number()),
  emulatorCore: Type.Optional(Type.String()),
  firstPlayed: Type.Optional(Type.String()),
  lastPlayed: Type.Optional(Type.String()),
});

export async function gameRoutes(server: FastifyInstance) {
  const prisma = new PrismaClient();

  /**
   * Get all games with pagination and filtering
   */
  server.get('/', {
    schema: {
      description: 'Get all games with pagination and filtering',
      tags: ['Games'],
      querystring: Type.Object({
        page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        platform: Type.Optional(Type.String()),
        genre: Type.Optional(Type.String()),
        developer: Type.Optional(Type.String()),
        publisher: Type.Optional(Type.String()),
        year: Type.Optional(Type.Integer()),
        rating: Type.Optional(Type.Number()),
        favorite: Type.Optional(Type.Boolean()),
        search: Type.Optional(Type.String()),
        sortBy: Type.Optional(Type.String({ default: 'title' })),
        sortOrder: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')], { default: 'asc' })),
      }),
      response: {
        200: GameListSchema,
      },
    },
  }, async (request, reply) => {
    const {
      page = 1,
      limit = 20,
      platform,
      genre,
      developer,
      publisher,
      year,
      rating,
      favorite,
      search,
      sortBy = 'title',
      sortOrder = 'asc',
    } = request.query as any;

    try {
      // Build where clause
      const where: any = {};

      if (platform) where.platformId = platform;
      if (genre) where.genre = { contains: genre, mode: 'insensitive' };
      if (developer) where.developer = { contains: developer, mode: 'insensitive' };
      if (publisher) where.publisher = { contains: publisher, mode: 'insensitive' };
      if (year) where.releaseYear = year;
      if (rating) where.rating = { gte: rating };
      if (favorite !== undefined) where.isFavorite = favorite;

      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { alternativeTitles: { has: search } },
          { developer: { contains: search, mode: 'insensitive' } },
          { publisher: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Build orderBy clause
      const orderBy: any = {};
      if (sortBy === 'fileSize') {
        orderBy[sortBy] = sortOrder;
      } else if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        orderBy[sortBy] = sortOrder;
      } else {
        orderBy[sortBy] = sortOrder;
      }

      // Execute queries
      const [games, total] = await Promise.all([
        prisma.game.findMany({
          where,
          include: {
            platform: true,
          },
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.game.count({ where }),
      ]);

      // Format response
      const formattedGames = games.map(game => ({
        id: game.id,
        title: game.title,
        originalTitle: game.originalTitle,
        alternativeTitles: game.alternativeTitles,
        fileName: game.fileName,
        filePath: game.filePath,
        fileSize: formatFileSize(Number(game.fileSize)),
        fileHash: game.fileHash,
        fileExtension: game.fileExtension,
        platform: {
          id: game.platform?.id || game.platformId,
          name: game.platform?.name || game.platformId,
          shortName: game.platform?.shortName || game.platformId,
        },
        region: game.region,
        language: game.language,
        genre: game.genre,
        subGenre: game.subGenre,
        developer: game.developer,
        publisher: game.publisher,
        releaseDate: game.releaseDate?.toISOString(),
        releaseYear: game.releaseYear,
        rating: game.rating,
        ratingCount: game.ratingCount,
        popularity: game.popularity,
        boxArtUrl: game.boxArtUrl,
        screenshotUrls: game.screenshotUrls,
        videoUrl: game.videoUrl,
        romVersion: game.romVersion,
        romChecksum: game.romChecksum,
        headerInfo: game.headerInfo,
        players: game.players,
        multiplayerType: game.multiplayerType,
        inputMethods: game.inputMethods,
        compatibleCores: game.compatibleCores,
        emulationNotes: game.emulationNotes,
        isValidated: game.isValidated,
        validationError: game.validationError,
        needsBios: game.needsBios,
        requiredBios: game.requiredBios,
        playCount: game.playCount,
        lastPlayed: game.lastPlayed?.toISOString(),
        isFavorite: game.isFavorite,
        userRating: game.userRating,
        userNotes: game.userNotes,
        isArchive: game.isArchive,
        archiveContents: game.archiveContents,
        extractedPath: game.extractedPath,
        duplicateOf: game.duplicateOf,
        duplicates: game.duplicates,
        igdbId: game.igdbId,
        thegamesdbId: game.thegamesdbId,
        screenscrapeId: game.screenscrapeId,
        mobygamesId: game.mobygamesId,
        createdAt: game.createdAt.toISOString(),
        updatedAt: game.updatedAt.toISOString(),
      }));

      return {
        games: formattedGames,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      server.log.error('Failed to get games:', error);
      reply.status(500);
      throw error;
    }
  });

  /**
   * Get a specific game by ID
   */
  server.get('/:id', {
    schema: {
      description: 'Get a specific game by ID',
      tags: ['Games'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: GameSchema,
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const game = await prisma.game.findUnique({
        where: { id },
        include: {
          platform: true,
          saveStates: true,
          gameStats: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!game) {
        reply.status(404);
        throw new Error('Game not found');
      }

      return {
        id: game.id,
        title: game.title,
        originalTitle: game.originalTitle,
        alternativeTitles: game.alternativeTitles,
        fileName: game.fileName,
        filePath: game.filePath,
        fileSize: formatFileSize(Number(game.fileSize)),
        fileHash: game.fileHash,
        fileExtension: game.fileExtension,
        platform: {
          id: game.platform?.id || game.platformId,
          name: game.platform?.name || game.platformId,
          shortName: game.platform?.shortName || game.platformId,
        },
        region: game.region,
        language: game.language,
        genre: game.genre,
        subGenre: game.subGenre,
        developer: game.developer,
        publisher: game.publisher,
        releaseDate: game.releaseDate?.toISOString(),
        releaseYear: game.releaseYear,
        rating: game.rating,
        ratingCount: game.ratingCount,
        popularity: game.popularity,
        boxArtUrl: game.boxArtUrl,
        screenshotUrls: game.screenshotUrls,
        videoUrl: game.videoUrl,
        romVersion: game.romVersion,
        romChecksum: game.romChecksum,
        headerInfo: game.headerInfo,
        players: game.players,
        multiplayerType: game.multiplayerType,
        inputMethods: game.inputMethods,
        compatibleCores: game.compatibleCores,
        emulationNotes: game.emulationNotes,
        isValidated: game.isValidated,
        validationError: game.validationError,
        needsBios: game.needsBios,
        requiredBios: game.requiredBios,
        playCount: game.playCount,
        lastPlayed: game.lastPlayed?.toISOString(),
        isFavorite: game.isFavorite,
        userRating: game.userRating,
        userNotes: game.userNotes,
        isArchive: game.isArchive,
        archiveContents: game.archiveContents,
        extractedPath: game.extractedPath,
        duplicateOf: game.duplicateOf,
        duplicates: game.duplicates,
        igdbId: game.igdbId,
        thegamesdbId: game.thegamesdbId,
        screenscrapeId: game.screenscrapeId,
        mobygamesId: game.mobygamesId,
        createdAt: game.createdAt.toISOString(),
        updatedAt: game.updatedAt.toISOString(),
      };
    } catch (error) {
      server.log.error(`Failed to get game ${id}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Update a game
   */
  server.put('/:id', {
    schema: {
      description: 'Update a game',
      tags: ['Games'],
      params: Type.Object({
        id: Type.String(),
      }),
      body: GameUpdateSchema,
      response: {
        200: GameSchema,
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const updates = request.body;

    try {
      // Check if game exists
      const existingGame = await prisma.game.findUnique({
        where: { id },
      });

      if (!existingGame) {
        reply.status(404);
        throw new Error('Game not found');
      }

      // Update the game
      const updatedGame = await prisma.game.update({
        where: { id },
        data: {
          ...updates,
          releaseDate: updates.releaseDate ? new Date(updates.releaseDate) : undefined,
          updatedAt: new Date(),
        },
        include: {
          platform: true,
        },
      });

      logger.info(`Game updated: ${updatedGame.title} (${id})`);

      return {
        id: updatedGame.id,
        title: updatedGame.title,
        originalTitle: updatedGame.originalTitle,
        alternativeTitles: updatedGame.alternativeTitles,
        fileName: updatedGame.fileName,
        filePath: updatedGame.filePath,
        fileSize: formatFileSize(Number(updatedGame.fileSize)),
        fileHash: updatedGame.fileHash,
        fileExtension: updatedGame.fileExtension,
        platform: {
          id: updatedGame.platform?.id || updatedGame.platformId,
          name: updatedGame.platform?.name || updatedGame.platformId,
          shortName: updatedGame.platform?.shortName || updatedGame.platformId,
        },
        region: updatedGame.region,
        language: updatedGame.language,
        genre: updatedGame.genre,
        subGenre: updatedGame.subGenre,
        developer: updatedGame.developer,
        publisher: updatedGame.publisher,
        releaseDate: updatedGame.releaseDate?.toISOString(),
        releaseYear: updatedGame.releaseYear,
        rating: updatedGame.rating,
        ratingCount: updatedGame.ratingCount,
        popularity: updatedGame.popularity,
        boxArtUrl: updatedGame.boxArtUrl,
        screenshotUrls: updatedGame.screenshotUrls,
        videoUrl: updatedGame.videoUrl,
        romVersion: updatedGame.romVersion,
        romChecksum: updatedGame.romChecksum,
        headerInfo: updatedGame.headerInfo,
        players: updatedGame.players,
        multiplayerType: updatedGame.multiplayerType,
        inputMethods: updatedGame.inputMethods,
        compatibleCores: updatedGame.compatibleCores,
        emulationNotes: updatedGame.emulationNotes,
        isValidated: updatedGame.isValidated,
        validationError: updatedGame.validationError,
        needsBios: updatedGame.needsBios,
        requiredBios: updatedGame.requiredBios,
        playCount: updatedGame.playCount,
        lastPlayed: updatedGame.lastPlayed?.toISOString(),
        isFavorite: updatedGame.isFavorite,
        userRating: updatedGame.userRating,
        userNotes: updatedGame.userNotes,
        isArchive: updatedGame.isArchive,
        archiveContents: updatedGame.archiveContents,
        extractedPath: updatedGame.extractedPath,
        duplicateOf: updatedGame.duplicateOf,
        duplicates: updatedGame.duplicates,
        igdbId: updatedGame.igdbId,
        thegamesdbId: updatedGame.thegamesdbId,
        screenscrapeId: updatedGame.screenscrapeId,
        mobygamesId: updatedGame.mobygamesId,
        createdAt: updatedGame.createdAt.toISOString(),
        updatedAt: updatedGame.updatedAt.toISOString(),
      };
    } catch (error) {
      server.log.error(`Failed to update game ${id}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Delete a game
   */
  server.delete('/:id', {
    schema: {
      description: 'Delete a game',
      tags: ['Games'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      // Check if game exists
      const existingGame = await prisma.game.findUnique({
        where: { id },
      });

      if (!existingGame) {
        reply.status(404);
        throw new Error('Game not found');
      }

      // Delete the game (cascade will handle related records)
      await prisma.game.delete({
        where: { id },
      });

      // Optionally delete the ROM file
      // await deleteFile(existingGame.filePath);

      logger.info(`Game deleted: ${existingGame.title} (${id})`);

      return {
        success: true,
        message: 'Game deleted successfully',
      };
    } catch (error) {
      server.log.error(`Failed to delete game ${id}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get game statistics
   */
  server.get('/:id/stats', {
    schema: {
      description: 'Get game statistics',
      tags: ['Games'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: GameStatsSchema,
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const game = await prisma.game.findUnique({
        where: { id },
        include: {
          gameStats: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!game) {
        reply.status(404);
        throw new Error('Game not found');
      }

      const stats = game.gameStats[0];

      return {
        id: game.id,
        totalPlayTime: stats?.totalPlayTime || 0,
        sessionCount: stats?.sessionCount || 0,
        averageSession: stats?.averageSession || 0,
        averageFps: stats?.averageFps,
        emulatorCore: stats?.emulatorCore,
        firstPlayed: stats?.firstPlayed?.toISOString(),
        lastPlayed: stats?.lastPlayed?.toISOString(),
      };
    } catch (error) {
      server.log.error(`Failed to get game stats ${id}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Record game play session
   */
  server.post('/:id/play', {
    schema: {
      description: 'Record a game play session',
      tags: ['Games'],
      params: Type.Object({
        id: Type.String(),
      }),
      body: Type.Object({
        sessionLength: Type.Integer({ minimum: 1 }), // in seconds
        emulatorCore: Type.Optional(Type.String()),
        averageFps: Type.Optional(Type.Number()),
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { sessionLength, emulatorCore, averageFps } = request.body;

    try {
      // Check if game exists
      const game = await prisma.game.findUnique({
        where: { id },
      });

      if (!game) {
        reply.status(404);
        throw new Error('Game not found');
      }

      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      // Update game play count and last played
      await prisma.game.update({
        where: { id },
        data: {
          playCount: { increment: 1 },
          lastPlayed: now,
          updatedAt: now,
        },
      });

      // Update or create game statistics
      await prisma.gameStats.upsert({
        where: {
          gameId_year_month: {
            gameId: id,
            year: currentYear,
            month: currentMonth,
          },
        },
        create: {
          gameId: id,
          year: currentYear,
          month: currentMonth,
          totalPlayTime: sessionLength,
          sessionCount: 1,
          averageSession: sessionLength,
          averageFps,
          emulatorCore,
          firstPlayed: now,
          lastPlayed: now,
          playTimeMonth: sessionLength,
          sessionsMonth: 1,
        },
        update: {
          totalPlayTime: { increment: sessionLength },
          sessionCount: { increment: 1 },
          averageFps: averageFps ? (averageFps + (game.gameStats?.[0]?.averageFps || 0)) / 2 : undefined,
          lastEmulatorCore: emulatorCore,
          lastPlayed: now,
          playTimeMonth: { increment: sessionLength },
          sessionsMonth: { increment: 1 },
          updatedAt: now,
        },
      });

      logger.info(`Play session recorded for game ${game.title}: ${sessionLength}s`);

      return {
        success: true,
        message: 'Play session recorded successfully',
      };
    } catch (error) {
      server.log.error(`Failed to record play session for game ${id}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Toggle favorite status
   */
  server.post('/:id/favorite', {
    schema: {
      description: 'Toggle game favorite status',
      tags: ['Games'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: Type.Object({
          success: Type.Boolean(),
          isFavorite: Type.Boolean(),
        }),
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const game = await prisma.game.findUnique({
        where: { id },
        select: { isFavorite: true, title: true },
      });

      if (!game) {
        reply.status(404);
        throw new Error('Game not found');
      }

      const newFavoriteStatus = !game.isFavorite;

      await prisma.game.update({
        where: { id },
        data: {
          isFavorite: newFavoriteStatus,
          updatedAt: new Date(),
        },
      });

      logger.info(`Game ${game.title} favorite status changed to: ${newFavoriteStatus}`);

      return {
        success: true,
        isFavorite: newFavoriteStatus,
      };
    } catch (error) {
      server.log.error(`Failed to toggle favorite for game ${id}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get game duplicates
   */
  server.get('/:id/duplicates', {
    schema: {
      description: 'Get game duplicates',
      tags: ['Games'],
      params: Type.Object({
        id: Type.String(),
      }),
      response: {
        200: Type.Object({
          duplicates: Type.Array(GameSchema),
        }),
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const game = await prisma.game.findUnique({
        where: { id },
        select: { fileHash: true, duplicates: true },
      });

      if (!game) {
        reply.status(404);
        throw new Error('Game not found');
      }

      // Find games with the same file hash
      const duplicates = await prisma.game.findMany({
        where: {
          fileHash: game.fileHash,
          id: { not: id },
        },
        include: {
          platform: true,
        },
      });

      const formattedDuplicates = duplicates.map(duplicate => ({
        id: duplicate.id,
        title: duplicate.title,
        originalTitle: duplicate.originalTitle,
        alternativeTitles: duplicate.alternativeTitles,
        fileName: duplicate.fileName,
        filePath: duplicate.filePath,
        fileSize: formatFileSize(Number(duplicate.fileSize)),
        fileHash: duplicate.fileHash,
        fileExtension: duplicate.fileExtension,
        platform: {
          id: duplicate.platform?.id || duplicate.platformId,
          name: duplicate.platform?.name || duplicate.platformId,
          shortName: duplicate.platform?.shortName || duplicate.platformId,
        },
        region: duplicate.region,
        language: duplicate.language,
        genre: duplicate.genre,
        subGenre: duplicate.subGenre,
        developer: duplicate.developer,
        publisher: duplicate.publisher,
        releaseDate: duplicate.releaseDate?.toISOString(),
        releaseYear: duplicate.releaseYear,
        rating: duplicate.rating,
        ratingCount: duplicate.ratingCount,
        popularity: duplicate.popularity,
        boxArtUrl: duplicate.boxArtUrl,
        screenshotUrls: duplicate.screenshotUrls,
        videoUrl: duplicate.videoUrl,
        romVersion: duplicate.romVersion,
        romChecksum: duplicate.romChecksum,
        headerInfo: duplicate.headerInfo,
        players: duplicate.players,
        multiplayerType: duplicate.multiplayerType,
        inputMethods: duplicate.inputMethods,
        compatibleCores: duplicate.compatibleCores,
        emulationNotes: duplicate.emulationNotes,
        isValidated: duplicate.isValidated,
        validationError: duplicate.validationError,
        needsBios: duplicate.needsBios,
        requiredBios: duplicate.requiredBios,
        playCount: duplicate.playCount,
        lastPlayed: duplicate.lastPlayed?.toISOString(),
        isFavorite: duplicate.isFavorite,
        userRating: duplicate.userRating,
        userNotes: duplicate.userNotes,
        isArchive: duplicate.isArchive,
        archiveContents: duplicate.archiveContents,
        extractedPath: duplicate.extractedPath,
        duplicateOf: duplicate.duplicateOf,
        duplicates: duplicate.duplicates,
        igdbId: duplicate.igdbId,
        thegamesdbId: duplicate.thegamesdbId,
        screenscrapeId: duplicate.screenscrapeId,
        mobygamesId: duplicate.mobygamesId,
        createdAt: duplicate.createdAt.toISOString(),
        updatedAt: duplicate.updatedAt.toISOString(),
      }));

      return {
        duplicates: formattedDuplicates,
      };
    } catch (error) {
      server.log.error(`Failed to get duplicates for game ${id}:`, error);
      
      if (error.message === 'Game not found') {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });
}

export { gameRoutes };