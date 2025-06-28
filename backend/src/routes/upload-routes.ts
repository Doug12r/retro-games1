import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@prisma/client';
import { UploadService } from '../services/upload';

// Upload-specific schemas
const UploadInitiateSchema = Type.Object({
  fileName: Type.String({ minLength: 1, maxLength: 255 }),
  fileSize: Type.Integer({ minimum: 1 }),
  fileHash: Type.String({ minLength: 32, maxLength: 64 }),
  chunkSize: Type.Integer({ minimum: 1024, maximum: 10 * 1024 * 1024 }), // 1KB to 10MB
  mimeType: Type.Optional(Type.String()),
});

const UploadResponseSchema = Type.Object({
  uploadId: Type.String(),
  fileName: Type.String(),
  fileSize: Type.Integer(),
  totalChunks: Type.Integer(),
  chunkSize: Type.Integer(),
  detectedPlatform: Type.Optional(Type.String()),
  status: Type.String(),
  expiresAt: Type.String(),
});

const UploadStatusSchema = Type.Object({
  uploadId: Type.String(),
  fileName: Type.String(),
  originalName: Type.String(),
  fileSize: Type.Integer(),
  totalChunks: Type.Integer(),
  uploadedChunks: Type.Integer(),
  progress: Type.Number(),
  status: Type.String(),
  detectedPlatform: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  expiresAt: Type.String(),
  processingStarted: Type.Optional(Type.String()),
  processingCompleted: Type.Optional(Type.String()),
  processingError: Type.Optional(Type.String()),
  chunks: Type.Array(Type.Object({
    chunkIndex: Type.Integer(),
    chunkSize: Type.Integer(),
    isUploaded: Type.Boolean(),
    uploadedAt: Type.Optional(Type.String()),
  })),
});

const ChunkUploadResponseSchema = Type.Object({
  success: Type.Boolean(),
  chunkIndex: Type.Integer(),
  isComplete: Type.Boolean(),
  message: Type.Optional(Type.String()),
});

