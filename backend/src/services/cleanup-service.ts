import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../config';
import { cleanupOldFiles, getDirectorySize, deleteDirectory } from '../utils/fileUtils';
import { UploadService } from './upload';
import { RomProcessingService } from './romProcessor';

export class CleanupService {
  private prisma: PrismaClient;
  private uploadService: UploadService;
  private romProcessor: RomProcessingService;
  private jobs: cron.ScheduledTask[] = [];

  constructor() {
    this.prisma = new PrismaClient();
    this.uploadService = new UploadService(this.prisma);
    this.romProcessor = new RomProcessingService();
  }

  /**
   * Start all cleanup jobs
   */
  start(): void {
    logger.info('Starting cleanup service...');

    // Clean up expired uploads every 15 minutes
    this.jobs.push(
      cron.schedule('*/15 * * * *', () => {
        this.cleanupExpiredUploads().catch(error => {
          logger.error('Expired uploads cleanup failed:', error);
        });
      }, { scheduled: false })
    );

    // Clean up temporary files every hour
    this.jobs.push(
      cron.schedule('0 * * * *', () => {
        this.cleanupTemporaryFiles().catch(error => {
          logger.error('Temporary files cleanup failed:', error);
        });
      }, { scheduled: false })
    );

    // Clean up old log files daily at 2 AM
    this.jobs.push(
      cron.schedule('0 2 * * *', () => {
        this.cleanupLogFiles().catch(error => {
          logger.error('Log files cleanup failed:', error);
        });
      }, { scheduled: false })
    );

    // Database maintenance weekly on Sunday at 3 AM
    this.jobs.push(
      cron.schedule('0 3 * * 0', () => {
        this.performDatabaseMaintenance().catch(error => {
          logger.error('Database maintenance failed:', error);
        });
      }, { scheduled: false })
    );

    // Monitor disk space every 6 hours
    this.jobs.push(
      cron.schedule('0 */6 * * *', () => {
        this.monitorDiskSpace().catch(error => {
          logger.error('Disk space monitoring failed:', error);
        });
      }, { scheduled: false })
    );

    // Generate system reports weekly on Monday at 9 AM
    this.jobs.push(
      cron.schedule('0 9 * * 1', () => {
        this.generateSystemReport().catch(error => {
          logger.error('System report generation failed:', error);
        });
      }, { scheduled: false })
    );

    // Start all jobs
    this.jobs.forEach(job => job.start());
    logger.info(`Started ${this.jobs.length} cleanup jobs`);
  }

  /**
   * Stop all cleanup jobs
   */
  stop(): void {
    logger.info('Stopping cleanup service...');
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    logger.info('Cleanup service stopped');
  }

