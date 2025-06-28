import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createReadStream } from 'fs';
import { Upload } from '@prisma/client';
import { config, getPlatformConfig } from '../config';
import { logger } from '../utils/logger';
import { extractArchive, isArchiveFile } from '../utils/archiveUtils';
import { calculateFileHash, validateFileSignature } from '../utils/fileUtils';
import { MetadataScrapingService } from './metadataScraper';

export interface RomHeader {
  title?: string;
  region?: string;
  version?: string;
  checksum?: string;
  headerType?: string;
  raw?: Buffer;
}

export interface RomAnalysis {
  fileName: string;
  fileSize: number;
  fileHash: string;
  detectedPlatform: string;
  isCompressed: boolean;
  archiveContents?: string[];
  headerInfo: RomHeader;
  isDuplicate: boolean;
  needsBios: boolean;
  compatibleEmulators: string[];
  metadata?: GameMetadata;
}

export interface GameMetadata {
  title: string;
  alternativeTitles?: string[];
  developer?: string;
  publisher?: string;
  releaseDate?: Date;
  releaseYear?: number;
  genre?: string;
  subGenre?: string;
  region?: string;
  language?: string;
  players?: number;
  rating?: number;
  description?: string;
  boxArtUrl?: string;
  screenshotUrls?: string[];
  videoUrl?: string;
  igdbId?: string;
  thegamesdbId?: string;
}

export class RomProcessingService {
  private metadataService: MetadataScrapingService;

  constructor() {
    this.metadataService = new MetadataScrapingService();
  }

