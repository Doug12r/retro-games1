import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { config } from '../config';

// =====================================================
// WEBRTC STREAMING SERVICE
// =====================================================

export interface StreamConfig {
  resolution: '720p' | '1080p' | '1440p' | '4k';
  framerate: 30 | 60 | 120;
  bitrate: number;
  codec: 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1';
  audioCodec: 'opus' | 'aac' | 'mp3';
  latency: 'ultra-low' | 'low' | 'normal';
  enableAudio: boolean;
  enableInput: boolean;
  quality: 'ultra' | 'high' | 'medium' | 'low' | 'potato';
}

export interface StreamSession {
  id: string;
  gameId: string;
  userId?: string;
  config: StreamConfig;
  status: 'initializing' | 'ready' | 'streaming' | 'paused' | 'stopped' | 'error';
  startTime: Date;
  lastActivity: Date;
  viewerCount: number;
  bitrate: number;
  latency: number;
  droppedFrames: number;
  ffmpegProcess?: ChildProcess;
  webrtcConnection?: RTCPeerConnection;
  streamUrl?: string;
  playlistUrl?: string;
  dashUrl?: string;
  errors: string[];
}

export interface StreamMetrics {
  sessionId: string;
  timestamp: Date;
  fps: number;
  bitrate: number;
  latency: number;
  droppedFrames: number;
  keyFrames: number;
  audioLatency: number;
  networkJitter: number;
  packetLoss: number;
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage?: number;
  temperature?: number;
}

export interface ViewerSession {
  id: string;
  streamId: string;
  userAgent: string;
  ip: string;
  connectionTime: Date;
  lastActivity: Date;
  websocket?: WebSocket;
  peerConnection?: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  quality: string;
  latency: number;
}

export class StreamingService extends EventEmitter {
  private activeSessions = new Map<string, StreamSession>();
  private activeViewers = new Map<string, ViewerSession>();
  private metricsHistory = new Map<string, StreamMetrics[]>();
  private server: FastifyInstance;
  private stunServers: string[];
  private turnServers: any[];

  constructor(server: FastifyInstance) {
    super();
    this.server = server;
    this.stunServers = [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302'
    ];
    this.turnServers = [
      // Add TURN servers for NAT traversal
    ];
    
    this.initializeCleanupTasks();
  }

  // =====================================================
  // STREAM SESSION MANAGEMENT
  // =====================================================

  async createStreamSession(
    gameId: string,
    userId: string,
    streamConfig: Partial<StreamConfig>
  ): Promise<StreamSession> {
    const sessionId = crypto.randomUUID();
    
    const defaultConfig: StreamConfig = {
      resolution: '1080p',
      framerate: 60,
      bitrate: 5000000, // 5 Mbps
      codec: 'h264',
      audioCodec: 'opus',
      latency: 'low',
      enableAudio: true,
      enableInput: true,
      quality: 'high'
    };

    const finalConfig = { ...defaultConfig, ...streamConfig };
    
    // Optimize config based on device capabilities
    const optimizedConfig = this.optimizeStreamConfig(finalConfig);

    const session: StreamSession = {
      id: sessionId,
      gameId,
      userId,
      config: optimizedConfig,
      status: 'initializing',
      startTime: new Date(),
      lastActivity: new Date(),
      viewerCount: 0,
      bitrate: optimizedConfig.bitrate,
      latency: 0,
      droppedFrames: 0,
      errors: []
    };

    this.activeSessions.set(sessionId, session);
    
    try {
      await this.initializeStream(session);
      session.status = 'ready';
      
      logger.info(`Created stream session ${sessionId} for game ${gameId}`);
      this.emit('streamCreated', session);
      
      return session;
    } catch (error) {
      session.status = 'error';
      session.errors.push(error.message);
      logger.error(`Failed to create stream session ${sessionId}:`, error);
      throw error;
    }
  }

  private optimizeStreamConfig(config: StreamConfig): StreamConfig {
    // Auto-adjust based on resolution
    if (config.resolution === '4k') {
      config.bitrate = Math.max(config.bitrate, 15000000); // 15 Mbps minimum for 4K
      config.framerate = Math.min(config.framerate, 60); // Limit to 60fps for 4K
    } else if (config.resolution === '1440p') {
      config.bitrate = Math.max(config.bitrate, 8000000); // 8 Mbps for 1440p
    } else if (config.resolution === '1080p') {
      config.bitrate = Math.max(config.bitrate, 5000000); // 5 Mbps for 1080p
    } else {
      config.bitrate = Math.max(config.bitrate, 2500000); // 2.5 Mbps for 720p
    }

    // Adjust for latency requirements
    if (config.latency === 'ultra-low') {
      config.framerate = Math.max(config.framerate, 60);
      config.codec = 'h264'; // Better hardware support
    }

    return config;
  }

