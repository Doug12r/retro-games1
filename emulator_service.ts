import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '../config';

// =====================================================
// COMPREHENSIVE EMULATOR CONFIGURATION
// =====================================================

export interface EmulatorCore {
  name: string;
  core: string;
  wasm: boolean;
  performance: 'excellent' | 'good' | 'fair' | 'poor';
  fileSize?: number;
  url?: string;
}

export interface PlatformEmulatorConfig {
  fileExtensions: string[];
  browserEmulators: EmulatorCore[];
  retroarchCores: string[];
  biosRequired: boolean;
  biosFiles?: string[];
  controllerSupport: boolean;
  saveStates: boolean;
  defaultCore: string;
  requiresNative?: boolean;
  mobileOptimized?: boolean;
}

export const UNIVERSAL_EMULATOR_CONFIG: Record<string, Record<string, PlatformEmulatorConfig>> = {
  nintendo: {
    nes: {
      fileExtensions: ['.nes', '.unif', '.fds', '.nsf', '.unf'],
      browserEmulators: [
        {
          name: 'EmulatorJS-NES',
          core: 'nestopia',
          wasm: true,
          performance: 'excellent',
          fileSize: 1.2 * 1024 * 1024,
          url: '/emulators/cores/nestopia.wasm'
        },
        {
          name: 'JSNES',
          core: 'jsnes',
          wasm: false,
          performance: 'good',
          fileSize: 512 * 1024,
          url: '/emulators/cores/jsnes.js'
        }
      ],
      retroarchCores: ['nestopia', 'fceumm', 'mesen', 'quicknes'],
      biosRequired: false,
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'nestopia',
      mobileOptimized: true
    },
    
    snes: {
      fileExtensions: ['.sfc', '.smc', '.fig', '.swc', '.bs', '.st'],
      browserEmulators: [
        {
          name: 'EmulatorJS-SNES',
          core: 'snes9x',
          wasm: true,
          performance: 'excellent',
          fileSize: 2.1 * 1024 * 1024,
          url: '/emulators/cores/snes9x.wasm'
        }
      ],
      retroarchCores: ['snes9x', 'bsnes', 'bsnes_balanced', 'bsnes_performance'],
      biosRequired: false,
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'snes9x',
      mobileOptimized: true
    },
    
    n64: {
      fileExtensions: ['.n64', '.v64', '.z64', '.rom', '.ndd'],
      browserEmulators: [], // Too demanding for browser
      retroarchCores: ['mupen64plus_next', 'parallel_n64'],
      biosRequired: false,
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'mupen64plus_next',
      requiresNative: true
    },
    
    gameboy: {
      fileExtensions: ['.gb', '.gbc', '.sgb', '.dmg'],
      browserEmulators: [
        {
          name: 'EmulatorJS-GB',
          core: 'gambatte',
          wasm: true,
          performance: 'excellent',
          fileSize: 800 * 1024,
          url: '/emulators/cores/gambatte.wasm'
        }
      ],
      retroarchCores: ['gambatte', 'sameboy', 'tgbdual'],
      biosRequired: false,
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'gambatte',
      mobileOptimized: true
    },
    
    gba: {
      fileExtensions: ['.gba', '.agb', '.bin', '.elf'],
      browserEmulators: [
        {
          name: 'EmulatorJS-GBA',
          core: 'mgba',
          wasm: true,
          performance: 'good',
          fileSize: 1.8 * 1024 * 1024,
          url: '/emulators/cores/mgba.wasm'
        }
      ],
      retroarchCores: ['mgba', 'vba_next', 'vbam'],
      biosRequired: false, // Optional for better compatibility
      biosFiles: ['gba_bios.bin'],
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'mgba',
      mobileOptimized: true
    }
  },
  
  sega: {
    genesis: {
      fileExtensions: ['.md', '.gen', '.smd', '.bin', '.rom'],
      browserEmulators: [
        {
          name: 'EmulatorJS-Genesis',
          core: 'genesis_plus_gx',
          wasm: true,
          performance: 'excellent',
          fileSize: 1.5 * 1024 * 1024,
          url: '/emulators/cores/genesis_plus_gx.wasm'
        }
      ],
      retroarchCores: ['genesis_plus_gx', 'picodrive'],
      biosRequired: false,
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'genesis_plus_gx',
      mobileOptimized: true
    },
    
    saturn: {
      fileExtensions: ['.iso', '.cue', '.ccd', '.mds', '.chd'],
      browserEmulators: [], // Too demanding
      retroarchCores: ['mednafen_saturn', 'kronos'],
      biosRequired: true,
      biosFiles: ['sega_101.bin', 'mpr-17933.bin'],
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'mednafen_saturn',
      requiresNative: true
    }
  },
  
  sony: {
    psx: {
      fileExtensions: ['.bin', '.cue', '.iso', '.img', '.mdf', '.pbp', '.chd', '.ecm'],
      browserEmulators: [
        {
          name: 'EmulatorJS-PSX',
          core: 'mednafen_psx',
          wasm: true,
          performance: 'fair',
          fileSize: 3.2 * 1024 * 1024,
          url: '/emulators/cores/mednafen_psx.wasm'
        }
      ],
      retroarchCores: ['mednafen_psx_hw', 'pcsx_rearmed', 'beetle_psx'],
      biosRequired: true,
      biosFiles: ['scph1001.bin', 'scph5501.bin', 'scph7001.bin'],
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'pcsx_rearmed'
    },
    
    ps2: {
      fileExtensions: ['.iso', '.bin', '.mdf', '.nrg', '.img', '.chd'],
      browserEmulators: [], // Too demanding
      retroarchCores: ['pcsx2'],
      biosRequired: true,
      biosFiles: ['ps2-0100a-20011027.bin', 'ps2-0120a-20020207.bin'],
      controllerSupport: true,
      saveStates: false, // Limited support
      defaultCore: 'pcsx2',
      requiresNative: true
    }
  },
  
  arcade: {
    mame: {
      fileExtensions: ['.zip', '.7z', '.rar', '.chd'],
      browserEmulators: [
        {
          name: 'EmulatorJS-MAME',
          core: 'mame2003_plus',
          wasm: true,
          performance: 'good',
          fileSize: 4.5 * 1024 * 1024,
          url: '/emulators/cores/mame2003_plus.wasm'
        }
      ],
      retroarchCores: ['mame', 'mame2003_plus', 'mame2010', 'fbneo'],
      biosRequired: false, // Game-dependent
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'mame2003_plus'
    },
    
    neogeo: {
      fileExtensions: ['.zip', '.neo', '.7z'],
      browserEmulators: [
        {
          name: 'EmulatorJS-NeoGeo',
          core: 'fbneo',
          wasm: true,
          performance: 'good',
          fileSize: 2.8 * 1024 * 1024,
          url: '/emulators/cores/fbneo.wasm'
        }
      ],
      retroarchCores: ['fbneo', 'mame'],
      biosRequired: true,
      biosFiles: ['neogeo.zip'],
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'fbneo'
    }
  },
  
  computer: {
    dos: {
      fileExtensions: ['.exe', '.com', '.bat', '.img', '.ima', '.vhd', '.zip'],
      browserEmulators: [
        {
          name: 'js-dos',
          core: 'dosbox',
          wasm: true,
          performance: 'excellent',
          fileSize: 2.5 * 1024 * 1024,
          url: '/emulators/cores/dosbox.wasm'
        },
        {
          name: 'EmulatorJS-DOS',
          core: 'dosbox_pure',
          wasm: true,
          performance: 'excellent',
          fileSize: 2.2 * 1024 * 1024,
          url: '/emulators/cores/dosbox_pure.wasm'
        }
      ],
      retroarchCores: ['dosbox_pure', 'dosbox_core'],
      biosRequired: false,
      controllerSupport: true,
      saveStates: true,
      defaultCore: 'dosbox_pure',
      mobileOptimized: true
    }
  }
};