  /**
   * Clean up expired uploads
   */
  async cleanupExpiredUploads(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting expired uploads cleanup...');

    try {
      await this.uploadService.cleanupExpiredUploads();
      
      const duration = Date.now() - startTime;
      logger.info(`Expired uploads cleanup completed in ${duration}ms`);
    } catch (error) {
      logger.error('Failed to cleanup expired uploads:', error);
      throw error;
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanupTemporaryFiles(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting temporary files cleanup...');

    try {
      let totalCleaned = 0;

      // Clean up temp directory (files older than 24 hours)
      const tempCleaned = await cleanupOldFiles(config.storage.tempDir, 24 * 60 * 60 * 1000);
      totalCleaned += tempCleaned;

      // Clean up ROM extraction directories
      await this.romProcessor.cleanup();

      // Clean up orphaned chunk files
      const chunksCleaned = await this.cleanupOrphanedChunks();
      totalCleaned += chunksCleaned;

      const duration = Date.now() - startTime;
      logger.info(`Temporary files cleanup completed in ${duration}ms, cleaned ${totalCleaned} files`);
    } catch (error) {
      logger.error('Failed to cleanup temporary files:', error);
      throw error;
    }
  }

  /**
   * Clean up orphaned chunk files
   */
  private async cleanupOrphanedChunks(): Promise<number> {
    try {
      // Get all upload IDs that are still active
      const activeUploads = await this.prisma.upload.findMany({
        where: {
          status: {
            in: ['INITIATED', 'UPLOADING', 'PROCESSING']
          }
        },
        select: { id: true }
      });

      const activeUploadIds = new Set(activeUploads.map(u => u.id));

      // Find chunk files in temp directory
      const fs = require('fs').promises;
      const tempFiles = await fs.readdir(config.storage.tempDir);
      const chunkFiles = tempFiles.filter(file => file.includes('-chunk-'));

      let cleanedCount = 0;

      for (const chunkFile of chunkFiles) {
        const uploadId = chunkFile.split('-chunk-')[0];
        
        if (!activeUploadIds.has(uploadId)) {
          // Orphaned chunk file
          const chunkPath = require('path').join(config.storage.tempDir, chunkFile);
          await fs.unlink(chunkPath).catch(() => {}); // Ignore errors
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} orphaned chunk files`);
      }

      return cleanedCount;
    } catch (error) {
      logger.error('Failed to cleanup orphaned chunks:', error);
      return 0;
    }
  }

  /**
   * Clean up old log files
   */
  async cleanupLogFiles(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting log files cleanup...');

    try {
      const logsDir = require('path').join(process.cwd(), 'logs');
      
      // Keep logs for 30 days
      const maxAge = 30 * 24 * 60 * 60 * 1000;
      const cleanedCount = await cleanupOldFiles(logsDir, maxAge);

      const duration = Date.now() - startTime;
      logger.info(`Log files cleanup completed in ${duration}ms, cleaned ${cleanedCount} files`);
    } catch (error) {
      logger.error('Failed to cleanup log files:', error);
      throw error;
    }
  }

  /**
   * Perform database maintenance
   */
  async performDatabaseMaintenance(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting database maintenance...');

    try {
      // Clean up old game statistics (keep 1 year)
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const deletedStats = await this.prisma.gameStats.deleteMany({
        where: {
          createdAt: {
            lt: oneYearAgo
          }
        }
      });

      logger.info(`Deleted ${deletedStats.count} old game statistics records`);

      // Clean up old upload records (completed/failed older than 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const deletedUploads = await this.prisma.upload.deleteMany({
        where: {
          status: {
            in: ['COMPLETED', 'FAILED', 'CANCELLED']
          },
          updatedAt: {
            lt: sevenDaysAgo
          }
        }
      });

      logger.info(`Deleted ${deletedUploads.count} old upload records`);

      // Update database statistics
      await this.prisma.$executeRaw`ANALYZE`;

      const duration = Date.now() - startTime;
      logger.info(`Database maintenance completed in ${duration}ms`);
    } catch (error) {
      logger.error('Failed to perform database maintenance:', error);
      throw error;
    }
  }

  /**
   * Monitor disk space
   */
  async monitorDiskSpace(): Promise<void> {
    logger.info('Monitoring disk space...');

    try {
      const storageStats = await this.getStorageStatistics();
      
      // Check if any storage location is above 80% full
      const warnings: string[] = [];
      
      Object.entries(storageStats).forEach(([location, stats]) => {
        const usagePercent = (stats.used / stats.total) * 100;
        
        if (usagePercent > 90) {
          warnings.push(`${location} is ${usagePercent.toFixed(1)}% full (${this.formatBytes(stats.used)}/${this.formatBytes(stats.total)})`);
        } else if (usagePercent > 80) {
          logger.warn(`${location} is ${usagePercent.toFixed(1)}% full`);
        }
      });

      if (warnings.length > 0) {
        logger.error('Disk space warnings:', warnings);
        // Here you could send alerts to administrators
      }

      logger.info('Disk space monitoring completed', storageStats);
    } catch (error) {
      logger.error('Failed to monitor disk space:', error);
      throw error;
    }
  }

  /**
   * Get storage statistics
   */
  private async getStorageStatistics(): Promise<Record<string, { used: number; total: number }>> {
    const statvfs = require('statvfs');
    const { promisify } = require('util');
    const statvfsAsync = promisify(statvfs);

    const stats: Record<string, { used: number; total: number }> = {};

    try {
      // Get filesystem stats for each storage directory
      const locations = {
        'ROM Storage': config.storage.romDir,
        'Upload Storage': config.storage.uploadDir,
        'Media Storage': config.storage.mediaDir,
        'Temp Storage': config.storage.tempDir,
      };

      for (const [name, path] of Object.entries(locations)) {
        try {
          const fsStats = await statvfsAsync(path);
          const total = fsStats.blocks * fsStats.bsize;
          const free = fsStats.bavail * fsStats.bsize;
          const used = total - free;

          stats[name] = { used, total };
        } catch (error) {
          logger.warn(`Failed to get stats for ${name} (${path}):`, error.message);
        }
      }

      // Get directory sizes
      const directorySizes = {
        'ROMs': await getDirectorySize(config.storage.romDir),
        'Uploads': await getDirectorySize(config.storage.uploadDir),
        'Media': await getDirectorySize(config.storage.mediaDir),
        'Temp': await getDirectorySize(config.storage.tempDir),
      };

      // Add directory sizes to stats
      Object.entries(directorySizes).forEach(([name, size]) => {
        stats[`${name} Directory`] = { used: size, total: size };
      });

    } catch (error) {
      logger.error('Failed to get storage statistics:', error);
    }

    return stats;
  }

  /**
   * Generate system report
   */
  async generateSystemReport(): Promise<void> {
    logger.info('Generating system report...');

    try {
      const report = {
        timestamp: new Date().toISOString(),
        system: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
        },
        database: await this.getDatabaseStatistics(),
        storage: await this.getStorageStatistics(),
        uploads: await this.getUploadStatistics(),
        games: await this.getGameStatistics(),
      };

      // Log the report
      logger.info('Weekly system report:', report);

      // Save report to file
      const fs = require('fs').promises;
      const reportPath = require('path').join(process.cwd(), 'reports', `system-report-${Date.now()}.json`);
      await fs.mkdir(require('path').dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

      logger.info(`System report saved to: ${reportPath}`);
    } catch (error) {
      logger.error('Failed to generate system report:', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  private async getDatabaseStatistics(): Promise<any> {
    try {
      const [gameCount, uploadCount, platformCount] = await Promise.all([
        this.prisma.game.count(),
        this.prisma.upload.count(),
        this.prisma.platform.count(),
      ]);

      const uploadsByStatus = await this.prisma.upload.groupBy({
        by: ['status'],
        _count: { id: true },
      });

      const gamesByPlatform = await this.prisma.game.groupBy({
        by: ['platformId'],
        _count: { id: true },
      });

      return {
        totalGames: gameCount,
        totalUploads: uploadCount,
        totalPlatforms: platformCount,
        uploadsByStatus: uploadsByStatus.reduce((acc, item) => {
          acc[item.status] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
        gamesByPlatform: gamesByPlatform.reduce((acc, item) => {
          acc[item.platformId] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
      };
    } catch (error) {
      logger.error('Failed to get database statistics:', error);
      return {};
    }
  }

  /**
   * Get upload statistics
   */
  private async getUploadStatistics(): Promise<any> {
    try {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [recent, weekly] = await Promise.all([
        this.prisma.upload.count({
          where: { createdAt: { gte: last24Hours } }
        }),
        this.prisma.upload.count({
          where: { createdAt: { gte: lastWeek } }
        }),
      ]);

      return {
        uploadsLast24Hours: recent,
        uploadsLastWeek: weekly,
      };
    } catch (error) {
      logger.error('Failed to get upload statistics:', error);
      return {};
    }
  }

  /**
   * Get game statistics
   */
  private async getGameStatistics(): Promise<any> {
    try {
      const totalSize = await this.prisma.game.aggregate({
        _sum: { fileSize: true },
      });

      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentGames = await this.prisma.game.count({
        where: { createdAt: { gte: last24Hours } }
      });

      return {
        totalFileSize: Number(totalSize._sum.fileSize || 0),
        gamesAddedLast24Hours: recentGames,
      };
    } catch (error) {
      logger.error('Failed to get game statistics:', error);
      return {};
    }
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Manual cleanup trigger
   */
  async runManualCleanup(): Promise<void> {
    logger.info('Running manual cleanup...');

    await Promise.all([
      this.cleanupExpiredUploads(),
      this.cleanupTemporaryFiles(),
      this.performDatabaseMaintenance(),
    ]);

    logger.info('Manual cleanup completed');
  }
}

// Create and export the cleanup job singleton
export const uploadCleanupJob = new CleanupService();

export default CleanupService;