  private async initializeStream(session: StreamSession): Promise<void> {
    // Create FFmpeg process for streaming
    await this.setupFFmpegStream(session);
    
    // Initialize WebRTC if needed
    if (session.config.latency === 'ultra-low') {
      await this.setupWebRTCStream(session);
    }
    
    // Setup monitoring
    this.startMetricsCollection(session.id);
  }

  // =====================================================
  // FFMPEG STREAMING SETUP
  // =====================================================

  private async setupFFmpegStream(session: StreamSession): Promise<void> {
    const outputDir = path.join(config.storage.tempDir, 'streams', session.id);
    await fs.mkdir(outputDir, { recursive: true });

    const { width, height } = this.getResolutionDimensions(session.config.resolution);
    
    // Build FFmpeg command for multi-format output
    const ffmpegArgs = [
      // Input from X11 display
      '-f', 'x11grab',
      '-video_size', `${width}x${height}`,
      '-framerate', session.config.framerate.toString(),
      '-i', ':99',
      
      // Audio input
      ...(session.config.enableAudio ? [
        '-f', 'pulse',
        '-i', 'default'
      ] : ['-an']),
      
      // Video encoding settings
      '-c:v', this.getVideoEncoder(session.config.codec),
      '-preset', this.getEncodingPreset(session.config.quality),
      '-tune', 'zerolatency',
      '-profile:v', 'high',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
      '-b:v', session.config.bitrate.toString(),
      '-maxrate', (session.config.bitrate * 1.2).toString(),
      '-bufsize', (session.config.bitrate * 2).toString(),
      '-g', (session.config.framerate * 2).toString(), // Keyframe interval
      '-keyint_min', session.config.framerate.toString(),
      '-refs', '1',
      '-bf', '0',
      
      // Audio encoding
      ...(session.config.enableAudio ? [
        '-c:a', this.getAudioEncoder(session.config.audioCodec),
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2'
      ] : []),
      
      // Low latency optimizations
      '-flags', '+cgop',
      '-flags2', '+fast',
      '-movflags', '+faststart',
      '-avoid_negative_ts', 'make_zero',
      '-fflags', '+genpts',
      
      // Multiple outputs
      // HLS for broad compatibility
      '-f', 'hls',
      '-hls_time', session.config.latency === 'ultra-low' ? '1' : '4',
      '-hls_list_size', '3',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', `${outputDir}/segment_%03d.ts`,
      `${outputDir}/playlist.m3u8`,
      
      // DASH for modern browsers
      '-f', 'dash',
      '-adaptation_sets', 'id=0,streams=v id=1,streams=a',
      '-seg_duration', session.config.latency === 'ultra-low' ? '1' : '4',
      '-window_size', '3',
      '-extra_window_size', '5',
      `${outputDir}/manifest.mpd`,
      
      // Raw stream for WebRTC bridge
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1'
    ];

    // Start FFmpeg process
    session.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      cwd: outputDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Setup process monitoring
    session.ffmpegProcess.stdout?.on('data', (data) => {
      this.handleFFmpegOutput(session.id, data);
    });

    session.ffmpegProcess.stderr?.on('data', (data) => {
      this.parseFFmpegStats(session.id, data.toString());
    });

    session.ffmpegProcess.on('exit', (code) => {
      logger.info(`FFmpeg process exited with code ${code} for session ${session.id}`);
      session.status = code === 0 ? 'stopped' : 'error';
      if (code !== 0) {
        session.errors.push(`FFmpeg exited with code ${code}`);
      }
    });

    session.ffmpegProcess.on('error', (error) => {
      logger.error(`FFmpeg process error for session ${session.id}:`, error);
      session.status = 'error';
      session.errors.push(`FFmpeg error: ${error.message}`);
    });

    // Set stream URLs
    session.streamUrl = `http://localhost/streams/${session.id}/playlist.m3u8`;
    session.playlistUrl = `http://localhost/streams/${session.id}/playlist.m3u8`;
    session.dashUrl = `http://localhost/streams/${session.id}/manifest.mpd`;

    // Wait for stream to be ready
    await this.waitForStreamReady(session);
  }

  private getResolutionDimensions(resolution: string): { width: number; height: number } {
    switch (resolution) {
      case '720p': return { width: 1280, height: 720 };
      case '1080p': return { width: 1920, height: 1080 };
      case '1440p': return { width: 2560, height: 1440 };
      case '4k': return { width: 3840, height: 2160 };
      default: return { width: 1920, height: 1080 };
    }
  }

