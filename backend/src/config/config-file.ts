import { z } from 'zod';
import path from 'path';

// Environment validation schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  HOST: z.string().default('0.0.0.0'),
  
  // Database
  DATABASE_URL: z.string(),
  
  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().transform(Number).default('0'),
  
  // Storage
  UPLOAD_DIR: z.string().default('./uploads'),
  ROM_DIR: z.string().default('./roms'),
  MEDIA_DIR: z.string().default('./media'),
  BIOS_DIR: z.string().default('./bios'),
  TEMP_DIR: z.string().default('./temp'),
  
  // Upload settings
  MAX_FILE_SIZE: z.string().transform(Number).default('4294967296'), // 4GB
  CHUNK_SIZE: z.string().transform(Number).default('1048576'), // 1MB
  UPLOAD_TIMEOUT: z.string().transform(Number).default('3600'), // 1 hour
  
  // Frontend
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  
  // API keys for metadata scraping
  IGDB_CLIENT_ID: z.string().optional(),
  IGDB_CLIENT_SECRET: z.string().optional(),
  THEGAMESDB_API_KEY: z.string().optional(),
  SCREENSCRAPER_USERNAME: z.string().optional(),
  SCREENSCRAPER_PASSWORD: z.string().optional(),
  
  // Security
  JWT_SECRET: z.string().default('your-super-secret-jwt-key-change-in-production'),
  RATE_LIMIT_MAX: z.string().transform(Number).default('1000'),
  RATE_LIMIT_WINDOW: z.string().default('15'),
  
  // Processing
  ENABLE_VIRUS_SCAN: z.string().transform(Boolean).default('false'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.string().transform(Number).optional(),
  
  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

// Parse and validate environment variables
const env = envSchema.parse(process.env);

// ROM format definitions with comprehensive platform support
interface RomFormat {
  extensions: string[];
  mimeTypes: string[];
  emulator: string;
  cores: string[];
  biosRequired: boolean;
  biosFiles?: string[];
  maxSize?: number; // in bytes
  description: string;
}

interface PlatformConfig {
  [key: string]: RomFormat;
}

export const ROM_FORMATS: { [category: string]: PlatformConfig } = {
  nintendo: {
    nes: {
      extensions: ['.nes', '.unif', '.fds', '.nsf'],
      mimeTypes: ['application/x-nes-rom', 'application/octet-stream'],
      emulator: 'jsnes',
      cores: ['nestopia', 'fceumm', 'mesen'],
      biosRequired: false,
      maxSize: 4 * 1024 * 1024, // 4MB
      description: 'Nintendo Entertainment System'
    },
    snes: {
      extensions: ['.sfc', '.smc', '.fig', '.swc', '.bs', '.st'],
      mimeTypes: ['application/x-snes-rom', 'application/octet-stream'],
      emulator: 'snes9x',
      cores: ['snes9x', 'bsnes', 'bsnes_balanced'],
      biosRequired: false,
      maxSize: 6 * 1024 * 1024, // 6MB
      description: 'Super Nintendo Entertainment System'
    },
    n64: {
      extensions: ['.n64', '.v64', '.z64', '.rom', '.ndd'],
      mimeTypes: ['application/x-n64-rom', 'application/octet-stream'],
      emulator: 'mupen64plus',
      cores: ['mupen64plus_next', 'parallel_n64'],
      biosRequired: false,
      maxSize: 64 * 1024 * 1024, // 64MB
      description: 'Nintendo 64'
    },
    gameboy: {
      extensions: ['.gb', '.gbc', '.sgb', '.dmg'],
      mimeTypes: ['application/x-gameboy-rom', 'application/octet-stream'],
      emulator: 'gambatte',
      cores: ['gambatte', 'sameboy', 'tgbdual'],
      biosRequired: false,
      maxSize: 8 * 1024 * 1024, // 8MB
      description: 'Game Boy / Game Boy Color'
    },
    gba: {
      extensions: ['.gba', '.agb', '.bin', '.elf'],
      mimeTypes: ['application/x-gba-rom', 'application/octet-stream'],
      emulator: 'mgba',
      cores: ['mgba', 'vba_next', 'vbam'],
      biosRequired: true,
      biosFiles: ['gba_bios.bin'],
      maxSize: 32 * 1024 * 1024, // 32MB
      description: 'Game Boy Advance'
    },
    ds: {
      extensions: ['.nds', '.ids'],
      mimeTypes: ['application/x-nintendo-ds-rom', 'application/octet-stream'],
      emulator: 'desmume',
      cores: ['desmume', 'melonds'],
      biosRequired: true,
      biosFiles: ['bios7.bin', 'bios9.bin', 'firmware.bin'],
      maxSize: 512 * 1024 * 1024, // 512MB
      description: 'Nintendo DS'
    }
  },
  sega: {
    genesis: {
      extensions: ['.md', '.gen', '.smd', '.bin', '.rom'],
      mimeTypes: ['application/x-genesis-rom', 'application/octet-stream'],
      emulator: 'picodrive',
      cores: ['genesis_plus_gx', 'picodrive'],
      biosRequired: false,
      maxSize: 4 * 1024 * 1024, // 4MB
      description: 'Sega Genesis / Mega Drive'
    },
    mastersystem: {
      extensions: ['.sms', '.gg', '.mv', '.rom'],
      mimeTypes: ['application/x-sms-rom', 'application/octet-stream'],
      emulator: 'picodrive',
      cores: ['genesis_plus_gx', 'picodrive'],
      biosRequired: false,
      maxSize: 1024 * 1024, // 1MB
      description: 'Sega Master System / Game Gear'
    },
    saturn: {
      extensions: ['.iso', '.cue', '.ccd', '.mds', '.chd'],
      mimeTypes: ['application/x-saturn-rom', 'application/x-iso9660-image'],
      emulator: 'mednafen_saturn',
      cores: ['mednafen_saturn', 'kronos'],
      biosRequired: true,
      biosFiles: ['sega_101.bin', 'mpr-17933.bin'],
      maxSize: 700 * 1024 * 1024, // 700MB
      description: 'Sega Saturn'
    },
    dreamcast: {
      extensions: ['.cdi', '.gdi', '.iso', '.chd'],
      mimeTypes: ['application/x-dreamcast-rom', 'application/x-iso9660-image'],
      emulator: 'flycast',
      cores: ['flycast', 'redream'],
      biosRequired: true,
      biosFiles: ['dc_boot.bin', 'dc_flash.bin'],
      maxSize: 1024 * 1024 * 1024, // 1GB
      description: 'Sega Dreamcast'
    }
  },
  sony: {
    psx: {
      extensions: ['.bin', '.cue', '.iso', '.img', '.mdf', '.pbp', '.chd', '.ecm'],
      mimeTypes: ['application/x-psx-rom', 'application/x-iso9660-image'],
      emulator: 'mednafen_psx',
      cores: ['mednafen_psx_hw', 'pcsx_rearmed', 'beetle_psx'],
      biosRequired: true,
      biosFiles: ['scph1001.bin', 'scph5501.bin', 'scph7001.bin'],
      maxSize: 700 * 1024 * 1024, // 700MB
      description: 'Sony PlayStation'
    },
    ps2: {
      extensions: ['.iso', '.bin', '.mdf', '.nrg', '.img', '.chd'],
      mimeTypes: ['application/x-ps2-rom', 'application/x-iso9660-image'],
      emulator: 'pcsx2',
      cores: ['pcsx2'],
      biosRequired: true,
      biosFiles: ['ps2-0100a-20011027.bin', 'ps2-0120a-20020207.bin'],
      maxSize: 4.7 * 1024 * 1024 * 1024, // 4.7GB (DVD)
      description: 'Sony PlayStation 2'
    },
    psp: {
      extensions: ['.iso', '.cso', '.dax', '.pbp', '.elf'],
      mimeTypes: ['application/x-psp-rom', 'application/x-iso9660-image'],
      emulator: 'ppsspp',
      cores: ['ppsspp'],
      biosRequired: false,
      maxSize: 1.8 * 1024 * 1024 * 1024, // 1.8GB (UMD)
      description: 'Sony PlayStation Portable'
    }
  },
  arcade: {
    mame: {
      extensions: ['.zip', '.7z', '.rar', '.chd'],
      mimeTypes: ['application/zip', 'application/x-7z-compressed', 'application/x-rar-compressed'],
      emulator: 'mame',
      cores: ['mame', 'mame2003_plus', 'fbneo'],
      biosRequired: false,
      maxSize: 700 * 1024 * 1024, // 700MB
      description: 'MAME Arcade'
    },
    neogeo: {
      extensions: ['.zip', '.neo', '.7z'],
      mimeTypes: ['application/zip', 'application/x-7z-compressed'],
      emulator: 'fbneo',
      cores: ['fbneo', 'mame'],
      biosRequired: true,
      biosFiles: ['neogeo.zip'],
      maxSize: 100 * 1024 * 1024, // 100MB
      description: 'Neo Geo'
    },
    cps: {
      extensions: ['.zip', '.7z'],
      mimeTypes: ['application/zip', 'application/x-7z-compressed'],
      emulator: 'fbneo',
      cores: ['fbneo', 'mame2003_plus'],
      biosRequired: false,
      maxSize: 50 * 1024 * 1024, // 50MB
      description: 'Capcom Play System'
    }
  },
  computer: {
    dos: {
      extensions: ['.exe', '.com', '.bat', '.img', '.ima', '.vhd', '.zip'],
      mimeTypes: ['application/x-msdos-program', 'application/x-disk-image', 'application/zip'],
      emulator: 'dosbox',
      cores: ['dosbox_pure', 'dosbox_core'],
      biosRequired: false,
      maxSize: 100 * 1024 * 1024, // 100MB
      description: 'MS-DOS'
    },
    amiga: {
      extensions: ['.adf', '.dms', '.fdi', '.ipf', '.hdf', '.lha'],
      mimeTypes: ['application/x-amiga-disk', 'application/x-lzh-compressed'],
      emulator: 'puae',
      cores: ['puae', 'uae4arm'],
      biosRequired: true,
      biosFiles: ['kick31.rom', 'kick13.rom'],
      maxSize: 10 * 1024 * 1024, // 10MB
      description: 'Commodore Amiga'
    },
    c64: {
      extensions: ['.d64', '.t64', '.prg', '.p00', '.crt', '.tap'],
      mimeTypes: ['application/x-c64-disk', 'application/x-c64-tape'],
      emulator: 'vice',
      cores: ['vice_x64', 'vice_x128'],
      biosRequired: false,
      maxSize: 1024 * 1024, // 1MB
      description: 'Commodore 64'
    },
    atari2600: {
      extensions: ['.a26', '.bin', '.rom'],
      mimeTypes: ['application/x-atari-2600-rom', 'application/octet-stream'],
      emulator: 'stella',
      cores: ['stella'],
      biosRequired: false,
      maxSize: 1024 * 1024, // 1MB
      description: 'Atari 2600'
    }
  }
};

// Main configuration object
export const config = {
  // Server configuration
  server: {
    port: env.PORT,
    host: env.HOST,
    environment: env.NODE_ENV,
  },
  
  // Database configuration
  database: {
    url: env.DATABASE_URL,
  },
  
  // Redis configuration
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
  },
  
  // Storage configuration
  storage: {
    uploadDir: path.resolve(env.UPLOAD_DIR),
    romDir: path.resolve(env.ROM_DIR),
    mediaDir: path.resolve(env.MEDIA_DIR),
    biosDir: path.resolve(env.BIOS_DIR),
    tempDir: path.resolve(env.TEMP_DIR),
  },
  
  // Upload configuration
  upload: {
    maxFileSize: env.MAX_FILE_SIZE,
    chunkSize: env.CHUNK_SIZE,
    timeout: env.UPLOAD_TIMEOUT,
    allowedExtensions: Object.values(ROM_FORMATS)
      .flatMap(category => Object.values(category))
      .flatMap(format => format.extensions),
  },
  
  // Frontend configuration
  frontend: {
    url: env.FRONTEND_URL,
  },
  
  // API keys for metadata scraping
  apis: {
    igdb: {
      clientId: env.IGDB_CLIENT_ID,
      clientSecret: env.IGDB_CLIENT_SECRET,
    },
    thegamesdb: {
      apiKey: env.THEGAMESDB_API_KEY,
    },
    screenscraper: {
      username: env.SCREENSCRAPER_USERNAME,
      password: env.SCREENSCRAPER_PASSWORD,
    },
  },
  
  // Security configuration
  security: {
    jwtSecret: env.JWT_SECRET,
    rateLimit: {
      max: env.RATE_LIMIT_MAX,
      windowMs: env.RATE_LIMIT_WINDOW * 60 * 1000, // Convert to milliseconds
    },
  },
  
  // Processing configuration
  processing: {
    enableVirusScan: env.ENABLE_VIRUS_SCAN,
    clamav: {
      host: env.CLAMAV_HOST,
      port: env.CLAMAV_PORT,
    },
  },
  
  // Logging configuration
  logging: {
    level: env.LOG_LEVEL,
  },
  
  // ROM formats
  romFormats: ROM_FORMATS,
};

