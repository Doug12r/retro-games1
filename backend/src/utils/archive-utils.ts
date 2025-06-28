import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import yauzl from 'yauzl';
import { Extract } from 'unzipper';
import { logger } from './logger';
import { ensureDirectory, deleteDirectory } from './fileUtils';

// Supported archive formats
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2'];

/**
 * Check if file is an archive based on extension
 */
export function isArchiveFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return ARCHIVE_EXTENSIONS.includes(extension);
}

/**
 * Extract archive to specified directory
 */
export async function extractArchive(archivePath: string, extractPath: string): Promise<string[]> {
  const extension = path.extname(archivePath).toLowerCase();
  
  // Ensure extraction directory exists
  await ensureDirectory(extractPath);
  
  logger.info(`Extracting ${extension} archive: ${archivePath} to ${extractPath}`);

  switch (extension) {
    case '.zip':
      return extractZip(archivePath, extractPath);
    case '.7z':
      return extract7z(archivePath, extractPath);
    case '.rar':
      return extractRar(archivePath, extractPath);
    case '.tar':
    case '.gz':
    case '.bz2':
      return extractTar(archivePath, extractPath);
    default:
      throw new Error(`Unsupported archive format: ${extension}`);
  }
}

/**
 * Extract ZIP archive
 */
async function extractZip(zipPath: string, extractPath: string): Promise<string[]> {
  const extractedFiles: string[] = [];

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      if (!zipfile) {
        reject(new Error('Failed to open ZIP file'));
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', async (entry) => {
        const fileName = entry.fileName;
        const fullPath = path.join(extractPath, fileName);

        // Security check - prevent directory traversal
        if (!fullPath.startsWith(extractPath)) {
          logger.warn(`Skipping potentially dangerous path: ${fileName}`);
          zipfile.readEntry();
          return;
        }

        if (/\/$/.test(fileName)) {
          // Directory entry
          try {
            await ensureDirectory(fullPath);
            zipfile.readEntry();
          } catch (error) {
            reject(error);
          }
        } else {
          // File entry
          try {
            await ensureDirectory(path.dirname(fullPath));
            
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                reject(err);
                return;
              }

              if (!readStream) {
                reject(new Error('Failed to create read stream'));
                return;
              }

              const writeStream = createWriteStream(fullPath);
              
              pipeline(readStream, writeStream)
                .then(() => {
                  extractedFiles.push(fileName);
                  zipfile.readEntry();
                })
                .catch(reject);
            });
          } catch (error) {
            reject(error);
          }
        }
      });

      zipfile.on('end', () => {
        logger.info(`Extracted ${extractedFiles.length} files from ZIP archive`);
        resolve(extractedFiles);
      });

      zipfile.on('error', reject);
    });
  });
}

/**
 * Extract ZIP archive using unzipper (alternative method)
 */
async function extractZipUnzipper(zipPath: string, extractPath: string): Promise<string[]> {
  const extractedFiles: string[] = [];

  return new Promise((resolve, reject) => {
    const readStream = createReadStream(zipPath);
    const extractStream = Extract({ path: extractPath });

    extractStream.on('entry', (entry) => {
      extractedFiles.push(entry.path);
    });

    extractStream.on('close', () => {
      logger.info(`Extracted ${extractedFiles.length} files from ZIP archive`);
      resolve(extractedFiles);
    });

    extractStream.on('error', reject);

    readStream.pipe(extractStream);
  });
}

/**
 * Extract 7z archive using system command
 */
async function extract7z(archivePath: string, extractPath: string): Promise<string[]> {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    // Try to use 7z command line tool
    await execFileAsync('7z', ['x', archivePath, `-o${extractPath}`, '-y']);
    
    // List extracted files
    const files = await listDirectoryRecursive(extractPath);
    logger.info(`Extracted ${files.length} files from 7z archive`);
    return files;
    
  } catch (error) {
    logger.error('7z extraction failed, trying alternative method:', error);
    
    // Fallback to node-7z if available
    try {
      const Seven = require('node-7z');
      const stream = Seven.extractFull(archivePath, extractPath, {
        $progress: true,
        recursive: true,
      });

      return new Promise((resolve, reject) => {
        const extractedFiles: string[] = [];

        stream.on('data', (data) => {
          if (data.file) {
            extractedFiles.push(data.file);
          }
        });

        stream.on('end', () => {
          logger.info(`Extracted ${extractedFiles.length} files from 7z archive`);
          resolve(extractedFiles);
        });

        stream.on('error', reject);
      });
    } catch (fallbackError) {
      throw new Error('7z extraction failed and no alternative available');
    }
  }
}