  private getVideoEncoder(codec: string): string {
    switch (codec) {
      case 'h264': return 'libx264';
      case 'h265': return 'libx265';
      case 'vp8': return 'libvpx';
      case 'vp9': return 'libvpx-vp9';
      case 'av1': return 'libaom-av1';
      default: return 'libx264';
    }
  }

  private getAudioEncoder(codec: string): string {
    switch (codec) {
      case 'opus': return 'libopus';
      case 'aac': return 'aac';
      case 'mp3': return 'libmp3lame';
      default: return 'libopus';
    }
  }

  private getEncodingPreset(quality: string): string {
    switch (quality) {
      case 'ultra': return 'placebo';
      case 'high': return 'slow';
      case 'medium': return 'medium';
      case 'low': return 'fast';
      case 'potato': return 'ultrafast';
      default: return 'medium';
    }
  }

  private async waitForStreamReady(session: StreamSession): Promise<void> {
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const playlistPath = session.playlistUrl?.replace('http://localhost', config.storage.tempDir);
        if (playlistPath) {
          await fs.access(playlistPath.replace('/streams/', '/streams/'));
          return; // Stream is ready
        }
      } catch {
        // Stream not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Stream failed to initialize within timeout');
  }

  // =====================================================
  // WEBRTC STREAMING SETUP
  // =====================================================