  /**
   * Process a ROM file and extract all relevant information
   */
  async processRomFile(filePath: string, upload: Upload): Promise<RomAnalysis> {
    logger.info(`Processing ROM file: ${filePath}`);

    try {
      const stats = await fs.stat(filePath);
      const fileHash = await calculateFileHash(filePath);
      const isCompressed = isArchiveFile(filePath);

      // Handle compressed files
      let processedFilePath = filePath;
      let archiveContents: string[] | undefined;

      if (isCompressed) {
        const extractResult = await this.handleCompressedFile(filePath);
        processedFilePath = extractResult.mainRomPath;
        archiveContents = extractResult.contents;
      }

      // Analyze ROM header
      const headerInfo = await this.analyzeRomHeader(processedFilePath, upload.detectedPlatform!);

      // Extract metadata
      const metadata = await this.extractMetadata(processedFilePath, headerInfo, upload);

      // Check for duplicates
      const isDuplicate = await this.checkForDuplicates(fileHash);

      // Get platform configuration
      const platformConfig = getPlatformConfig(upload.detectedPlatform!);
      const needsBios = platformConfig?.biosRequired || false;
      const compatibleEmulators = platformConfig?.cores || [];

      const analysis: RomAnalysis = {
        fileName: path.basename(filePath),
        fileSize: stats.size,
        fileHash,
        detectedPlatform: upload.detectedPlatform!,
        isCompressed,
        archiveContents,
        headerInfo,
        isDuplicate,
        needsBios,
        compatibleEmulators,
        metadata,
      };

      logger.info(`ROM processing completed for: ${analysis.fileName}`);
      return analysis;

    } catch (error) {
      logger.error(`ROM processing failed for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Handle compressed ROM files (ZIP, 7Z, RAR)
   */
  private async handleCompressedFile(archivePath: string): Promise<{ mainRomPath: string; contents: string[] }> {
    logger.info(`Extracting compressed file: ${archivePath}`);

    const extractDir = path.join(config.storage.tempDir, `extract_${crypto.randomUUID()}`);
    await fs.mkdir(extractDir, { recursive: true });

    try {
      const extractedFiles = await extractArchive(archivePath, extractDir);
      
      if (extractedFiles.length === 0) {
        throw new Error('No files found in archive');
      }

      // Find the main ROM file (largest file with valid extension)
      const romFiles = extractedFiles.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return config.upload.allowedExtensions.includes(ext);
      });

      if (romFiles.length === 0) {
        throw new Error('No valid ROM files found in archive');
      }

      // Get the largest ROM file as the main file
      let mainRomFile = romFiles[0];
      let maxSize = 0;

      for (const romFile of romFiles) {
        const stats = await fs.stat(path.join(extractDir, romFile));
        if (stats.size > maxSize) {
          maxSize = stats.size;
          mainRomFile = romFile;
        }
      }

      return {
        mainRomPath: path.join(extractDir, mainRomFile),
        contents: extractedFiles,
      };

    } catch (error) {
      // Clean up on error
      await fs.rm(extractDir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Analyze ROM header based on platform
   */
  private async analyzeRomHeader(filePath: string, platform: string): Promise<RomHeader> {
    logger.debug(`Analyzing ROM header for platform: ${platform}`);

    try {
      const buffer = Buffer.alloc(512); // Read first 512 bytes for header analysis
      const fileHandle = await fs.open(filePath, 'r');
      await fileHandle.read(buffer, 0, 512, 0);
      await fileHandle.close();

      switch (platform) {
        case 'nes':
          return this.analyzeNesHeader(buffer);
        case 'snes':
          return this.analyzeSnesHeader(buffer);
        case 'n64':
          return this.analyzeN64Header(buffer);
        case 'gameboy':
        case 'gbc':
          return this.analyzeGameBoyHeader(buffer);
        case 'gba':
          return this.analyzeGbaHeader(buffer);
        case 'genesis':
          return this.analyzeGenesisHeader(buffer);
        case 'psx':
          return this.analyzePsxHeader(filePath);
        default:
          return { headerType: 'unknown', raw: buffer };
      }
    } catch (error) {
      logger.warn(`Header analysis failed for ${platform}:`, error);
      return { headerType: 'error' };
    }
  }

  /**
   * NES ROM header analysis
   */
  private analyzeNesHeader(buffer: Buffer): RomHeader {
    // Check for iNES header
    if (buffer.slice(0, 4).toString() === 'NES\x1A') {
      const prgRomSize = buffer[4] * 16384; // 16KB units
      const chrRomSize = buffer[5] * 8192;  // 8KB units
      const flags6 = buffer[6];
      const flags7 = buffer[7];

      return {
        headerType: 'iNES',
        title: 'Unknown NES Game',
        region: (flags6 & 0x01) ? 'NTSC' : 'PAL',
        checksum: buffer.slice(0, 16).toString('hex'),
        raw: buffer.slice(0, 16),
      };
    }

    return { headerType: 'raw', raw: buffer.slice(0, 16) };
  }

  /**
   * SNES ROM header analysis
   */
  private analyzeSnesHeader(buffer: Buffer): RomHeader {
    // Try to find SNES header at common locations
    const headerLocations = [0x7FC0, 0xFFC0, 0x40C0]; // LoROM, HiROM, ExHiROM

    for (const location of headerLocations) {
      if (buffer.length >= location + 32) {
        const title = buffer.slice(location, location + 21).toString('ascii').trim();
        const checksum = buffer.readUInt16LE(location + 28);
        const complement = buffer.readUInt16LE(location + 30);

        // Validate checksum
        if ((checksum ^ complement) === 0xFFFF) {
          return {
            headerType: 'SNES',
            title: title || 'Unknown SNES Game',
            checksum: checksum.toString(16),
            raw: buffer.slice(location, location + 32),
          };
        }
      }
    }

    return { headerType: 'unknown', raw: buffer.slice(0, 32) };
  }

  /**
   * Nintendo 64 ROM header analysis
   */
  private analyzeN64Header(buffer: Buffer): RomHeader {
    // N64 ROMs start with specific byte sequences
    const magic = buffer.readUInt32BE(0);
    
    if (magic === 0x80371240) { // Big-endian format
      const title = buffer.slice(32, 52).toString('ascii').trim();
      const gameCode = buffer.slice(59, 63).toString('ascii');
      
      return {
        headerType: 'N64',
        title: title || 'Unknown N64 Game',
        version: gameCode,
        checksum: buffer.slice(16, 24).toString('hex'),
        raw: buffer.slice(0, 64),
      };
    }

    return { headerType: 'unknown', raw: buffer.slice(0, 64) };
  }

  /**
   * Game Boy ROM header analysis
   */
  private analyzeGameBoyHeader(buffer: Buffer): RomHeader {
    // Game Boy header starts at 0x100
    if (buffer.length >= 0x150) {
      const title = buffer.slice(0x134, 0x144).toString('ascii').trim();
      const cgbFlag = buffer[0x143];
      const sgbFlag = buffer[0x146];

      let region = 'Unknown';
      if (cgbFlag === 0x80 || cgbFlag === 0xC0) region = 'Game Boy Color';
      else if (sgbFlag === 0x03) region = 'Super Game Boy';
      else region = 'Game Boy';

      return {
        headerType: 'Game Boy',
        title: title || 'Unknown Game Boy Game',
        region,
        checksum: buffer[0x14D].toString(16),
        raw: buffer.slice(0x100, 0x150),
      };
    }

    return { headerType: 'unknown', raw: buffer.slice(0, 80) };
  }

  /**
   * Game Boy Advance ROM header analysis
   */
  private analyzeGbaHeader(buffer: Buffer): RomHeader {
    if (buffer.length >= 0xC0) {
      const title = buffer.slice(0xA0, 0xAC).toString('ascii').trim();
      const gameCode = buffer.slice(0xAC, 0xB0).toString('ascii');
      const makerCode = buffer.slice(0xB0, 0xB2).toString('ascii');
      
      return {
        headerType: 'GBA',
        title: title || 'Unknown GBA Game',
        version: gameCode,
        checksum: buffer[0xBD].toString(16),
        raw: buffer.slice(0xA0, 0xC0),
      };
    }

    return { headerType: 'unknown', raw: buffer.slice(0, 32) };
  }

  /**
   * Sega Genesis ROM header analysis
   */
  private analyzeGenesisHeader(buffer: Buffer): RomHeader {
    // Genesis header starts at 0x100
    if (buffer.length >= 0x200) {
      const system = buffer.slice(0x100, 0x110).toString('ascii').trim();
      const title = buffer.slice(0x150, 0x190).toString('ascii').trim();
      const region = buffer.slice(0x1F0, 0x1F3).toString('ascii').trim();

      if (system.includes('SEGA')) {
        return {
          headerType: 'Genesis',
          title: title || 'Unknown Genesis Game',
          region: region || 'Unknown',
          raw: buffer.slice(0x100, 0x200),
        };
      }
    }

    return { headerType: 'unknown', raw: buffer.slice(0, 32) };
  }

  /**
   * PlayStation ROM analysis (for disc images)
   */
  private async analyzePsxHeader(filePath: string): Promise<RomHeader> {
    // For ISO files, check for PlayStation signature
    const buffer = Buffer.alloc(2048);
    const fileHandle = await fs.open(filePath, 'r');
    
    try {
      // Read system area
      await fileHandle.read(buffer, 0, 2048, 0x8000);
      
      const systemId = buffer.slice(1, 6).toString('ascii');
      if (systemId === 'CD001') {
        // This is an ISO 9660 disc image
        return {
          headerType: 'PlayStation ISO',
          title: 'PlayStation Game',
          raw: buffer.slice(0, 256),
        };
      }

      return { headerType: 'unknown', raw: buffer.slice(0, 256) };
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * Extract metadata using various sources
   */
  private async extractMetadata(
    filePath: string, 
    headerInfo: RomHeader, 
    upload: Upload
  ): Promise<GameMetadata | undefined> {
    try {
      // Use header title as fallback
      const fallbackTitle = headerInfo.title || 
                           path.basename(upload.fileName, path.extname(upload.fileName));

      // Try to get metadata from external sources
      const scrapedMetadata = await this.metadataService.scrapeMetadata({
        title: fallbackTitle,
        platform: upload.detectedPlatform!,
        region: headerInfo.region,
        fileHash: upload.fileHash,
      });

      if (scrapedMetadata) {
        return scrapedMetadata;
      }

      // Return basic metadata from header
      return {
        title: fallbackTitle,
        region: headerInfo.region,
        // Add more fields based on header analysis
      };

    } catch (error) {
      logger.warn(`Metadata extraction failed for ${upload.fileName}:`, error);
      return {
        title: headerInfo.title || path.basename(upload.fileName, path.extname(upload.fileName)),
      };
    }
  }

  /**
   * Check for duplicate ROMs in the database
   */
  private async checkForDuplicates(fileHash: string): Promise<boolean> {
    try {
      // This would typically check against a database
      // For now, we'll implement a simple file-based check
      const duplicateCheckPath = path.join(config.storage.tempDir, 'hashes.txt');
      
      try {
        const existingHashes = await fs.readFile(duplicateCheckPath, 'utf-8');
        return existingHashes.includes(fileHash);
      } catch (error) {
        // File doesn't exist, no duplicates
        return false;
      }
    } catch (error) {
      logger.warn(`Duplicate check failed for hash ${fileHash}:`, error);
      return false;
    }
  }

  /**
   * Validate ROM file integrity and format
   */
  async validateRom(filePath: string, platform: string): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Check file exists and is readable
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        errors.push('Path is not a valid file');
        return { isValid: false, errors };
      }

      // Check file size limits
      const platformConfig = getPlatformConfig(platform);
      if (platformConfig?.maxSize && stats.size > platformConfig.maxSize) {
        errors.push(`File size exceeds maximum for platform ${platform}`);
      }

      // Validate file signature
      const hasValidSignature = await validateFileSignature(filePath, path.basename(filePath));
      if (!hasValidSignature) {
        errors.push('File signature validation failed');
      }

      // Platform-specific validation
      const platformErrors = await this.validatePlatformSpecific(filePath, platform);
      errors.push(...platformErrors);

      return { isValid: errors.length === 0, errors };

    } catch (error) {
      errors.push(`Validation error: ${error.message}`);
      return { isValid: false, errors };
    }
  }

  /**
   * Platform-specific ROM validation
   */
  private async validatePlatformSpecific(filePath: string, platform: string): Promise<string[]> {
    const errors: string[] = [];

    try {
      const buffer = Buffer.alloc(512);
      const fileHandle = await fs.open(filePath, 'r');
      await fileHandle.read(buffer, 0, 512, 0);
      await fileHandle.close();

      switch (platform) {
        case 'nes':
          if (!buffer.slice(0, 4).equals(Buffer.from('NES\x1A'))) {
            errors.push('Invalid NES ROM header');
          }
          break;

        case 'n64':
          const magic = buffer.readUInt32BE(0);
          if (magic !== 0x80371240 && magic !== 0x37804012) {
            errors.push('Invalid N64 ROM format');
          }
          break;

        case 'psx':
          // For PSX ISOs, check for common disc signatures
          if (path.extname(filePath).toLowerCase() === '.iso') {
            // Additional ISO validation could be added here
          }
          break;

        // Add more platform-specific validations as needed
      }

    } catch (error) {
      errors.push(`Platform validation failed: ${error.message}`);
    }

    return errors;
  }

  /**
   * Clean up temporary extraction directories
   */
  async cleanup(): Promise<void> {
    const tempDir = config.storage.tempDir;
    
    try {
      const entries = await fs.readdir(tempDir);
      const extractDirs = entries.filter(entry => entry.startsWith('extract_'));
      
      for (const dir of extractDirs) {
        const dirPath = path.join(tempDir, dir);
        const stats = await fs.stat(dirPath);
        
        // Remove directories older than 1 hour
        if (Date.now() - stats.mtime.getTime() > 60 * 60 * 1000) {
          await fs.rm(dirPath, { recursive: true, force: true });
          logger.info(`Cleaned up temporary extraction directory: ${dir}`);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup temporary directories:', error);
    }
  }
}

export async function processRomFile(filePath: string, upload: Upload): Promise<RomAnalysis> {
  const processor = new RomProcessingService();
  return processor.processRomFile(filePath, upload);
}

export default RomProcessingService;