/**
 * Extract RAR archive using system command
 */
async function extractRar(rarPath: string, extractPath: string): Promise<string[]> {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    // Try to use unrar command line tool
    await execFileAsync('unrar', ['x', rarPath, extractPath]);
    
    // List extracted files
    const files = await listDirectoryRecursive(extractPath);
    logger.info(`Extracted ${files.length} files from RAR archive`);
    return files;
    
  } catch (error) {
    logger.error('RAR extraction failed:', error);
    
    // Try alternative command
    try {
      await execFileAsync('rar', ['x', rarPath, extractPath]);
      const files = await listDirectoryRecursive(extractPath);
      logger.info(`Extracted ${files.length} files from RAR archive`);
      return files;
    } catch (fallbackError) {
      throw new Error('RAR extraction failed and no alternative available');
    }
  }
}

/**
 * Extract TAR/GZ/BZ2 archive using system tar command
 */
async function extractTar(tarPath: string, extractPath: string): Promise<string[]> {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    const extension = path.extname(tarPath).toLowerCase();
    let tarFlags = '-xf';
    
    if (extension === '.gz' || tarPath.includes('.tar.gz')) {
      tarFlags = '-xzf';
    } else if (extension === '.bz2' || tarPath.includes('.tar.bz2')) {
      tarFlags = '-xjf';
    }

    await execFileAsync('tar', [tarFlags, tarPath, '-C', extractPath]);
    
    // List extracted files
    const files = await listDirectoryRecursive(extractPath);
    logger.info(`Extracted ${files.length} files from TAR archive`);
    return files;
    
  } catch (error) {
    logger.error('TAR extraction failed:', error);
    throw new Error('TAR extraction failed');
  }
}

/**
 * List all files in directory recursively
 */
async function listDirectoryRecursive(dirPath: string, baseDir: string = ''): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const relativePath = path.join(baseDir, entry.name);
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await listDirectoryRecursive(fullPath, relativePath);
        files.push(...subFiles);
      } else {
        files.push(relativePath);
      }
    }
  } catch (error) {
    logger.error(`Failed to list directory ${dirPath}:`, error);
  }
  
  return files;
}

/**
 * Get archive information without extracting
 */
export async function getArchiveInfo(archivePath: string): Promise<{
  format: string;
  fileCount: number;
  totalSize: number;
  files: Array<{ name: string; size: number; compressed: number }>;
}> {
  const extension = path.extname(archivePath).toLowerCase();
  
  switch (extension) {
    case '.zip':
      return getZipInfo(archivePath);
    default:
      throw new Error(`Archive info not supported for format: ${extension}`);
  }
}

/**
 * Get ZIP archive information
 */
async function getZipInfo(zipPath: string): Promise<{
  format: string;
  fileCount: number;
  totalSize: number;
  files: Array<{ name: string; size: number; compressed: number }>;
}> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      if (!zipfile) {
        reject(new Error('Failed to open ZIP file'));
        return;
      }

      const files: Array<{ name: string; size: number; compressed: number }> = [];
      let totalSize = 0;

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        if (!/\/$/.test(entry.fileName)) {
          // File entry
          files.push({
            name: entry.fileName,
            size: entry.uncompressedSize,
            compressed: entry.compressedSize,
          });
          totalSize += entry.uncompressedSize;
        }
        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        resolve({
          format: 'zip',
          fileCount: files.length,
          totalSize,
          files,
        });
      });

      zipfile.on('error', reject);
    });
  });
}

/**
 * Validate archive before extraction
 */
