import fs from 'fs/promises';
import crypto from 'crypto';
import { createReadStream } from 'fs';
import path from 'path';
import { logger } from './logger';

// File signature mappings for validation
const FILE_SIGNATURES: Record<string, Buffer[]> = {
  // Archive formats
  '.zip': [Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from([0x50, 0x4B, 0x05, 0x06])],
  '.7z': [Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])],
  '.rar': [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]), Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01])],
  
  // Nintendo formats
  '.nes': [Buffer.from([0x4E, 0x45, 0x53, 0x1A])], // 'NES\x1A'
  '.n64': [Buffer.from([0x80, 0x37, 0x12, 0x40]), Buffer.from([0x37, 0x80, 0x40, 0x12])],
  
  // Disc image formats
  '.iso': [Buffer.from([0x43, 0x44, 0x30, 0x30, 0x31]), Buffer.from([0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00])],
  '.bin': [], // BIN files can have various signatures
  '.cue': [], // CUE files are text-based
  
  // Other formats
  '.chd': [Buffer.from([0x4D, 0x43, 0x6F, 0x6D, 0x70, 0x72, 0x48, 0x44])], // 'MComprHD'
};

/**
 * Calculate SHA256 hash of a file
 */
export async function calculateFileHash(filePath: string, algorithm: string = 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Calculate hash of a buffer
 */
export function calculateBufferHash(buffer: Buffer, algorithm: string = 'sha256'): string {
  return crypto.createHash(algorithm).update(buffer).digest('hex');
}

/**
 * Validate file signature (magic numbers)
 */
export async function validateFileSignature(filePath: string, fileName: string): Promise<boolean> {
  try {
    const extension = path.extname(fileName).toLowerCase();
    const signatures = FILE_SIGNATURES[extension];

    if (!signatures || signatures.length === 0) {
      // No specific signatures to check, assume valid
      return true;
    }

    const buffer = Buffer.alloc(32); // Read first 32 bytes
    const fileHandle = await fs.open(filePath, 'r');
    
    try {
      const { bytesRead } = await fileHandle.read(buffer, 0, 32, 0);
      
      if (bytesRead === 0) {
        return false; // Empty file
      }

      // Check if any signature matches
      for (const signature of signatures) {
        if (buffer.subarray(0, signature.length).equals(signature)) {
          return true;
        }
      }

      return false;
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    logger.warn(`File signature validation failed for ${fileName}:`, error);
    return false;
  }
}

/**
 * Get file MIME type based on extension and content
 */
export async function getFileMimeType(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  
  // Common ROM and archive MIME types
  const mimeTypes: Record<string, string> = {
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
    '.rar': 'application/x-rar-compressed',
    '.iso': 'application/x-iso9660-image',
    '.bin': 'application/octet-stream',
    '.cue': 'application/x-cue',
    '.chd': 'application/x-mame-chd',
    '.nes': 'application/x-nes-rom',
    '.sfc': 'application/x-snes-rom',
    '.smc': 'application/x-snes-rom',
    '.n64': 'application/x-n64-rom',
    '.z64': 'application/x-n64-rom',
    '.v64': 'application/x-n64-rom',
    '.gb': 'application/x-gameboy-rom',
    '.gbc': 'application/x-gameboy-color-rom',
    '.gba': 'application/x-gba-rom',
    '.md': 'application/x-genesis-rom',
    '.gen': 'application/x-genesis-rom',
    '.smd': 'application/x-genesis-rom',
  };

  return mimeTypes[extension] || 'application/octet-stream';
}

/**
 * Safely create directory structure
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Move file atomically (with fallback to copy+delete)
 */
export async function moveFile(sourcePath: string, destPath: string): Promise<void> {
  try {
    // Ensure destination directory exists
    await ensureDirectory(path.dirname(destPath));

    // Try atomic rename first (fastest)
    await fs.rename(sourcePath, destPath);
  } catch (error) {
    if (error.code === 'EXDEV') {
      // Cross-device link, need to copy and delete
      await fs.copyFile(sourcePath, destPath);
      await fs.unlink(sourcePath);
    } else {
      throw error;
    }
  }
}

/**
 * Copy file with progress callback
 */
export async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  onProgress?: (bytesRead: number, totalBytes: number) => void
): Promise<void> {
  const stats = await fs.stat(sourcePath);
  const totalBytes = stats.size;
  let bytesRead = 0;

  await ensureDirectory(path.dirname(destPath));

  return new Promise((resolve, reject) => {
    const readStream = createReadStream(sourcePath);
    const writeStream = require('fs').createWriteStream(destPath);

    readStream.on('data', (chunk: Buffer) => {
      bytesRead += chunk.length;
      if (onProgress) {
        onProgress(bytesRead, totalBytes);
      }
    });

    readStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    readStream.pipe(writeStream);
  });
}

/**
 * Delete file safely (ignore if doesn't exist)
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // File didn't exist
    }
    throw error;
  }
}

/**
 * Delete directory recursively (ignore if doesn't exist)
 */
export async function deleteDirectory(dirPath: string): Promise<boolean> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // Directory didn't exist
    }
    throw error;
  }
}