// Helper functions
export function getPlatformByExtension(extension: string): string | null {
  for (const [category, platforms] of Object.entries(ROM_FORMATS)) {
    for (const [platformId, platform] of Object.entries(platforms)) {
      if (platform.extensions.includes(extension.toLowerCase())) {
        return platformId;
      }
    }
  }
  return null;
}

export function getPlatformConfig(platformId: string): RomFormat | null {
  for (const [category, platforms] of Object.entries(ROM_FORMATS)) {
    if (platforms[platformId]) {
      return platforms[platformId];
    }
  }
  return null;
}

export function getAllPlatforms(): Array<{ id: string; config: RomFormat; category: string }> {
  const platforms: Array<{ id: string; config: RomFormat; category: string }> = [];
  
  for (const [category, platformConfigs] of Object.entries(ROM_FORMATS)) {
    for (const [platformId, config] of Object.entries(platformConfigs)) {
      platforms.push({ id: platformId, config, category });
    }
  }
  
  return platforms;
}

export function isValidFileExtension(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  return config.upload.allowedExtensions.includes(extension);
}

export function getMaxFileSize(platformId?: string): number {
  if (platformId) {
    const platformConfig = getPlatformConfig(platformId);
    if (platformConfig?.maxSize) {
      return platformConfig.maxSize;
    }
  }
  return config.upload.maxFileSize;
}

export default config;