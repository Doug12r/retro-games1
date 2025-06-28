import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Volume2, 
  VolumeX, 
  RotateCcw, 
  FastForward, 
  Save, 
  FolderOpen,
  Settings,
  Gamepad2,
  Monitor,
  Smartphone,
  Maximize,
  Minimize,
  Download,
  Upload
} from 'lucide-react';

// =====================================================
// UNIVERSAL BROWSER EMULATOR COMPONENT
// =====================================================

interface EmulatorConfig {
  EJS_player: string;
  EJS_gameUrl: string;
  EJS_biosUrl?: string;
  EJS_core: string;
  EJS_mouse: boolean;
  EJS_multitap: boolean;
  EJS_lightgun: boolean;
  EJS_cheats: boolean;
  EJS_saveStates: boolean;
  EJS_startOnLoaded: boolean;
  EJS_color: string;
  EJS_VirtualGamepadSettings: any;
  EJS_onGameStart?: () => void;
  EJS_onSaveState?: (state: any) => void;
  EJS_onLoadState?: (state: any) => void;
}

interface SaveState {
  id: string;
  name: string;
  description?: string;
  screenshot: string;
  timestamp: string;
  fileSize: number;
  slotNumber: number;
}

interface EmulatorMetrics {
  fps: number;
  frameSkip: number;
  audioLatency: number;
  inputLatency: number;
  cpuUsage: number;
  memoryUsage: number;
}

interface TouchControlConfig {
  layout: 'nes' | 'snes' | 'gba' | 'genesis' | 'psx' | 'custom';
  opacity: number;
  size: number;
  position: 'bottom' | 'sides' | 'floating';
  hapticFeedback: boolean;
  visible: boolean;
}