  private async setupWebRTCStream(session: StreamSession): Promise<void> {
    // This would set up a WebRTC peer connection for ultra-low latency streaming
    // For now, we'll create a placeholder structure
    
    const rtcConfig: RTCConfiguration = {
      iceServers: [
        ...this.stunServers.map(url => ({ urls: url })),
        ...this.turnServers
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    session.webrtcConnection = new RTCPeerConnection(rtcConfig);
    
    // Setup data channel for input forwarding
    if (session.config.enableInput) {
      const dataChannel = session.webrtcConnection.createDataChannel('input', {
        ordered: true,
        maxRetransmits: 0
      });
      
      dataChannel.onopen = () => {
        logger.info(`Input data channel opened for session ${session.id}`);
      };
      
      dataChannel.onmessage = (event) => {
        this.handleInputData(session.id, JSON.parse(event.data));
      };
    }
    
    // Add video track from FFmpeg output
    if (session.ffmpegProcess?.stdout) {
      // This would require additional WebRTC video track setup
      // Implementation would depend on WebRTC library used
    }
  }

  private handleInputData(sessionId: string, inputData: any): void {
    // Forward input data to the emulator
    // This would communicate with the emulator container
    logger.debug(`Received input data for session ${sessionId}:`, inputData);
  }

  // =====================================================
  // METRICS AND MONITORING
  // =====================================================

  private startMetricsCollection(sessionId: string): void {
    const interval = setInterval(() => {
      this.collectStreamMetrics(sessionId);
    }, 1000);

    // Store interval for cleanup
    const session = this.activeSessions.get(sessionId);
    if (session) {
      (session as any).metricsInterval = interval;
    }
  }

  private async collectStreamMetrics(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status === 'stopped') {
      return;
    }

    try {
      const metrics: StreamMetrics = {
        sessionId,
        timestamp: new Date(),
        fps: 0,
        bitrate: session.bitrate,
        latency: session.latency,
        droppedFrames: session.droppedFrames,
        keyFrames: 0,
        audioLatency: 0,
        networkJitter: 0,
        packetLoss: 0,
        cpuUsage: 0,
        memoryUsage: 0
      };

      // Collect metrics from FFmpeg output, system stats, etc.
      if (session.ffmpegProcess?.pid) {
        const processStats = await this.getProcessStats(session.ffmpegProcess.pid);
        metrics.cpuUsage = processStats.cpu;
        metrics.memoryUsage = processStats.memory;
      }

      // Store metrics
      if (!this.metricsHistory.has(sessionId)) {
        this.metricsHistory.set(sessionId, []);
      }
      
      const history = this.metricsHistory.get(sessionId)!;
      history.push(metrics);
      
      // Keep only last 300 entries (5 minutes)
      if (history.length > 300) {
        history.splice(0, history.length - 300);
      }

      // Emit metrics update
      this.emit('metricsUpdate', metrics);
      
    } catch (error) {
      logger.error(`Failed to collect metrics for session ${sessionId}:`, error);
    }
  }

  private async getProcessStats(pid: number): Promise<{ cpu: number; memory: number }> {
    // Implementation would use system tools to get process stats
    return { cpu: 0, memory: 0 };
  }

  private parseFFmpegStats(sessionId: string, output: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Parse FFmpeg output for statistics
    const fpsMatch = output.match(/fps=\s*(\d+\.?\d*)/);
    if (fpsMatch) {
      const fps = parseFloat(fpsMatch[1]);
      // Update session FPS
    }

    const bitrateMatch = output.match(/bitrate=\s*(\d+\.?\d*)\s*kbits\/s/);
    if (bitrateMatch) {
      session.bitrate = parseFloat(bitrateMatch[1]) * 1000;
    }

    const dropMatch = output.match(/drop=\s*(\d+)/);
    if (dropMatch) {
      session.droppedFrames = parseInt(dropMatch[1]);
    }
  }

  private handleFFmpegOutput(sessionId: string, data: Buffer): void {
    // Handle raw video data for WebRTC streaming
    const session = this.activeSessions.get(sessionId);
    if (session?.webrtcConnection) {
      // Process video data for WebRTC transmission
    }
  }

  // =====================================================
  // VIEWER MANAGEMENT
  // =====================================================

  async addViewer(streamId: string, websocket: WebSocket, userAgent: string, ip: string): Promise<ViewerSession> {
    const viewerId = crypto.randomUUID();
    
    const viewer: ViewerSession = {
      id: viewerId,
      streamId,
      userAgent,
      ip,
      connectionTime: new Date(),
      lastActivity: new Date(),
      websocket,
      quality: 'auto',
      latency: 0
    };

    this.activeViewers.set(viewerId, viewer);
    
    // Update session viewer count
    const session = this.activeSessions.get(streamId);
    if (session) {
      session.viewerCount++;
      session.lastActivity = new Date();
    }

    // Setup WebSocket message handling
    websocket.on('message', (data) => {
      this.handleViewerMessage(viewerId, JSON.parse(data.toString()));
    });

    websocket.on('close', () => {
      this.removeViewer(viewerId);
    });

    logger.info(`Viewer ${viewerId} connected to stream ${streamId}`);
    this.emit('viewerJoined', viewer);
    
    return viewer;
  }

  private removeViewer(viewerId: string): void {
    const viewer = this.activeViewers.get(viewerId);
    if (viewer) {
      // Update session viewer count
      const session = this.activeSessions.get(viewer.streamId);
      if (session) {
        session.viewerCount = Math.max(0, session.viewerCount - 1);
      }

      this.activeViewers.delete(viewerId);
      logger.info(`Viewer ${viewerId} disconnected from stream ${viewer.streamId}`);
      this.emit('viewerLeft', viewer);
    }
  }

  private handleViewerMessage(viewerId: string, message: any): void {
    const viewer = this.activeViewers.get(viewerId);
    if (!viewer) return;

    viewer.lastActivity = new Date();

    switch (message.type) {
      case 'input':
        // Forward input to emulator if viewer has permission
        this.forwardInput(viewer.streamId, message.data);
        break;
      case 'quality_change':
        viewer.quality = message.quality;
        break;
      case 'webrtc_offer':
        this.handleWebRTCOffer(viewerId, message.offer);
        break;
      case 'webrtc_ice':
        this.handleWebRTCIce(viewerId, message.ice);
        break;
    }
  }

  private forwardInput(streamId: string, inputData: any): void {
    // Forward input to the emulator container
    logger.debug(`Forwarding input for stream ${streamId}:`, inputData);
  }

  private async handleWebRTCOffer(viewerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const viewer = this.activeViewers.get(viewerId);
    if (!viewer) return;

    // Handle WebRTC offer for ultra-low latency streaming
    const session = this.activeSessions.get(viewer.streamId);
    if (session?.webrtcConnection) {
      try {
        await session.webrtcConnection.setRemoteDescription(offer);
        const answer = await session.webrtcConnection.createAnswer();
        await session.webrtcConnection.setLocalDescription(answer);
        
        viewer.websocket?.send(JSON.stringify({
          type: 'webrtc_answer',
          answer
        }));
      } catch (error) {
        logger.error(`Failed to handle WebRTC offer for viewer ${viewerId}:`, error);
      }
    }
  }

  private async handleWebRTCIce(viewerId: string, ice: RTCIceCandidateInit): Promise<void> {
    const viewer = this.activeViewers.get(viewerId);
    if (!viewer) return;

    const session = this.activeSessions.get(viewer.streamId);
    if (session?.webrtcConnection) {
      try {
        await session.webrtcConnection.addIceCandidate(ice);
      } catch (error) {
        logger.error(`Failed to add ICE candidate for viewer ${viewerId}:`, error);
      }
    }
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  async stopStream(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Stream session not found');
    }

    try {
      // Stop FFmpeg process
      if (session.ffmpegProcess) {
        session.ffmpegProcess.kill('SIGTERM');
        // Give it time to gracefully shutdown
        setTimeout(() => {
          if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
            session.ffmpegProcess.kill('SIGKILL');
          }
        }, 5000);
      }

      // Close WebRTC connection
      if (session.webrtcConnection) {
        session.webrtcConnection.close();
      }

      // Stop metrics collection
      if ((session as any).metricsInterval) {
        clearInterval((session as any).metricsInterval);
      }

      // Disconnect all viewers
      for (const [viewerId, viewer] of this.activeViewers) {
        if (viewer.streamId === sessionId) {
          viewer.websocket?.close();
          this.activeViewers.delete(viewerId);
        }
      }

      session.status = 'stopped';
      session.lastActivity = new Date();

      // Clean up stream files
      await this.cleanupStreamFiles(sessionId);

      logger.info(`Stopped stream session ${sessionId}`);
      this.emit('streamStopped', session);

    } catch (error) {
      logger.error(`Failed to stop stream session ${sessionId}:`, error);
      session.status = 'error';
      session.errors.push(`Stop error: ${error.message}`);
      throw error;
    }
  }