export async function uploadRoutes(server: FastifyInstance) {
  const prisma = new PrismaClient();
  const uploadService = new UploadService(prisma);

  // Rate limiting for upload endpoints
  await server.register(import('@fastify/rate-limit'), {
    max: 100, // 100 requests per timeWindow
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  /**
   * Initiate a new chunked upload
   */
  server.post('/initiate', {
    schema: {
      description: 'Initiate a new chunked file upload',
      tags: ['Upload'],
      body: UploadInitiateSchema,
      response: {
        200: UploadResponseSchema,
        400: { $ref: 'ErrorSchema#' },
        409: { $ref: 'ErrorSchema#' }, // File already exists
        413: { $ref: 'ErrorSchema#' }, // File too large
      },
    },
    preHandler: async (request, reply) => {
      const { fileSize, fileName } = request.body as any;
      const maxSize = 4 * 1024 * 1024 * 1024; // 4GB

      if (fileSize > maxSize) {
        reply.status(413);
        throw new Error(`File size ${fileSize} exceeds maximum allowed size ${maxSize}`);
      }

      // Validate file extension
      const extension = fileName.split('.').pop()?.toLowerCase();
      if (!extension) {
        reply.status(400);
        throw new Error('File must have a valid extension');
      }
    },
  }, async (request, reply) => {
    try {
      const upload = await uploadService.initiateUpload(request.body);

      return {
        uploadId: upload.id,
        fileName: upload.fileName,
        fileSize: Number(upload.fileSize),
        totalChunks: upload.totalChunks,
        chunkSize: upload.chunkSize,
        detectedPlatform: upload.detectedPlatform,
        status: upload.status,
        expiresAt: upload.expiresAt.toISOString(),
      };
    } catch (error) {
      server.log.error('Upload initiation failed:', error);
      
      if (error.message.includes('already exists')) {
        reply.status(409);
      } else if (error.message.includes('Unsupported') || error.message.includes('exceeds')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Upload a single chunk
   */
  server.post('/chunk/:uploadId/:chunkIndex', {
    schema: {
      description: 'Upload a single file chunk',
      tags: ['Upload'],
      params: Type.Object({
        uploadId: Type.String(),
        chunkIndex: Type.Integer({ minimum: 0 }),
      }),
      response: {
        200: ChunkUploadResponseSchema,
        400: { $ref: 'ErrorSchema#' },
        404: { $ref: 'ErrorSchema#' },
        410: { $ref: 'ErrorSchema#' }, // Upload expired
      },
    },
    preHandler: async (request, reply) => {
      // Ensure this is a multipart request
      if (!request.isMultipart()) {
        reply.status(400);
        throw new Error('Request must be multipart/form-data');
      }
    },
  }, async (request, reply) => {
    const { uploadId, chunkIndex } = request.params;

    try {
      // Get the uploaded file data
      const data = await request.file();
      if (!data) {
        reply.status(400);
        throw new Error('No file data provided');
      }

      // Read the chunk data
      const chunkBuffer = await data.toBuffer();

      // Upload the chunk
      const result = await uploadService.uploadChunk(uploadId, chunkIndex, chunkBuffer);

      return {
        success: result.success,
        chunkIndex,
        isComplete: result.isComplete,
        message: result.isComplete ? 'Upload completed, processing started' : 'Chunk uploaded successfully',
      };

    } catch (error) {
      server.log.error(`Chunk upload failed for ${uploadId}:${chunkIndex}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else if (error.message.includes('expired')) {
        reply.status(410);
      } else if (error.message.includes('mismatch') || error.message.includes('already uploaded')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Get upload status
   */
  server.get('/status/:uploadId', {
    schema: {
      description: 'Get the status of an upload',
      tags: ['Upload'],
      params: Type.Object({
        uploadId: Type.String(),
      }),
      response: {
        200: UploadStatusSchema,
        404: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { uploadId } = request.params;

    try {
      const upload = await uploadService.getUploadStatus(uploadId);

      if (!upload) {
        reply.status(404);
        throw new Error('Upload not found');
      }

      return {
        uploadId: upload.id,
        fileName: upload.fileName,
        originalName: upload.originalName,
        fileSize: Number(upload.fileSize),
        totalChunks: upload.totalChunks,
        uploadedChunks: upload.uploadedChunks,
        progress: (upload.uploadedChunks / upload.totalChunks) * 100,
        status: upload.status,
        detectedPlatform: upload.detectedPlatform,
        createdAt: upload.createdAt.toISOString(),
        updatedAt: upload.updatedAt.toISOString(),
        expiresAt: upload.expiresAt.toISOString(),
        processingStarted: upload.processingStarted?.toISOString(),
        processingCompleted: upload.processingCompleted?.toISOString(),
        processingError: upload.processingError,
        chunks: upload.chunks.map(chunk => ({
          chunkIndex: chunk.chunkIndex,
          chunkSize: chunk.chunkSize,
          isUploaded: chunk.isUploaded,
          uploadedAt: chunk.uploadedAt?.toISOString(),
        })),
      };

    } catch (error) {
      server.log.error(`Failed to get upload status for ${uploadId}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Cancel an upload
   */
  server.delete('/cancel/:uploadId', {
    schema: {
      description: 'Cancel an active upload',
      tags: ['Upload'],
      params: Type.Object({
        uploadId: Type.String(),
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' },
        400: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { uploadId } = request.params;

    try {
      await uploadService.cancelUpload(uploadId);

      return {
        success: true,
        message: 'Upload cancelled successfully',
      };

    } catch (error) {
      server.log.error(`Failed to cancel upload ${uploadId}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else if (error.message.includes('Cannot cancel')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * Complete an upload (alternative to automatic processing)
   */
  server.post('/complete/:uploadId', {
    schema: {
      description: 'Manually trigger upload completion and processing',
      tags: ['Upload'],
      params: Type.Object({
        uploadId: Type.String(),
      }),
      response: {
        200: { $ref: 'SuccessSchema#' },
        404: { $ref: 'ErrorSchema#' },
        400: { $ref: 'ErrorSchema#' },
      },
    },
  }, async (request, reply) => {
    const { uploadId } = request.params;

    try {
      const upload = await uploadService.getUploadStatus(uploadId);

      if (!upload) {
        reply.status(404);
        throw new Error('Upload not found');
      }

      if (upload.uploadedChunks !== upload.totalChunks) {
        reply.status(400);
        throw new Error('Upload is not complete - missing chunks');
      }

      if (upload.status === 'COMPLETED') {
        reply.status(400);
        throw new Error('Upload already completed');
      }

      // Trigger processing
      setImmediate(() => uploadService.processUpload(uploadId));

      return {
        success: true,
        message: 'Upload processing started',
      };

    } catch (error) {
      server.log.error(`Failed to complete upload ${uploadId}:`, error);
      
      if (error.message.includes('not found')) {
        reply.status(404);
      } else if (error.message.includes('not complete') || error.message.includes('already completed')) {
        reply.status(400);
      } else {
        reply.status(500);
      }
      
      throw error;
    }
  });

  /**
   * List active uploads
   */
  server.get('/list', {
    schema: {
      description: 'List all active uploads',
      tags: ['Upload'],
      querystring: Type.Object({
        status: Type.Optional(Type.String()),
        page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
      }),
      response: {
        200: Type.Object({
          uploads: Type.Array(UploadStatusSchema),
          pagination: Type.Object({
            page: Type.Integer(),
            limit: Type.Integer(),
            total: Type.Integer(),
            totalPages: Type.Integer(),
          }),
        }),
      },
    },
  }, async (request, reply) => {
    const { status, page = 1, limit = 20 } = request.query as any;

    try {
      const where = status ? { status } : {};
      
      const [uploads, total] = await Promise.all([
        prisma.upload.findMany({
          where,
          include: { chunks: true },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.upload.count({ where }),
      ]);

      return {
        uploads: uploads.map(upload => ({
          uploadId: upload.id,
          fileName: upload.fileName,
          originalName: upload.originalName,
          fileSize: Number(upload.fileSize),
          totalChunks: upload.totalChunks,
          uploadedChunks: upload.uploadedChunks,
          progress: (upload.uploadedChunks / upload.totalChunks) * 100,
          status: upload.status,
          detectedPlatform: upload.detectedPlatform,
          createdAt: upload.createdAt.toISOString(),
          updatedAt: upload.updatedAt.toISOString(),
          expiresAt: upload.expiresAt.toISOString(),
          processingStarted: upload.processingStarted?.toISOString(),
          processingCompleted: upload.processingCompleted?.toISOString(),
          processingError: upload.processingError,
          chunks: upload.chunks.map(chunk => ({
            chunkIndex: chunk.chunkIndex,
            chunkSize: chunk.chunkSize,
            isUploaded: chunk.isUploaded,
            uploadedAt: chunk.uploadedAt?.toISOString(),
          })),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };

    } catch (error) {
      server.log.error('Failed to list uploads:', error);
      reply.status(500);
      throw error;
    }
  });

  /**
   * Cleanup expired uploads manually
   */
  server.post('/cleanup', {
    schema: {
      description: 'Manually trigger cleanup of expired uploads',
      tags: ['Upload'],
      response: {
        200: { $ref: 'SuccessSchema#' },
      },
    },
  }, async (request, reply) => {
    try {
      await uploadService.cleanupExpiredUploads();

      return {
        success: true,
        message: 'Cleanup completed successfully',
      };

    } catch (error) {
      server.log.error('Manual cleanup failed:', error);
      reply.status(500);
      throw error;
    }
  });
}

export { uploadRoutes };