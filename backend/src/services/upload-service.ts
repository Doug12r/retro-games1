import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { PrismaClient, Upload, UploadStatus } from '@prisma/client';
import { config, getPlatformByExtension, getPlatformConfig, getMaxFileSize } from '../config';
import { logger } from '../utils/logger';
import { validateFileSignature, calculateFileHash } from '../utils/fileUtils';
import { broadcastUploadProgress } from './websocket';
import { processRomFile } from './romProcessor';

export interface ChunkUploadRequest {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  fileName: string;
  fileSize: number;
  fileHash?: string;
}

export interface UploadInitiateRequest {
  fileName: string;
  fileSize: number;
  fileHash: string;
  chunkSize: number;
  mimeType?: string;
}

export interface UploadProgressUpdate {
  uploadId: string;
  fileName: string;
  progress: number;
  uploadedChunks: number;
  totalChunks: number;
  status: UploadStatus;
  speed?: number;
  eta?: number;
  error?: string;
}

export class UploadService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Initiate a new chunked upload
   */
  async initiateUpload(request: UploadInitiateRequest): Promise<Upload> {
    const { fileName, fileSize, fileHash, chunkSize, mimeType } = request;

    // Validate file extension
    const extension = path.extname(fileName).toLowerCase();
    const detectedPlatform = getPlatformByExtension(extension);
    
    if (!detectedPlatform) {
      throw new Error(`Unsupported file format: ${extension}`);
    }

    // Validate file size
    const maxSize = getMaxFileSize(detectedPlatform);
    if (fileSize > maxSize) {
      throw new Error(`File size ${fileSize} exceeds maximum allowed size ${maxSize} for platform ${detectedPlatform}`);
    }

    // Check for existing upload with same hash
    const existingUpload = await this.prisma.upload.findFirst({
      where: {
        fileHash,
        status: {
          in: [UploadStatus.COMPLETED]
        }
      }
    });

    if (existingUpload) {
      throw new Error('File already exists in the system');
    }

    // Calculate total chunks
    const totalChunks = Math.ceil(fileSize / chunkSize);

    // Create upload record
    const upload = await this.prisma.upload.create({
      data: {
        fileName: this.sanitizeFileName(fileName),
        originalName: fileName,
        fileSize,
        fileHash,
        mimeType,
        totalChunks,
        chunkSize,
        detectedPlatform,
        platformId: detectedPlatform,
        tempPath: path.join(config.storage.tempDir, `${crypto.randomUUID()}-${fileName}`),
        status: UploadStatus.INITIATED,
        expiresAt: new Date(Date.now() + config.upload.timeout * 1000),
      },
      include: {
        chunks: true,
        platform: true
      }
    });

    // Create chunk records
    const chunkPromises = Array.from({ length: totalChunks }, (_, index) => 
      this.prisma.uploadChunk.create({
        data: {
          uploadId: upload.id,
          chunkIndex: index,
          chunkSize: index === totalChunks - 1 
            ? fileSize - (index * chunkSize) // Last chunk may be smaller
            : chunkSize,
          chunkHash: '',
          chunkPath: path.join(config.storage.tempDir, `${upload.id}-chunk-${index}`),
        }
      })
    );

    await Promise.all(chunkPromises);

    logger.info(`Upload initiated: ${upload.id} for file ${fileName}`);
    
    // Broadcast initial progress
    await this.broadcastProgress(upload.id);

    return upload;
  }

  /**
   * Upload a single chunk
   */
  async uploadChunk(
    uploadId: string,
    chunkIndex: number,
    chunkBuffer: Buffer
  ): Promise<{ success: boolean; isComplete: boolean }> {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
      include: { chunks: true }
    });

    if (!upload) {
      throw new Error('Upload not found');
    }

    if (upload.status === UploadStatus.EXPIRED || upload.expiresAt < new Date()) {
      throw new Error('Upload has expired');
    }

    if (upload.status === UploadStatus.CANCELLED) {
      throw new Error('Upload has been cancelled');
    }

    // Find the chunk record
    const chunk = upload.chunks.find(c => c.chunkIndex === chunkIndex);
    if (!chunk) {
      throw new Error(`Chunk ${chunkIndex} not found`);
    }

    if (chunk.isUploaded) {
      logger.warn(`Chunk ${chunkIndex} already uploaded for upload ${uploadId}`);
      return { success: true, isComplete: await this.checkUploadComplete(uploadId) };
    }

    // Validate chunk size
    if (chunkBuffer.length !== chunk.chunkSize) {
      throw new Error(`Chunk size mismatch. Expected ${chunk.chunkSize}, got ${chunkBuffer.length}`);
    }

    // Calculate and verify chunk hash
    const chunkHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');

    try {
      // Ensure temp directory exists
      await fs.mkdir(path.dirname(chunk.chunkPath), { recursive: true });

      // Write chunk to temporary file
      await fs.writeFile(chunk.chunkPath, chunkBuffer);

      // Update chunk record
      await this.prisma.uploadChunk.update({
        where: { id: chunk.id },
        data: {
          isUploaded: true,
          chunkHash,
          uploadedAt: new Date(),
        }
      });

      // Update upload progress
      const uploadedChunks = upload.uploadedChunks + 1;
      await this.prisma.upload.update({
        where: { id: uploadId },
        data: {
          uploadedChunks,
          status: uploadedChunks === upload.totalChunks 
            ? UploadStatus.PROCESSING 
            : UploadStatus.UPLOADING,
          updatedAt: new Date(),
        }
      });

      logger.info(`Chunk ${chunkIndex}/${upload.totalChunks} uploaded for ${uploadId}`);

      // Broadcast progress update
      await this.broadcastProgress(uploadId);

      const isComplete = uploadedChunks === upload.totalChunks;

      // If all chunks uploaded, start processing
      if (isComplete) {
        setImmediate(() => this.processUpload(uploadId));
      }

      return { success: true, isComplete };

    } catch (error) {
      logger.error(`Failed to upload chunk ${chunkIndex} for ${uploadId}:`, error);
      throw error;
    }
  }

  /**
   * Process completed upload - assemble chunks and validate
   */
  async processUpload(uploadId: string): Promise<void> {
    try {
      const upload = await this.prisma.upload.findUnique({
        where: { id: uploadId },
        include: { chunks: { orderBy: { chunkIndex: 'asc' } }, platform: true }
      });

      if (!upload) {
        throw new Error('Upload not found');
      }

      logger.info(`Processing upload ${uploadId}: ${upload.fileName}`);

      // Update status to processing
      await this.prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: UploadStatus.PROCESSING,
          processingStarted: new Date(),
        }
      });

      await this.broadcastProgress(uploadId);

      // Assemble chunks into final file
      const finalPath = await this.assembleChunks(upload);

      // Validate assembled file
      await this.validateAssembledFile(upload, finalPath);

      // Process ROM file (extract metadata, validate format, etc.)
      const gameData = await processRomFile(finalPath, upload);

      // Move file to final location
      const finalStoragePath = this.generateFinalPath(upload, gameData);
      await fs.mkdir(path.dirname(finalStoragePath), { recursive: true });
      await fs.rename(finalPath, finalStoragePath);

      // Update upload record
      await this.prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: UploadStatus.COMPLETED,
          finalPath: finalStoragePath,
          processingCompleted: new Date(),
          isValidated: true,
          extractedMetadata: gameData as any,
        }
      });

      // Clean up temporary files
      await this.cleanupTempFiles(upload);

      logger.info(`Upload ${uploadId} processed successfully`);
      await this.broadcastProgress(uploadId);

    } catch (error) {
      logger.error(`Failed to process upload ${uploadId}:`, error);

      await this.prisma.upload.update({
        where: { id: uploadId },
        data: {
          status: UploadStatus.FAILED,
          processingError: error.message,
        }
      });

      await this.broadcastProgress(uploadId);
      throw error;
    }
  }

  /**
   * Assemble chunks into final file
   */
  private async assembleChunks(upload: Upload & { chunks: any[] }): Promise<string> {
    const assembledPath = `${upload.tempPath}.assembled`;
    const writeStream = createWriteStream(assembledPath);

    try {
      for (const chunk of upload.chunks) {
        if (!chunk.isUploaded) {
          throw new Error(`Chunk ${chunk.chunkIndex} not uploaded`);
        }

        const readStream = createReadStream(chunk.chunkPath);
        await pipeline(readStream, writeStream, { end: false });
      }

      writeStream.end();
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      return assembledPath;

    } catch (error) {
      writeStream.destroy();
      throw error;
    }
  }

  /**
   * Validate assembled file integrity
   */
  private async validateAssembledFile(upload: Upload, filePath: string): Promise<void> {
    // Check file size
    const stats = await fs.stat(filePath);
    if (stats.size !== Number(upload.fileSize)) {
      throw new Error(`File size mismatch. Expected ${upload.fileSize}, got ${stats.size}`);
    }

    // Verify file hash
    if (upload.fileHash) {
      const actualHash = await calculateFileHash(filePath);
      if (actualHash !== upload.fileHash) {
        throw new Error(`File hash mismatch. Expected ${upload.fileHash}, got ${actualHash}`);
      }
    }

    // Validate file signature
    const isValidSignature = await validateFileSignature(filePath, upload.fileName);
    if (!isValidSignature) {
      logger.warn(`File signature validation failed for ${upload.fileName}`);
    }

    logger.info(`File validation completed for ${upload.fileName}`);
  }

  /**
   * Generate final storage path for processed ROM
   */
  private generateFinalPath(upload: Upload, gameData: any): string {
    const platform = upload.detectedPlatform || 'unknown';
    const sanitizedTitle = this.sanitizeFileName(gameData?.title || upload.fileName);
    const extension = path.extname(upload.fileName);
    
    return path.join(
      config.storage.romDir,
      platform,
      `${sanitizedTitle}${extension}`
    );
  }

  /**
   * Clean up temporary files
   */
  private async cleanupTempFiles(upload: Upload & { chunks: any[] }): Promise<void> {
    const filesToDelete = [
      upload.tempPath,
      `${upload.tempPath}.assembled`,
      ...upload.chunks.map(chunk => chunk.chunkPath)
    ];

    await Promise.allSettled(
      filesToDelete.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // Ignore file not found errors
          if (error.code !== 'ENOENT') {
            logger.warn(`Failed to delete temp file ${filePath}:`, error);
          }
        }
      })
    );
  }

  /**
   * Cancel an upload
   */
  async cancelUpload(uploadId: string): Promise<void> {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
      include: { chunks: true }
    });

    if (!upload) {
      throw new Error('Upload not found');
    }

    if (upload.status === UploadStatus.COMPLETED) {
      throw new Error('Cannot cancel completed upload');
    }

    // Update status
    await this.prisma.upload.update({
      where: { id: uploadId },
      data: { status: UploadStatus.CANCELLED }
    });

    // Clean up temporary files
    await this.cleanupTempFiles(upload);

    logger.info(`Upload ${uploadId} cancelled`);
    await this.broadcastProgress(uploadId);
  }

  /**
   * Get upload status
   */
  async getUploadStatus(uploadId: string): Promise<Upload | null> {
    return this.prisma.upload.findUnique({
      where: { id: uploadId },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' }
        },
        platform: true
      }
    });
  }

  /**
   * Check if upload is complete
   */
  private async checkUploadComplete(uploadId: string): Promise<boolean> {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
      select: { uploadedChunks: true, totalChunks: true }
    });

    return upload ? upload.uploadedChunks >= upload.totalChunks : false;
  }

  /**
   * Broadcast upload progress via WebSocket
   */
  private async broadcastProgress(uploadId: string): Promise<void> {
    const upload = await this.getUploadStatus(uploadId);
    if (!upload) return;

    const progressUpdate: UploadProgressUpdate = {
      uploadId: upload.id,
      fileName: upload.fileName,
      progress: (upload.uploadedChunks / upload.totalChunks) * 100,
      uploadedChunks: upload.uploadedChunks,
      totalChunks: upload.totalChunks,
      status: upload.status,
    };

    // Calculate speed and ETA if uploading
    if (upload.status === UploadStatus.UPLOADING && upload.uploadedChunks > 0) {
      const elapsedTime = (Date.now() - upload.createdAt.getTime()) / 1000;
      const uploadedBytes = upload.uploadedChunks * upload.chunkSize;
      progressUpdate.speed = uploadedBytes / elapsedTime;
      
      const remainingBytes = Number(upload.fileSize) - uploadedBytes;
      progressUpdate.eta = remainingBytes / progressUpdate.speed;
    }

    await broadcastUploadProgress(progressUpdate);
  }

  /**
   * Sanitize filename for safe storage
   */
  private sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .trim();
  }

  /**
   * Clean up expired uploads
   */
  async cleanupExpiredUploads(): Promise<void> {
    const expiredUploads = await this.prisma.upload.findMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { 
            status: { in: [UploadStatus.FAILED, UploadStatus.CANCELLED] },
            updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // 24 hours ago
          }
        ]
      },
      include: { chunks: true }
    });

    for (const upload of expiredUploads) {
      try {
        await this.cleanupTempFiles(upload);
        await this.prisma.upload.delete({ where: { id: upload.id } });
        logger.info(`Cleaned up expired upload: ${upload.id}`);
      } catch (error) {
        logger.error(`Failed to cleanup upload ${upload.id}:`, error);
      }
    }

    if (expiredUploads.length > 0) {
      logger.info(`Cleaned up ${expiredUploads.length} expired uploads`);
    }
  }
}

export default UploadService;