  async pauseStream(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Stream session not found');
    }

    if (session.ffmpegProcess?.pid) {
      process.kill(session.ffmpegProcess.pid, 'SIGSTOP');
      session.status = 'paused';
      logger.info(`Paused stream session ${sessionId}`);
    }
  }

  async resumeStream(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Stream session not found');
    }

    if (session.ffmpegProcess?.pid) {
      process.kill(session.ffmpegProcess.pid, 'SIGCONT');
      session.status = 'streaming';
      session.lastActivity = new Date();
      logger.info(`Resumed stream session ${sessionId}`);
    }
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  getSession(sessionId: string): StreamSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  getSessionMetrics(sessionId: string): StreamMetrics[] {
    return this.metricsHistory.get(sessionId) || [];
  }

  getActiveStreams(): StreamSession[] {
    return Array.from(this.activeSessions.values());
  }

  getStreamViewers(streamId: string): ViewerSession[] {
    return Array.from(this.activeViewers.values()).filter(v => v.streamId === streamId);
  }

  private async cleanupStreamFiles(sessionId: string): Promise<void> {
    const streamDir = path.join(config.storage.tempDir, 'streams', sessionId);
    try {
      await fs.rm(streamDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`Failed to cleanup stream files for ${sessionId}:`, error);
    }
  }

  private initializeCleanupTasks(): void {
    // Clean up inactive sessions every 5 minutes
    setInterval(() => {
      this.cleanupInactiveSessions();
    }, 5 * 60 * 1000);

    // Clean up old metrics data every hour
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 60 * 60 * 1000);
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const maxInactiveTime = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of this.activeSessions) {
      if (now - session.lastActivity.getTime() > maxInactiveTime) {
        logger.info(`Cleaning up inactive session ${sessionId}`);
        this.stopStream(sessionId).catch(error => {
          logger.error(`Failed to cleanup session ${sessionId}:`, error);
        });
      }
    }
  }

  private cleanupOldMetrics(): void {
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours
    const cutoff = Date.now() - maxAge;

    for (const [sessionId, metrics] of this.metricsHistory) {
      const filtered = metrics.filter(m => m.timestamp.getTime() > cutoff);
      if (filtered.length !== metrics.length) {
        this.metricsHistory.set(sessionId, filtered);
      }
    }
  }

  async getSystemStatus(): Promise<{
    activeStreams: number;
    totalViewers: number;
    averageBitrate: number;
    averageLatency: number;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  }> {
    const sessions = Array.from(this.activeSessions.values());
    const activeStreams = sessions.filter(s => s.status === 'streaming').length;
    const totalViewers = Array.from(this.activeViewers.values()).length;
    
    const averageBitrate = sessions.reduce((sum, s) => sum + s.bitrate, 0) / Math.max(sessions.length, 1);
    const averageLatency = sessions.reduce((sum, s) => sum + s.latency, 0) / Math.max(sessions.length, 1);

    // System resource usage would be collected here
    return {
      activeStreams,
      totalViewers,
      averageBitrate,
      averageLatency,
      cpuUsage: 0, // Would implement actual system monitoring
      memoryUsage: 0,
      diskUsage: 0
    };
  }
}

export default StreamingService;