const UniversalBrowserEmulator: React.FC<{
  gameId: string;
  sessionId: string;
  config: EmulatorConfig;
  onMetricsUpdate?: (metrics: EmulatorMetrics) => void;
  onSessionEnd?: () => void;
}> = ({ gameId, sessionId, config, onMetricsUpdate, onSessionEnd }) => {
  // =====================================================
  // STATE MANAGEMENT
  // =====================================================
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const emulatorRef = useRef<any>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const metricsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saveStates, setSaveStates] = useState<SaveState[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState<EmulatorMetrics>({
    fps: 0,
    frameSkip: 0,
    audioLatency: 0,
    inputLatency: 0,
    cpuUsage: 0,
    memoryUsage: 0
  });
  const [error, setError] = useState<string | null>(null);
  
  // Mobile/touch controls state
  const [isMobile, setIsMobile] = useState(false);
  const [touchControls, setTouchControls] = useState<TouchControlConfig>({
    layout: 'nes',
    opacity: 0.7,
    size: 1.0,
    position: 'bottom',
    hapticFeedback: true,
    visible: true
  });
  
  // Performance monitoring
  const [performanceLevel, setPerformanceLevel] = useState<'high' | 'medium' | 'low'>('high');
  const [adaptiveQuality, setAdaptiveQuality] = useState(true);

  // =====================================================
  // INITIALIZATION & CLEANUP
  // =====================================================
  
  useEffect(() => {
    detectDeviceCapabilities();
    initializeEmulator();
    setupWebSocket();
    loadSaveStates();
    
    return () => {
      cleanup();
    };
  }, []);

  const detectDeviceCapabilities = () => {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsMobile(isMobileDevice);
    
    // Detect performance level based on hardware
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? gl?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';
    
    // Simple performance detection (would be more sophisticated in production)
    if (renderer?.includes('Mali') || renderer?.includes('Adreno 5') || navigator.hardwareConcurrency < 4) {
      setPerformanceLevel('low');
    } else if (renderer?.includes('Adreno 6') || navigator.hardwareConcurrency < 8) {
      setPerformanceLevel('medium');
    }
  };

  const initializeEmulator = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Load EmulatorJS library dynamically
      await loadEmulatorJS();
      
      // Configure emulator based on device capabilities
      const optimizedConfig = optimizeConfigForDevice(config);
      
      // Initialize the emulator
      if (canvasRef.current) {
        canvasRef.current.innerHTML = ''; // Clear any existing content
        
        // Set up EmulatorJS configuration
        Object.assign(window, optimizedConfig);
        
        // Enhanced event handlers
        window.EJS_onGameStart = () => {
          setIsLoading(false);
          setIsPlaying(true);
          startMetricsCollection();
          optimizedConfig.EJS_onGameStart?.();
        };
        
        window.EJS_onSaveState = (state: any) => {
          handleSaveStateCreated(state);
          optimizedConfig.EJS_onSaveState?.(state);
        };
        
        window.EJS_onLoadState = (state: any) => {
          optimizedConfig.EJS_onLoadState?.(state);
        };
        
        window.EJS_onError = (error: any) => {
          setError(`Emulator error: ${error.message || error}`);
          setIsLoading(false);
        };
        
        // Create emulator script element
        const script = document.createElement('script');
        script.src = '/emulators/EmulatorJS/data/loader.js';
        script.onload = () => {
          // EmulatorJS will automatically initialize based on window configuration
        };
        script.onerror = () => {
          setError('Failed to load emulator core');
          setIsLoading(false);
        };
        
        document.head.appendChild(script);
        
        // Store emulator reference (would be set by EmulatorJS)
        emulatorRef.current = window.EJS_emulatorInstance;
      }
    } catch (error) {
      setError(`Failed to initialize emulator: ${error.message}`);
      setIsLoading(false);
    }
  };

  const loadEmulatorJS = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.EJS_emulator) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = '/emulators/EmulatorJS/data/loader.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load EmulatorJS'));
      document.head.appendChild(script);
    });
  };

  const optimizeConfigForDevice = (baseConfig: EmulatorConfig): EmulatorConfig => {
    const optimized = { ...baseConfig };
    
    // Performance optimizations
    if (performanceLevel === 'low') {
      optimized.EJS_VirtualGamepadSettings = {
        ...optimized.EJS_VirtualGamepadSettings,
        lowPerformanceMode: true,
        reducedAnimations: true
      };
    }
    
    // Mobile optimizations
    if (isMobile) {
      optimized.EJS_VirtualGamepadSettings = {
        ...optimized.EJS_VirtualGamepadSettings,
        showGamepad: touchControls.visible,
        gamepadOpacity: touchControls.opacity,
        gamepadSize: touchControls.size,
        hapticFeedback: touchControls.hapticFeedback
      };
    }
    
    return optimized;
  };

  const setupWebSocket = () => {
    const wsUrl = `ws://localhost:3001/api/emulator/ws/${sessionId}`;
    websocketRef.current = new WebSocket(wsUrl);
    
    websocketRef.current.onopen = () => {
      console.log('WebSocket connected to emulator session');
    };
    
    websocketRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    };
    
    websocketRef.current.onclose = () => {
      console.log('WebSocket disconnected from emulator session');
    };
    
    websocketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'metrics_update':
        setCurrentMetrics(data.metrics);
        onMetricsUpdate?.(data.metrics);
        break;
      case 'session_ended':
        onSessionEnd?.();
        break;
      case 'save_state_created':
        loadSaveStates(); // Refresh save states
        break;
    }
  };

  const startMetricsCollection = () => {
    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
    }
    
    metricsIntervalRef.current = setInterval(() => {
      if (emulatorRef.current && isPlaying) {
        const metrics = collectMetrics();
        setCurrentMetrics(metrics);
        onMetricsUpdate?.(metrics);
        
        // Send metrics to server
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
          websocketRef.current.send(JSON.stringify({
            type: 'metrics',
            data: metrics
          }));
        }
        
        // Adaptive quality adjustment
        if (adaptiveQuality) {
          adjustQualityBasedOnPerformance(metrics);
        }
      }
    }, 1000);
  };

  const collectMetrics = (): EmulatorMetrics => {
    // Collect real-time metrics from EmulatorJS
    // This would interface with the actual emulator core
    return {
      fps: emulatorRef.current?.getFPS?.() || 60,
      frameSkip: emulatorRef.current?.getFrameSkip?.() || 0,
      audioLatency: emulatorRef.current?.getAudioLatency?.() || 0,
      inputLatency: performance.now() % 100, // Mock input latency
      cpuUsage: (navigator as any).deviceMemory ? Math.random() * 50 : 0,
      memoryUsage: (performance as any).memory?.usedJSHeapSize || 0
    };
  };

  const adjustQualityBasedOnPerformance = (metrics: EmulatorMetrics) => {
    if (metrics.fps < 50 || metrics.frameSkip > 2) {
      // Reduce quality
      if (emulatorRef.current?.setVideoFilter) {
        emulatorRef.current.setVideoFilter('nearest');
      }
    } else if (metrics.fps >= 59 && metrics.frameSkip === 0) {
      // Increase quality
      if (emulatorRef.current?.setVideoFilter) {
        emulatorRef.current.setVideoFilter('linear');
      }
    }
  };

  const cleanup = () => {
    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
    }
    
    if (websocketRef.current) {
      websocketRef.current.close();
    }
    
    if (emulatorRef.current) {
      emulatorRef.current.destroy?.();
    }
  };

  // =====================================================
  // EMULATOR CONTROLS
  // =====================================================
  
  const handlePlay = () => {
    if (emulatorRef.current) {
      emulatorRef.current.play();
      setIsPlaying(true);
      setIsPaused(false);
    }
  };

  const handlePause = () => {
    if (emulatorRef.current) {
      emulatorRef.current.pause();
      setIsPlaying(false);
      setIsPaused(true);
    }
  };

  const handleStop = () => {
    if (emulatorRef.current) {
      emulatorRef.current.stop();
      setIsPlaying(false);
      setIsPaused(false);
    }
  };

  const handleReset = () => {
    if (emulatorRef.current) {
      emulatorRef.current.restart();
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    if (emulatorRef.current) {
      emulatorRef.current.setVolume(newVolume);
    }
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (emulatorRef.current) {
      emulatorRef.current.setVolume(newMuted ? 0 : volume);
    }
  };

  const handleFullscreenToggle = () => {
    if (!isFullscreen) {
      canvasRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    setIsFullscreen(!isFullscreen);
  };

  const handleFastForward = () => {
    if (emulatorRef.current) {
      emulatorRef.current.setSpeed(2.0); // 2x speed
      setTimeout(() => {
        emulatorRef.current.setSpeed(1.0);
      }, 5000);
    }
  };

  // =====================================================
  // SAVE STATE MANAGEMENT
  // =====================================================
  
  const loadSaveStates = async () => {
    try {
      const response = await fetch(`/api/emulator/games/${gameId}/savestates`);
      const data = await response.json();
      setSaveStates(data.saveStates);
    } catch (error) {
      console.error('Failed to load save states:', error);
    }
  };

  const handleSaveState = async (slotNumber: number, name: string) => {
    try {
      if (emulatorRef.current) {
        const state = emulatorRef.current.saveState();
        const screenshot = emulatorRef.current.screenshot();
        
        const response = await fetch(`/api/emulator/session/${sessionId}/savestate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slotNumber,
            name,
            state,
            screenshot
          })
        });
        
        if (response.ok) {
          loadSaveStates(); // Refresh the list
        }
      }
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  };

  const handleLoadState = async (saveStateId: string) => {
    try {
      const response = await fetch(`/api/emulator/session/${sessionId}/savestate/${saveStateId}/load`, {
        method: 'POST'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (emulatorRef.current && data.state) {
          emulatorRef.current.loadState(data.state);
        }
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    }
  };

  const handleSaveStateCreated = (state: any) => {
    // Handle save state created from EmulatorJS
    loadSaveStates();
  };

  // =====================================================
  // MOBILE TOUCH CONTROLS
  // =====================================================
  
  const TouchControlPad: React.FC<{ layout: string }> = ({ layout }) => {
    if (!isMobile || !touchControls.visible) return null;

    const handleTouchStart = (button: string) => {
      if (touchControls.hapticFeedback && 'vibrate' in navigator) {
        navigator.vibrate(50);
      }
      
      if (emulatorRef.current) {
        emulatorRef.current.simulateKeyDown(button);
      }
    };

    const handleTouchEnd = (button: string) => {
      if (emulatorRef.current) {
        emulatorRef.current.simulateKeyUp(button);
      }
    };

    const controlStyle = {
      opacity: touchControls.opacity,
      transform: `scale(${touchControls.size})`
    };

    return (
      <div className={`fixed inset-0 pointer-events-none z-50`}>
        {/* D-Pad */}
        <div className="absolute bottom-4 left-4 pointer-events-auto" style={controlStyle}>
          <div className="relative w-32 h-32">
            <button
              className="absolute top-0 left-1/2 transform -translate-x-1/2 w-8 h-8 bg-gray-800 bg-opacity-70 rounded text-white"
              onTouchStart={() => handleTouchStart('ArrowUp')}
              onTouchEnd={() => handleTouchEnd('ArrowUp')}
            >
              ↑
            </button>
            <button
              className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-8 h-8 bg-gray-800 bg-opacity-70 rounded text-white"
              onTouchStart={() => handleTouchStart('ArrowDown')}
              onTouchEnd={() => handleTouchEnd('ArrowDown')}
            >
              ↓
            </button>
            <button
              className="absolute left-0 top-1/2 transform -translate-y-1/2 w-8 h-8 bg-gray-800 bg-opacity-70 rounded text-white"
              onTouchStart={() => handleTouchStart('ArrowLeft')}
              onTouchEnd={() => handleTouchEnd('ArrowLeft')}
            >
              ←
            </button>
            <button
              className="absolute right-0 top-1/2 transform -translate-y-1/2 w-8 h-8 bg-gray-800 bg-opacity-70 rounded text-white"
              onTouchStart={() => handleTouchStart('ArrowRight')}
              onTouchEnd={() => handleTouchEnd('ArrowRight')}
            >
              →
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="absolute bottom-4 right-4 pointer-events-auto" style={controlStyle}>
          <div className="relative w-32 h-20">
            {layout === 'nes' && (
              <>
                <button
                  className="absolute bottom-0 right-16 w-12 h-12 bg-red-600 bg-opacity-70 rounded-full text-white font-bold"
                  onTouchStart={() => handleTouchStart('KeyZ')}
                  onTouchEnd={() => handleTouchEnd('KeyZ')}
                >
                  B
                </button>
                <button
                  className="absolute bottom-0 right-2 w-12 h-12 bg-red-700 bg-opacity-70 rounded-full text-white font-bold"
                  onTouchStart={() => handleTouchStart('KeyX')}
                  onTouchEnd={() => handleTouchEnd('KeyX')}
                >
                  A
                </button>
              </>
            )}
            
            {layout === 'snes' && (
              <>
                <button
                  className="absolute top-0 right-8 w-10 h-10 bg-purple-600 bg-opacity-70 rounded-full text-white text-xs"
                  onTouchStart={() => handleTouchStart('KeyA')}
                  onTouchEnd={() => handleTouchEnd('KeyA')}
                >
                  X
                </button>
                <button
                  className="absolute bottom-0 right-16 w-10 h-10 bg-blue-600 bg-opacity-70 rounded-full text-white text-xs"
                  onTouchStart={() => handleTouchStart('KeyZ')}
                  onTouchEnd={() => handleTouchEnd('KeyZ')}
                >
                  Y
                </button>
                <button
                  className="absolute bottom-0 right-2 w-10 h-10 bg-red-600 bg-opacity-70 rounded-full text-white text-xs"
                  onTouchStart={() => handleTouchStart('KeyS')}
                  onTouchEnd={() => handleTouchEnd('KeyS')}
                >
                  B
                </button>
                <button
                  className="absolute top-0 right-2 w-10 h-10 bg-green-600 bg-opacity-70 rounded-full text-white text-xs"
                  onTouchStart={() => handleTouchStart('KeyX')}
                  onTouchEnd={() => handleTouchEnd('KeyX')}
                >
                  A
                </button>
              </>
            )}
          </div>
        </div>

        {/* Start/Select Buttons */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 pointer-events-auto" style={controlStyle}>
          <div className="flex space-x-4">
            <button
              className="w-16 h-6 bg-gray-700 bg-opacity-70 rounded text-white text-xs"
              onTouchStart={() => handleTouchStart('Space')}
              onTouchEnd={() => handleTouchEnd('Space')}
            >
              SELECT
            </button>
            <button
              className="w-16 h-6 bg-gray-700 bg-opacity-70 rounded text-white text-xs"
              onTouchStart={() => handleTouchStart('Enter')}
              onTouchEnd={() => handleTouchEnd('Enter')}
            >
              START
            </button>
          </div>
        </div>
      </div>
    );
  };

  // =====================================================
  // SETTINGS PANEL
  // =====================================================
  
  const SettingsPanel: React.FC = () => {
    if (!showSettings) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold mb-4">Emulator Settings</h3>
          
          {/* Volume Control */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Volume</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          
          {/* Performance Settings */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Performance Level</label>
            <select
              value={performanceLevel}
              onChange={(e) => setPerformanceLevel(e.target.value as any)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="high">High (Best Quality)</option>
              <option value="medium">Medium (Balanced)</option>
              <option value="low">Low (Best Performance)</option>
            </select>
          </div>
          
          {/* Touch Controls (Mobile Only) */}
          {isMobile && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Touch Controls</label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={touchControls.visible}
                    onChange={(e) => setTouchControls(prev => ({ ...prev, visible: e.target.checked }))}
                    className="mr-2"
                  />
                  Show Virtual Gamepad
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={touchControls.hapticFeedback}
                    onChange={(e) => setTouchControls(prev => ({ ...prev, hapticFeedback: e.target.checked }))}
                    className="mr-2"
                  />
                  Haptic Feedback
                </label>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Control Opacity</label>
                  <input
                    type="range"
                    min="0.3"
                    max="1"
                    step="0.1"
                    value={touchControls.opacity}
                    onChange={(e) => setTouchControls(prev => ({ ...prev, opacity: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* Adaptive Quality */}
          <div className="mb-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={adaptiveQuality}
                onChange={(e) => setAdaptiveQuality(e.target.checked)}
                className="mr-2"
              />
              Adaptive Quality (Auto-adjust based on performance)
            </label>
          </div>
          
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    );
  };

  // =====================================================
  // SAVE STATE PANEL
  // =====================================================
  
  const SaveStatePanel: React.FC = () => {
    const [showSaveStates, setShowSaveStates] = useState(false);
    const [newSaveName, setNewSaveName] = useState('');
    const [selectedSlot, setSelectedSlot] = useState(0);

    if (!showSaveStates) {
      return (
        <button
          onClick={() => setShowSaveStates(true)}
          className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          <Save className="w-4 h-4" />
          <span>Save States</span>
        </button>
      );
    }

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4">Save States</h3>
          
          {/* Create New Save State */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium mb-2">Create New Save State</h4>
            <div className="flex space-x-2">
              <select
                value={selectedSlot}
                onChange={(e) => setSelectedSlot(parseInt(e.target.value))}
                className="border border-gray-300 rounded px-3 py-2"
              >
                {[...Array(10)].map((_, i) => (
                  <option key={i} value={i}>Slot {i}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Save state name"
                value={newSaveName}
                onChange={(e) => setNewSaveName(e.target.value)}
                className="flex-1 border border-gray-300 rounded px-3 py-2"
              />
              <button
                onClick={() => {
                  if (newSaveName.trim()) {
                    handleSaveState(selectedSlot, newSaveName.trim());
                    setNewSaveName('');
                  }
                }}
                disabled={!newSaveName.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
          
          {/* Existing Save States */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {saveStates.map((state) => (
              <div key={state.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <img
                    src={state.screenshot}
                    alt={state.name}
                    className="w-16 h-12 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <h5 className="font-medium text-sm truncate">{state.name}</h5>
                    <p className="text-xs text-gray-500">Slot {state.slotNumber}</p>
                    <p className="text-xs text-gray-500">{new Date(state.timestamp).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{(state.fileSize / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={() => handleLoadState(state.id)}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Load
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {saveStates.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No save states found. Create your first save state above!
            </div>
          )}
          
          <div className="flex justify-end mt-6">
            <button
              onClick={() => setShowSaveStates(false)}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // =====================================================
  // MAIN RENDER
  // =====================================================
  
  return (
    <div className="relative w-full h-full bg-black">
      {/* Loading State */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 z-40">
          <div className="text-center text-white">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p>Loading {config.EJS_core} emulator...</p>
            <p className="text-sm text-gray-300">This may take a moment</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900 bg-opacity-75 z-40">
          <div className="text-center text-white">
            <div className="text-red-400 mb-4">⚠️</div>
            <p className="font-medium">{error}</p>
            <button
              onClick={() => {
                setError(null);
                initializeEmulator();
              }}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Emulator Canvas */}
      <div
        ref={canvasRef}
        id="emulator-canvas"
        className="w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />

      {/* Control Bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gray-900 bg-opacity-90 p-2">
        <div className="flex items-center justify-between">
          {/* Playback Controls */}
          <div className="flex items-center space-x-2">
            {!isPlaying ? (
              <button
                onClick={handlePlay}
                className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                <Play className="w-4 h-4" />
                <span>Play</span>
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="flex items-center space-x-1 px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
              >
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </button>
            )}
            
            <button
              onClick={handleStop}
              className="flex items-center space-x-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              <Square className="w-4 h-4" />
              <span>Stop</span>
            </button>
            
            <button
              onClick={handleReset}
              className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reset</span>
            </button>
            
            <button
              onClick={handleFastForward}
              className="flex items-center space-x-1 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              <FastForward className="w-4 h-4" />
              <span>Turbo</span>
            </button>
          </div>

          {/* Performance Metrics */}
          <div className="flex items-center space-x-4 text-sm text-white">
            <span>FPS: {currentMetrics.fps.toFixed(0)}</span>
            <span>Skip: {currentMetrics.frameSkip}</span>
            {performanceLevel !== 'high' && (
              <span className="text-yellow-400">⚡ {performanceLevel.toUpperCase()}</span>
            )}
          </div>

          {/* Utility Controls */}
          <div className="flex items-center space-x-2">
            <SaveStatePanel />
            
            <button
              onClick={handleMuteToggle}
              className="p-2 text-white hover:bg-gray-700 rounded"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            
            {isMobile && (
              <button
                onClick={() => setTouchControls(prev => ({ ...prev, visible: !prev.visible }))}
                className="p-2 text-white hover:bg-gray-700 rounded"
              >
                <Gamepad2 className="w-4 h-4" />
              </button>
            )}
            
            <button
              onClick={handleFullscreenToggle}
              className="p-2 text-white hover:bg-gray-700 rounded"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
            
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-white hover:bg-gray-700 rounded"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Touch Controls */}
      <TouchControlPad layout={touchControls.layout} />

      {/* Settings Panel */}
      <SettingsPanel />
    </div>
  );
};

// =====================================================
// EMULATOR LAUNCHER COMPONENT
// =====================================================

const EmulatorLauncher: React.FC<{
  gameId: string;
  onClose?: () => void;
}> = ({ gameId, onClose }) => {
  const [config, setConfig] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCore, setSelectedCore] = useState<string>('');
  const [emulatorType, setEmulatorType] = useState<'browser' | 'native'>('browser');

  useEffect(() => {
    loadEmulatorConfig();
  }, [gameId]);

  const loadEmulatorConfig = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/emulator/config/${gameId}`);
      const data = await response.json();
      
      setConfig(data);
      setEmulatorType(data.recommendedEmulator);
      setSelectedCore(data.platformConfig.defaultCore);
      setIsLoading(false);
    } catch (error) {
      setError('Failed to load emulator configuration');
      setIsLoading(false);
    }
  };

  const startEmulator = async () => {
    try {
      setIsLoading(true);
      
      const endpoint = emulatorType === 'browser' 
        ? `/api/emulator/browser/${gameId}`
        : `/api/emulator/native/${gameId}`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coreId: selectedCore,
          settings: {}
        })
      });
      
      const data = await response.json();
      
      if (emulatorType === 'browser') {
        setSessionId(data.sessionId);
        setConfig(data.config);
      } else {
        // Handle native emulator (would redirect to streaming interface)
        window.open(data.streamUrl, '_blank');
      }
      
      setIsLoading(false);
    } catch (error) {
      setError('Failed to start emulator');
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading emulator...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-600 p-8">
        <p>{error}</p>
        <button
          onClick={loadEmulatorConfig}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sessionId && config && emulatorType === 'browser') {
    return (
      <div className="w-full h-screen">
        <UniversalBrowserEmulator
          gameId={gameId}
          sessionId={sessionId}
          config={config}
          onSessionEnd={onClose}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Launch Emulator</h2>
      
      {/* Emulator Type Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Emulator Type</label>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setEmulatorType('browser')}
            className={`p-4 border rounded-lg text-left ${
              emulatorType === 'browser' 
                ? 'border-blue-500 bg-blue-50' 
                : 'border-gray-300'
            }`}
          >
            <Monitor className="w-6 h-6 mb-2" />
            <h3 className="font-medium">Browser Emulator</h3>
            <p className="text-sm text-gray-600">Play directly in your browser</p>
          </button>
          
          <button
            onClick={() => setEmulatorType('native')}
            className={`p-4 border rounded-lg text-left ${
              emulatorType === 'native' 
                ? 'border-blue-500 bg-blue-50' 
                : 'border-gray-300'
            }`}
          >
            <Smartphone className="w-6 h-6 mb-2" />
            <h3 className="font-medium">Native Emulator</h3>
            <p className="text-sm text-gray-600">Higher performance, streamed to browser</p>
          </button>
        </div>
      </div>

      {/* Core Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Emulator Core</label>
        <select
          value={selectedCore}
          onChange={(e) => setSelectedCore(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2"
        >
          {emulatorType === 'browser' 
            ? config.availableEmulators
                .filter((e: any) => e.wasm || !e.wasm)
                .map((emulator: any) => (
                  <option key={emulator.core} value={emulator.core}>
                    {emulator.name} ({emulator.performance})
                  </option>
                ))
            : config.platformConfig.retroarchCores.map((core: string) => (
                <option key={core} value={core}>
                  RetroArch - {core}
                </option>
              ))
          }
        </select>
      </div>

      {/* Requirements Check */}
      {config.requiredBios.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-medium text-yellow-800 mb-2">⚠️ BIOS Files Required</h3>
          <p className="text-sm text-yellow-700 mb-2">
            This game requires the following BIOS files to run:
          </p>
          <ul className="text-sm text-yellow-700 list-disc list-inside">
            {config.requiredBios.map((bios: string) => (
              <li key={bios}>{bios}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Launch Button */}
      <div className="flex justify-between">
        <button
          onClick={onClose}
          className="px-6 py-3 text-gray-600 hover:text-gray-800"
        >
          Cancel
        </button>
        <button
          onClick={startEmulator}
          disabled={config.requiredBios.length > 0}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Launch Emulator
        </button>
      </div>
    </div>
  );
};

export default EmulatorLauncher;