// =====================================================
// SAVE STATE MANAGEMENT
// =====================================================

export interface SaveState {
  id: string;
  gameId: string;
  userId?: string;
  slotNumber: number;
  name: string;
  description?: string;
  screenshot: string;
  saveData: Buffer;
  metadata: {
    platform: string;
    core: string;
    timestamp: Date;
    gameTime?: number;
    level?: string;
    score?: number;
  };
  createdAt: Date;
  fileSize: number;
}

export interface EmulatorSession {
  id: string;
  gameId: string;
  userId?: string;
  platform: string;
  core: string;
  emulatorType: 'browser' | 'native';
  status: 'starting' | 'running' | 'paused' | 'stopped' | 'error';
  startTime: Date;
  lastActivity: Date;
  metrics: EmulatorMetrics;
  nativeProcess?: ChildProcess;
  streamUrl?: string;
  websocket?: WebSocket;
}

export interface EmulatorMetrics {
  fps: number;
  frameSkip: number;
  audioLatency: number;
  inputLatency: number;
  cpuUsage: number;
  memoryUsage: number;
  temperature?: number;
  batteryLevel?: number;
}

// =====================================================
// UNIVERSAL EMULATOR SERVICE
// =====================================================

export class UniversalEmulatorService {
  private prisma: PrismaClient;
  private activeSessions = new Map<string, EmulatorSession>();
  private retroarchPath: string;
  private biosPath: string;
  private saveStatePath: string;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.retroarchPath = config.emulation?.retroarchPath || '/usr/bin/retroarch';
    this.biosPath = config.storage.biosDir;
    this.saveStatePath = path.join(config.storage.tempDir, 'savestates');
    this.initializePaths();
  }

  private async initializePaths(): Promise<void> {
    await fs.mkdir(this.saveStatePath, { recursive: true });
    await fs.mkdir(this.biosPath, { recursive: true });
  }

  // =====================================================
  // EMULATOR DETECTION & INITIALIZATION
  // =====================================================

  async getEmulatorConfig(gameId: string): Promise<{
    platformConfig: PlatformEmulatorConfig;
    recommendedEmulator: 'browser' | 'native';
    availableEmulators: EmulatorCore[];
    requiredBios: string[];
  }> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { platform: true }
    });

    if (!game) {
      throw new Error('Game not found');
    }

    const platformConfig = this.getPlatformConfig(game.platformId);
    const userAgent = this.detectUserAgent();
    
    const recommendedEmulator = this.selectOptimalEmulator(platformConfig, userAgent);
    const availableEmulators = this.getAvailableEmulators(platformConfig, userAgent);
    const requiredBios = await this.checkRequiredBios(platformConfig);

    return {
      platformConfig,
      recommendedEmulator,
      availableEmulators,
      requiredBios
    };
  }

  private getPlatformConfig(platformId: string): PlatformEmulatorConfig {
    for (const [category, platforms] of Object.entries(UNIVERSAL_EMULATOR_CONFIG)) {
      if (platforms[platformId]) {
        return platforms[platformId];
      }
    }
    throw new Error(`No emulator configuration found for platform: ${platformId}`);
  }

  private detectUserAgent(): {
    isMobile: boolean;
    isTablet: boolean;
    browserEngine: string;
    supportsWasm: boolean;
    supportsWebGL: boolean;
    performanceLevel: 'high' | 'medium' | 'low';
  } {
    // This would typically come from request headers
    return {
      isMobile: false,
      isTablet: false,
      browserEngine: 'chromium',
      supportsWasm: true,
      supportsWebGL: true,
      performanceLevel: 'high'
    };
  }

  private selectOptimalEmulator(
    config: PlatformEmulatorConfig, 
    userAgent: any
  ): 'browser' | 'native' {
    if (config.requiresNative) return 'native';
    if (userAgent.isMobile && !config.mobileOptimized) return 'native';
    if (config.browserEmulators.length === 0) return 'native';
    if (userAgent.performanceLevel === 'low') return 'native';
    return 'browser';
  }

  private getAvailableEmulators(config: PlatformEmulatorConfig, userAgent: any): EmulatorCore[] {
    const available: EmulatorCore[] = [];
    
    // Add browser emulators if supported
    if (userAgent.supportsWasm) {
      available.push(...config.browserEmulators.filter(e => e.wasm));
    }
    available.push(...config.browserEmulators.filter(e => !e.wasm));
    
    // Add native emulators
    available.push(...config.retroarchCores.map(core => ({
      name: `RetroArch-${core}`,
      core,
      wasm: false,
      performance: 'excellent' as const
    })));

    return available;
  }

  private async checkRequiredBios(config: PlatformEmulatorConfig): Promise<string[]> {
    if (!config.biosRequired || !config.biosFiles) return [];
    
    const missing: string[] = [];
    for (const biosFile of config.biosFiles) {
      const biosPath = path.join(this.biosPath, biosFile);
      try {
        await fs.access(biosPath);
      } catch {
        missing.push(biosFile);
      }
    }
    return missing;
  }

  // =====================================================
  // BROWSER EMULATOR MANAGEMENT
  // =====================================================

  async startBrowserEmulator(
    gameId: string, 
    coreId: string,
    userId?: string
  ): Promise<{
    sessionId: string;
    config: any;
    romUrl: string;
    biosUrls: string[];
    coreUrl: string;
  }> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId }
    });

    if (!game) {
      throw new Error('Game not found');
    }

    const platformConfig = this.getPlatformConfig(game.platformId);
    const selectedCore = platformConfig.browserEmulators.find(e => e.core === coreId);
    
    if (!selectedCore) {
      throw new Error(`Core ${coreId} not available for browser emulation`);
    }

    // Create session
    const session: EmulatorSession = {
      id: crypto.randomUUID(),
      gameId,
      userId,
      platform: game.platformId,
      core: coreId,
      emulatorType: 'browser',
      status: 'starting',
      startTime: new Date(),
      lastActivity: new Date(),
      metrics: this.getInitialMetrics()
    };

    this.activeSessions.set(session.id, session);

    // Generate URLs
    const romUrl = `/api/games/${gameId}/rom`;
    const biosUrls = await this.generateBiosUrls(platformConfig);
    const coreUrl = selectedCore.url || `/emulators/cores/${selectedCore.core}.js`;

    // Create emulator configuration
    const emulatorConfig = {
      EJS_player: '#emulator-canvas',
      EJS_gameUrl: romUrl,
      EJS_biosUrl: biosUrls.length > 0 ? biosUrls[0] : undefined,
      EJS_core: selectedCore.core,
      EJS_mouse: false,
      EJS_multitap: platformConfig.controllerSupport,
      EJS_lightgun: false,
      EJS_cheats: true,
      EJS_saveStates: platformConfig.saveStates,
      EJS_startOnLoaded: true,
      EJS_color: '#0066cc',
      EJS_VirtualGamepadSettings: this.getVirtualGamepadConfig(game.platformId),
      EJS_onGameStart: () => this.onBrowserGameStart(session.id),
      EJS_onSaveState: (state: any) => this.onSaveStateCreated(session.id, state),
      EJS_onLoadState: (state: any) => this.onSaveStateLoaded(session.id, state)
    };

    logger.info(`Started browser emulator session ${session.id} for game ${gameId}`);

    return {
      sessionId: session.id,
      config: emulatorConfig,
      romUrl,
      biosUrls,
      coreUrl
    };
  }

  private async generateBiosUrls(config: PlatformEmulatorConfig): Promise<string[]> {
    if (!config.biosFiles) return [];
    
    const urls: string[] = [];
    for (const biosFile of config.biosFiles) {
      const biosPath = path.join(this.biosPath, biosFile);
      try {
        await fs.access(biosPath);
        urls.push(`/api/bios/${biosFile}`);
      } catch {
        logger.warn(`BIOS file not found: ${biosFile}`);
      }
    }
    return urls;
  }

  private getVirtualGamepadConfig(platform: string): any {
    const baseConfig = {
      showGamepad: true,
      gamepadOpacity: 0.7,
      gamepadSize: 1.0,
      gamepadPosition: 'bottom'
    };

    // Platform-specific customizations
    switch (platform) {
      case 'nes':
        return {
          ...baseConfig,
          buttons: ['B', 'A', 'SELECT', 'START']
        };
      case 'snes':
        return {
          ...baseConfig,
          buttons: ['Y', 'X', 'B', 'A', 'SELECT', 'START', 'L', 'R']
        };
      case 'gba':
        return {
          ...baseConfig,
          buttons: ['B', 'A', 'SELECT', 'START', 'L', 'R']
        };
      default:
        return baseConfig;
    }
  }

  // =====================================================
  // NATIVE EMULATOR MANAGEMENT
  // =====================================================

  async startNativeEmulator(
    gameId: string, 
    coreId: string,
    userId?: string,
    streamConfig?: {
      resolution: '720p' | '1080p' | '1440p';
      framerate: 30 | 60;
      codec: 'h264' | 'h265';
      enableAudio: boolean;
    }
  ): Promise<{
    sessionId: string;
    streamUrl?: string;
    vncUrl?: string;
    webrtcOffer?: RTCSessionDescriptionInit;
  }> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId }
    });

    if (!game) {
      throw new Error('Game not found');
    }

    const platformConfig = this.getPlatformConfig(game.platformId);
    
    if (!platformConfig.retroarchCores.includes(coreId)) {
      throw new Error(`Core ${coreId} not available for platform ${game.platformId}`);
    }

    // Create session
    const session: EmulatorSession = {
      id: crypto.randomUUID(),
      gameId,
      userId,
      platform: game.platformId,
      core: coreId,
      emulatorType: 'native',
      status: 'starting',
      startTime: new Date(),
      lastActivity: new Date(),
      metrics: this.getInitialMetrics()
    };

    this.activeSessions.set(session.id, session);

    try {
      // Start RetroArch process
      const retroarchArgs = this.buildRetroArchArgs(game.filePath, coreId, session.id, streamConfig);
      const process = spawn(this.retroarchPath, retroarchArgs, {
        cwd: config.storage.tempDir,
        env: {
          ...process.env,
          DISPLAY: `:${this.getNextDisplayNumber()}`,
          SDL_VIDEODRIVER: 'x11'
        }
      });

      session.nativeProcess = process;
      session.status = 'running';

      // Handle process events
      process.stdout?.on('data', (data) => {
        logger.debug(`RetroArch stdout: ${data}`);
        this.updateSessionMetrics(session.id, data.toString());
      });

      process.stderr?.on('data', (data) => {
        logger.warn(`RetroArch stderr: ${data}`);
      });

      process.on('exit', (code) => {
        logger.info(`RetroArch process exited with code ${code}`);
        session.status = 'stopped';
        this.cleanupSession(session.id);
      });

      process.on('error', (error) => {
        logger.error(`RetroArch process error: ${error}`);
        session.status = 'error';
        this.cleanupSession(session.id);
      });

      // Setup streaming if requested
      let streamUrl: string | undefined;
      let vncUrl: string | undefined;
      let webrtcOffer: RTCSessionDescriptionInit | undefined;

      if (streamConfig) {
        const streamResult = await this.setupStreaming(session, streamConfig);
        streamUrl = streamResult.streamUrl;
        vncUrl = streamResult.vncUrl;
        webrtcOffer = streamResult.webrtcOffer;
      }

      logger.info(`Started native emulator session ${session.id} for game ${gameId}`);

      return {
        sessionId: session.id,
        streamUrl,
        vncUrl,
        webrtcOffer
      };

    } catch (error) {
      this.activeSessions.delete(session.id);
      logger.error(`Failed to start native emulator: ${error}`);
      throw error;
    }
  }

  private buildRetroArchArgs(
    romPath: string, 
    core: string, 
    sessionId: string,
    streamConfig?: any
  ): string[] {
    const configPath = path.join(config.storage.tempDir, `retroarch-${sessionId}.cfg`);
    
    const args = [
      '-L', `/usr/lib/libretro/${core}_libretro.so`,
      '--config', configPath,
      '--save-path', path.join(config.storage.tempDir, 'saves'),
      '--savestate-path', this.saveStatePath,
      '--system-path', this.biosPath,
      '--verbose'
    ];

    if (streamConfig) {
      args.push(
        '--record', path.join(config.storage.tempDir, `stream-${sessionId}.mkv`),
        '--record-config-path', this.getStreamConfigPath(streamConfig)
      );
    }

    args.push(romPath);
    return args;
  }

  private getNextDisplayNumber(): number {
    // Simple display number allocation
    return Math.floor(Math.random() * 1000) + 1000;
  }

  private async setupStreaming(
    session: EmulatorSession, 
    config: any
  ): Promise<{
    streamUrl?: string;
    vncUrl?: string;
    webrtcOffer?: RTCSessionDescriptionInit;
  }> {
    // This would implement VNC and WebRTC streaming
    // For now, return mock URLs
    return {
      vncUrl: `ws://localhost:5900/websockify?session=${session.id}`,
      streamUrl: `rtmp://localhost:1935/live/${session.id}`
    };
  }

  private getStreamConfigPath(config: any): string {
    // Generate FFmpeg configuration for streaming
    return path.join(config.storage.tempDir, 'stream.cfg');
  }

  // =====================================================
  // SAVE STATE MANAGEMENT
  // =====================================================

  async createSaveState(
    sessionId: string,
    slotNumber: number,
    name: string,
    description?: string
  ): Promise<SaveState> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const saveStateId = crypto.randomUUID();
    const timestamp = new Date();
    
    let saveData: Buffer;
    let screenshot: string;

    if (session.emulatorType === 'browser') {
      // Browser save state handled by client
      throw new Error('Browser save states must be created from client');
    } else {
      // Native save state via RetroArch
      const saveStatePath = path.join(this.saveStatePath, `${saveStateId}.state`);
      const screenshotPath = path.join(this.saveStatePath, `${saveStateId}.png`);
      
      // Send save state command to RetroArch
      if (session.nativeProcess) {
        session.nativeProcess.stdin?.write('SAVE_STATE\n');
        // Wait for save state file to be created
        await this.waitForFile(saveStatePath, 5000);
        await this.waitForFile(screenshotPath, 5000);
        
        saveData = await fs.readFile(saveStatePath);
        screenshot = `data:image/png;base64,${(await fs.readFile(screenshotPath)).toString('base64')}`;
      } else {
        throw new Error('Native process not available');
      }
    }

    const saveState: SaveState = {
      id: saveStateId,
      gameId: session.gameId,
      userId: session.userId,
      slotNumber,
      name,
      description,
      screenshot,
      saveData,
      metadata: {
        platform: session.platform,
        core: session.core,
        timestamp,
        gameTime: Date.now() - session.startTime.getTime()
      },
      createdAt: timestamp,
      fileSize: saveData.length
    };

    // Store in database
    await this.prisma.saveState.create({
      data: {
        id: saveState.id,
        gameId: saveState.gameId,
        name: saveState.name,
        description: saveState.description,
        filePath: path.join(this.saveStatePath, `${saveStateId}.state`),
        fileSize: saveState.fileSize,
        slotNumber: saveState.slotNumber
      }
    });

    logger.info(`Created save state ${saveStateId} for session ${sessionId}`);
    return saveState;
  }

  async loadSaveState(sessionId: string, saveStateId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const saveState = await this.prisma.saveState.findUnique({
      where: { id: saveStateId }
    });

    if (!saveState) {
      throw new Error('Save state not found');
    }

    if (session.emulatorType === 'browser') {
      // Browser load state handled by client
      throw new Error('Browser save state loading must be handled by client');
    } else {
      // Native load state via RetroArch
      if (session.nativeProcess) {
        const saveStatePath = path.join(this.saveStatePath, `${saveStateId}.state`);
        await fs.copyFile(saveState.filePath, saveStatePath);
        session.nativeProcess.stdin?.write('LOAD_STATE\n');
      } else {
        throw new Error('Native process not available');
      }
    }

    logger.info(`Loaded save state ${saveStateId} for session ${sessionId}`);
  }

  async getSaveStates(gameId: string, userId?: string): Promise<SaveState[]> {
    const saveStates = await this.prisma.saveState.findMany({
      where: {
        gameId,
        // Add userId filter if needed
      },
      orderBy: { createdAt: 'desc' }
    });

    // Convert to SaveState format with screenshot data
    const result: SaveState[] = [];
    for (const state of saveStates) {
      const screenshotPath = path.join(this.saveStatePath, `${state.id}.png`);
      let screenshot = '';
      try {
        const screenshotData = await fs.readFile(screenshotPath);
        screenshot = `data:image/png;base64,${screenshotData.toString('base64')}`;
      } catch {
        // Use default screenshot
        screenshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      }

      result.push({
        id: state.id,
        gameId: state.gameId,
        userId,
        slotNumber: state.slotNumber || 0,
        name: state.name,
        description: state.description,
        screenshot,
        saveData: Buffer.alloc(0), // Don't load actual save data unless needed
        metadata: {
          platform: '',
          core: '',
          timestamp: state.createdAt
        },
        createdAt: state.createdAt,
        fileSize: state.fileSize
      });
    }

    return result;
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  async getSession(sessionId: string): Promise<EmulatorSession | null> {
    return this.activeSessions.get(sessionId) || null;
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.nativeProcess) {
      session.nativeProcess.kill('SIGTERM');
    }

    session.status = 'stopped';
    await this.cleanupSession(sessionId);
    
    logger.info(`Stopped emulator session ${sessionId}`);
  }

  async pauseSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.nativeProcess) {
      session.nativeProcess.kill('SIGSTOP');
    }

    session.status = 'paused';
    logger.info(`Paused emulator session ${sessionId}`);
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.nativeProcess) {
      session.nativeProcess.kill('SIGCONT');
    }

    session.status = 'running';
    session.lastActivity = new Date();
    logger.info(`Resumed emulator session ${sessionId}`);
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      // Clean up temporary files
      const tempFiles = [
        path.join(config.storage.tempDir, `retroarch-${sessionId}.cfg`),
        path.join(config.storage.tempDir, `stream-${sessionId}.mkv`)
      ];

      for (const file of tempFiles) {
        try {
          await fs.unlink(file);
        } catch {
          // Ignore cleanup errors
        }
      }

      this.activeSessions.delete(sessionId);
    }
  }

  // =====================================================
  // METRICS & MONITORING
  // =====================================================

  private getInitialMetrics(): EmulatorMetrics {
    return {
      fps: 0,
      frameSkip: 0,
      audioLatency: 0,
      inputLatency: 0,
      cpuUsage: 0,
      memoryUsage: 0
    };
  }

  private updateSessionMetrics(sessionId: string, logData: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Parse metrics from RetroArch output
    const fpsMatch = logData.match(/FPS:\s*(\d+\.?\d*)/);
    if (fpsMatch) {
      session.metrics.fps = parseFloat(fpsMatch[1]);
    }

    const skipMatch = logData.match(/Skip:\s*(\d+)/);
    if (skipMatch) {
      session.metrics.frameSkip = parseInt(skipMatch[1]);
    }

    session.lastActivity = new Date();
  }

  async getSessionMetrics(sessionId: string): Promise<EmulatorMetrics | null> {
    const session = this.activeSessions.get(sessionId);
    return session?.metrics || null;
  }

  // =====================================================
  // EVENT HANDLERS
  // =====================================================

  private onBrowserGameStart(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = 'running';
      logger.info(`Browser emulator started for session ${sessionId}`);
    }
  }

  private onSaveStateCreated(sessionId: string, state: any): void {
    logger.info(`Save state created for session ${sessionId}`);
    // Handle browser save state
  }

  private onSaveStateLoaded(sessionId: string, state: any): void {
    logger.info(`Save state loaded for session ${sessionId}`);
    // Handle browser save state
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  private async waitForFile(filePath: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        await fs.access(filePath);
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw new Error(`File ${filePath} not created within timeout`);
  }

  async getSystemStatus(): Promise<{
    activeSessions: number;
    supportedPlatforms: string[];
    availableCores: Record<string, string[]>;
    biosStatus: Record<string, boolean>;
    performance: {
      averageFps: number;
      activeStreams: number;
      systemLoad: number;
    };
  }> {
    const supportedPlatforms: string[] = [];
    const availableCores: Record<string, string[]> = {};
    
    for (const [category, platforms] of Object.entries(UNIVERSAL_EMULATOR_CONFIG)) {
      for (const [platformId, config] of Object.entries(platforms)) {
        supportedPlatforms.push(platformId);
        availableCores[platformId] = [
          ...config.browserEmulators.map(e => e.core),
          ...config.retroarchCores
        ];
      }
    }

    const biosStatus: Record<string, boolean> = {};
    for (const [category, platforms] of Object.entries(UNIVERSAL_EMULATOR_CONFIG)) {
      for (const [platformId, config] of Object.entries(platforms)) {
        if (config.biosFiles) {
          for (const biosFile of config.biosFiles) {
            const biosPath = path.join(this.biosPath, biosFile);
            try {
              await fs.access(biosPath);
              biosStatus[biosFile] = true;
            } catch {
              biosStatus[biosFile] = false;
            }
          }
        }
      }
    }

    const sessions = Array.from(this.activeSessions.values());
    const averageFps = sessions.reduce((sum, s) => sum + s.metrics.fps, 0) / sessions.length || 0;
    const activeStreams = sessions.filter(s => s.streamUrl).length;

    return {
      activeSessions: this.activeSessions.size,
      supportedPlatforms,
      availableCores,
      biosStatus,
      performance: {
        averageFps,
        activeStreams,
        systemLoad: 0 // Would implement actual system monitoring
      }
    };
  }
}

export default UniversalEmulatorService;