import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create log file streams
const logFile = path.join(logsDir, 'app.log');
const errorLogFile = path.join(logsDir, 'error.log');
const uploadLogFile = path.join(logsDir, 'upload.log');

// Pino logger configuration
const pinoConfig: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  
  // Production configuration
  ...(process.env.NODE_ENV === 'production' && {
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token'],
      remove: true,
    },
  }),

  // Development configuration
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    },
  }),

  // Base configuration
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    pid: process.pid,
    hostname: require('os').hostname(),
    service: 'retro-game-backend',
    version: process.env.npm_package_version || '1.0.0',
  },

  // Custom serializers
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
    upload: (upload: any) => ({
      id: upload?.id,
      fileName: upload?.fileName,
      fileSize: upload?.fileSize,
      status: upload?.status,
      progress: upload?.progress,
    }),
    game: (game: any) => ({
      id: game?.id,
      title: game?.title,
      platform: game?.platform,
      fileSize: game?.fileSize,
    }),
  },

  // Custom formatters for production
  ...(process.env.NODE_ENV === 'production' && {
    formatters: {
      level: (label: string) => ({ level: label }),
      bindings: (bindings: any) => ({
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: bindings.service,
        version: bindings.version,
      }),
    },
  }),
};

// Create the main logger
export const logger = pino(pinoConfig);

// Create specialized loggers for different components
export const uploadLogger = logger.child({ component: 'upload' });
export const gameLogger = logger.child({ component: 'game' });
export const authLogger = logger.child({ component: 'auth' });
export const apiLogger = logger.child({ component: 'api' });
export const dbLogger = logger.child({ component: 'database' });

// File-based logging for production
if (process.env.NODE_ENV === 'production') {
  const multistream = pino.multistream([
    // Main log file (all levels)
    {
      level: 'info',
      stream: pino.destination({
        dest: logFile,
        sync: false,
        mkdir: true,
      }),
    },
    // Error log file (errors only)
    {
      level: 'error',
      stream: pino.destination({
        dest: errorLogFile,
        sync: false,
        mkdir: true,
      }),
    },
    // Upload log file (upload-related logs)
    {
      level: 'info',
      stream: pino.destination({
        dest: uploadLogFile,
        sync: false,
        mkdir: true,
      }),
    },
    // Console output
    {
      level: 'warn',
      stream: process.stdout,
    },
  ]);

  // Override logger for production multistream
  const productionLogger = pino(
    {
      ...pinoConfig,
      transport: undefined, // Remove pretty transport for production
    },
    multistream
  );

  // Export production logger
  module.exports = {
    logger: productionLogger,
    uploadLogger: productionLogger.child({ component: 'upload' }),
    gameLogger: productionLogger.child({ component: 'game' }),
    authLogger: productionLogger.child({ component: 'auth' }),
    apiLogger: productionLogger.child({ component: 'api' }),
    dbLogger: productionLogger.child({ component: 'database' }),
  };
}

// Utility functions for structured logging
export const logError = (error: Error, context?: any) => {
  logger.error({ err: error, ...context }, error.message);
};

export const logUploadProgress = (upload: any, message: string) => {
  uploadLogger.info({ upload }, message);
};

export const logGameOperation = (game: any, operation: string, result?: string) => {
  gameLogger.info({ game, operation, result }, `Game ${operation}`);
};

export const logApiRequest = (req: any, res: any, responseTime?: number) => {
  apiLogger.info(
    {
      req,
      res,
      responseTime,
    },
    `${req.method} ${req.url} - ${res.statusCode}`
  );
};

export const logDatabaseOperation = (operation: string, table: string, duration?: number) => {
  dbLogger.info(
    {
      operation,
      table,
      duration,
    },
    `Database ${operation} on ${table}`
  );
};

// Performance monitoring helpers
export const createTimer = (label: string) => {
  const start = process.hrtime.bigint();
  
  return {
    end: (context?: any) => {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1000000; // Convert to milliseconds
      
      logger.info(
        {
          label,
          duration,
          ...context,
        },
        `Timer ${label}: ${duration.toFixed(2)}ms`
      );
      
      return duration;
    },
  };
};

// Memory usage logging
export const logMemoryUsage = () => {
  const usage = process.memoryUsage();
  logger.info(
    {
      memory: {
        rss: Math.round(usage.rss / 1024 / 1024),
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
        external: Math.round(usage.external / 1024 / 1024),
      },
    },
    'Memory usage (MB)'
  );
};

// System information logging
export const logSystemInfo = () => {
  const os = require('os');
  logger.info(
    {
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024),
        cpus: os.cpus().length,
        uptime: Math.round(os.uptime()),
      },
    },
    'System information'
  );
};

// Request correlation ID middleware helper
export const addCorrelationId = () => {
  return (req: any, res: any, next: any) => {
    req.correlationId = req.headers['x-correlation-id'] || 
                       req.headers['x-request-id'] || 
                       generateCorrelationId();
    
    res.setHeader('x-correlation-id', req.correlationId);
    req.log = logger.child({ correlationId: req.correlationId });
    
    next();
  };
};

// Generate correlation ID
const generateCorrelationId = (): string => {
  return [
    Date.now().toString(36),
    Math.random().toString(36).substr(2, 9),
  ].join('-');
};

// Log rotation helper (for development)
export const rotateLogFiles = async (maxSizeBytes: number = 100 * 1024 * 1024) => {
  const fs = require('fs').promises;
  const logFiles = [logFile, errorLogFile, uploadLogFile];
  
  for (const file of logFiles) {
    try {
      const stats = await fs.stat(file);
      if (stats.size > maxSizeBytes) {
        const rotatedFile = `${file}.${Date.now()}`;
        await fs.rename(file, rotatedFile);
        logger.info(`Rotated log file: ${file} -> ${rotatedFile}`);
      }
    } catch (error) {
      // File doesn't exist or other error, ignore
    }
  }
};

// Shutdown handler for graceful log flushing
export const gracefulShutdown = () => {
  logger.info('Flushing logs before shutdown...');
  
  // Flush pino logs
  if (typeof logger.flush === 'function') {
    logger.flush();
  }
  
  // Give some time for async writes to complete
  setTimeout(() => {
    process.exit(0);
  }, 1000);
};

// Install process handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Periodic memory usage logging (every 5 minutes in production)
if (process.env.NODE_ENV === 'production') {
  setInterval(logMemoryUsage, 5 * 60 * 1000);
}

// Log system info on startup
logSystemInfo();

export default logger;