export async function validateArchive(archivePath: string): Promise<{
  isValid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Check if file exists
    const stats = await fs.stat(archivePath);
    if (!stats.isFile()) {
      errors.push('Archive path is not a file');
      return { isValid: false, errors, warnings };
    }

    // Check file size (limit to 4GB)
    const maxSize = 4 * 1024 * 1024 * 1024; // 4GB
    if (stats.size > maxSize) {
      errors.push(`Archive size ${stats.size} exceeds maximum allowed size ${maxSize}`);
    }

    // Check archive format
    if (!isArchiveFile(archivePath)) {
      errors.push('File is not a supported archive format');
    }

    // Try to get archive info
    const extension = path.extname(archivePath).toLowerCase();
    if (extension === '.zip') {
      try {
        const info = await getZipInfo(archivePath);
        
        // Check for suspicious file count
        if (info.fileCount > 10000) {
          warnings.push(`Archive contains ${info.fileCount} files, which is unusually high`);
        }

        // Check for zip bombs (high compression ratio)
        const compressionRatio = info.totalSize / stats.size;
        if (compressionRatio > 100) {
          errors.push(`Suspicious compression ratio: ${compressionRatio.toFixed(2)}:1 (possible zip bomb)`);
        }

        // Check for directory traversal attacks
        for (const file of info.files) {
          if (file.name.includes('..') || file.name.startsWith('/')) {
            errors.push(`Potentially dangerous file path: ${file.name}`);
          }
        }
      } catch (error) {
        errors.push(`Failed to read archive: ${error.message}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(`Archive validation failed: ${error.message}`);
    return { isValid: false, errors, warnings };
  }
}

/**
 * Extract specific file from archive
 */
export async function extractFileFromArchive(
  archivePath: string,
  fileName: string,
  outputPath: string
): Promise<boolean> {
  const extension = path.extname(archivePath).toLowerCase();
  
  switch (extension) {
    case '.zip':
      return extractFileFromZip(archivePath, fileName, outputPath);
    default:
      throw new Error(`Single file extraction not supported for format: ${extension}`);
  }
}

/**
 * Extract specific file from ZIP archive
 */
async function extractFileFromZip(
  zipPath: string,
  fileName: string,
  outputPath: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      if (!zipfile) {
        reject(new Error('Failed to open ZIP file'));
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        if (entry.fileName === fileName) {
          zipfile.openReadStream(entry, async (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }

            if (!readStream) {
              reject(new Error('Failed to create read stream'));
              return;
            }

            try {
              await ensureDirectory(path.dirname(outputPath));
              const writeStream = createWriteStream(outputPath);
              await pipeline(readStream, writeStream);
              resolve(true);
            } catch (error) {
              reject(error);
            }
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        resolve(false); // File not found
      });

      zipfile.on('error', reject);
    });
  });
}

/**
 * Clean up extracted files and directories
 */
export async function cleanupExtraction(extractPath: string): Promise<void> {
  try {
    await deleteDirectory(extractPath);
    logger.info(`Cleaned up extraction directory: ${extractPath}`);
  } catch (error) {
    logger.error(`Failed to cleanup extraction directory ${extractPath}:`, error);
  }
}

/**
 * Check if archive extraction is safe (prevent zip bombs)
 */
export function isExtractionSafe(
  archiveSize: number,
  uncompressedSize: number,
  fileCount: number
): { safe: boolean; reason?: string } {
  // Check compression ratio
  const compressionRatio = uncompressedSize / archiveSize;
  if (compressionRatio > 100) {
    return { safe: false, reason: `Compression ratio too high: ${compressionRatio.toFixed(2)}:1` };
  }

  // Check uncompressed size limit (10GB)
  const maxUncompressedSize = 10 * 1024 * 1024 * 1024;
  if (uncompressedSize > maxUncompressedSize) {
    return { safe: false, reason: `Uncompressed size too large: ${uncompressedSize} bytes` };
  }

  // Check file count limit
  if (fileCount > 10000) {
    return { safe: false, reason: `Too many files: ${fileCount}` };
  }

  return { safe: true };
}

export default {
  isArchiveFile,
  extractArchive,
  getArchiveInfo,
  validateArchive,
  extractFileFromArchive,
  cleanupExtraction,
  isExtractionSafe,
};