/**
 * Get file statistics
 */
export async function getFileStats(filePath: string): Promise<{
  size: number;
  created: Date;
  modified: Date;
  isFile: boolean;
  isDirectory: boolean;
}> {
  const stats = await fs.stat(filePath);
  
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
  };
}

/**
 * Check if file exists and is accessible
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if file is readable
 */
export async function isFileReadable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if file is writable
 */
export async function isFileWritable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Sanitize filename for safe file system storage
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace invalid characters
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .substring(0, 255); // Limit length
}

/**
 * Generate unique filename if file already exists
 */
export async function generateUniqueFilename(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) {
    return filePath;
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  let counter = 1;
  let newPath: string;

  do {
    newPath = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  } while (await fileExists(newPath));

  return newPath;
}

/**
 * Compare two files by hash
 */
export async function compareFiles(filePath1: string, filePath2: string): Promise<boolean> {
  try {
    const [hash1, hash2] = await Promise.all([
      calculateFileHash(filePath1),
      calculateFileHash(filePath2),
    ]);
    
    return hash1 === hash2;
  } catch (error) {
    logger.error('File comparison failed:', error);
    return false;
  }
}

/**
 * Verify file integrity by comparing with expected hash
 */
export async function verifyFileIntegrity(filePath: string, expectedHash: string, algorithm: string = 'sha256'): Promise<boolean> {
  try {
    const actualHash = await calculateFileHash(filePath, algorithm);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  } catch (error) {
    logger.error('File integrity verification failed:', error);
    return false;
  }
}

/**
 * Get directory size recursively
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  async function processEntry(entryPath: string): Promise<void> {
    const stats = await fs.stat(entryPath);
    
    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const entries = await fs.readdir(entryPath);
      await Promise.all(entries.map(entry => processEntry(path.join(entryPath, entry))));
    }
  }

  try {
    await processEntry(dirPath);
    return totalSize;
  } catch (error) {
    logger.error(`Failed to calculate directory size for ${dirPath}:`, error);
    return 0;
  }
}

/**
 * Clean up old files in a directory based on age
 */
export async function cleanupOldFiles(dirPath: string, maxAgeMs: number): Promise<number> {
  let deletedCount = 0;
  const cutoffTime = new Date(Date.now() - maxAgeMs);

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const stats = await fs.stat(entryPath);

      if (stats.mtime < cutoffTime) {
        if (entry.isFile()) {
          await deleteFile(entryPath);
          deletedCount++;
        } else if (entry.isDirectory()) {
          await deleteDirectory(entryPath);
          deletedCount++;
        }
      }
    }

    logger.info(`Cleaned up ${deletedCount} old files from ${dirPath}`);
    return deletedCount;
  } catch (error) {
    logger.error(`Failed to cleanup old files in ${dirPath}:`, error);
    return 0;
  }
}

/**
 * Read file in chunks for processing large files
 */
export async function processFileInChunks(
  filePath: string,
  chunkSize: number,
  processor: (chunk: Buffer, offset: number) => Promise<void>
): Promise<void> {
  const fileHandle = await fs.open(filePath, 'r');
  let offset = 0;

  try {
    while (true) {
      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, offset);

      if (bytesRead === 0) break; // End of file

      await processor(buffer.subarray(0, bytesRead), offset);
      offset += bytesRead;
    }
  } finally {
    await fileHandle.close();
  }
}

export default {
  calculateFileHash,
  calculateBufferHash,
  validateFileSignature,
  getFileMimeType,
  ensureDirectory,
  moveFile,
  copyFileWithProgress,
  deleteFile,
  deleteDirectory,
  getFileStats,
  fileExists,
  isFileReadable,
  isFileWritable,
  formatFileSize,
  sanitizeFilename,
  generateUniqueFilename,
  compareFiles,
  verifyFileIntegrity,
  getDirectorySize,
  cleanupOldFiles,
  processFileInChunks,
};