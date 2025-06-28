import React, { useState, useEffect, useRef } from 'react';
import {
  Monitor,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  Zap,
  Users,
  PlayCircle,
  PauseCircle,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Settings,
  RefreshCw
} from 'lucide-react';

// =====================================================
// PERFORMANCE MONITORING DASHBOARD
// =====================================================

interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    temperature: number;
    cores: number[];
  };
  memory: {
    used: number;
    total: number;
    usage: number;
  };
  disk: {
    used: number;
    total: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  gpu?: {
    usage: number;
    memory: number;
    temperature: number;
  };
}

interface EmulatorMetrics {
  sessionId: string;
  gameTitle: string;
  platform: string;
  fps: number;
  frameSkip: number;
  audioLatency: number;
  inputLatency: number;
  uptime: number;
  status: 'running' | 'paused' | 'stopped' | 'error';
}

interface StreamMetrics {
  sessionId: string;
  viewerCount: number;
  bitrate: number;
  droppedFrames: number;
  latency: number;
  quality: string;
}

const PerformanceDashboard: React.FC = () => {
  // =====================================================
  // STATE MANAGEMENT
  // =====================================================
  
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [emulatorSessions, setEmulatorSessions] = useState<EmulatorMetrics[]>([]);
  const [streamSessions, setStreamSessions] = useState<StreamMetrics[]>([]);
  const [alerts, setAlerts] = useState<Array<{
    id: string;
    type: 'error' | 'warning' | 'info';
    message: string;
    timestamp: Date;
  }>>([]);
  
  const [isConnected, setIsConnected] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(1000);
  const [showDetails, setShowDetails] = useState(false);
  const websocketRef = useRef<WebSocket | null>(null);
  const metricsHistory = useRef<SystemMetrics[]>([]);

  // =====================================================
  // DATA FETCHING AND WEBSOCKET
  // =====================================================
  
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    const ws = new WebSocket('ws://localhost:3001/api/monitoring/ws');
    
    ws.onopen = () => {
      setIsConnected(true);
      console.log('Connected to monitoring WebSocket');
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
      setIsConnected(false);
      console.log('Disconnected from monitoring WebSocket');
      // Attempt to reconnect after 5 seconds
      setTimeout(connectWebSocket, 5000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    websocketRef.current = ws;
  };

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'system_metrics':
        setSystemMetrics(data.metrics);
        addToHistory(data.metrics);
        break;
      case 'emulator_metrics':
        setEmulatorSessions(data.sessions);
        break;
      case 'stream_metrics':
        setStreamSessions(data.streams);
        break;
      case 'alert':
        addAlert(data.alert);
        break;
    }
  };

  const addToHistory = (metrics: SystemMetrics) => {
    metricsHistory.current.push(metrics);
    // Keep only last 300 entries (5 minutes at 1s intervals)
    if (metricsHistory.current.length > 300) {
      metricsHistory.current.shift();
    }
  };

  const addAlert = (alert: any) => {
    const newAlert = {
      id: Date.now().toString(),
      ...alert,
      timestamp: new Date()
    };
    
    setAlerts(prev => [newAlert, ...prev.slice(0, 49)]); // Keep last 50 alerts
  };

  // =====================================================
  // UTILITY FUNCTIONS
  // =====================================================
  
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'running': return 'text-green-600';
      case 'paused': return 'text-yellow-600';
      case 'stopped': return 'text-gray-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <CheckCircle className="w-4 h-4" />;
      case 'paused': return <PauseCircle className="w-4 h-4" />;
      case 'stopped': return <XCircle className="w-4 h-4" />;
      case 'error': return <AlertTriangle className="w-4 h-4" />;
      default: return <Monitor className="w-4 h-4" />;
    }
  };

  // =====================================================
  // CHART COMPONENTS
  // =====================================================
  
  const MiniChart: React.FC<{
    data: number[];
    color: string;
    height?: number;
  }> = ({ data, color, height = 40 }) => {
    if (data.length < 2) return <div className={`h-${height} bg-gray-100 rounded`} />;
    
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = ((max - value) / range) * 100;
      return `${x},${y}`;
    }).join(' ');
    
    return (
      <svg className={`w-full h-${height}`} viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          points={points}
        />
      </svg>
    );
  };

  // =====================================================
  // COMPONENT SECTIONS
  // =====================================================
  
  const SystemOverview: React.FC = () => {
    if (!systemMetrics) {
      return (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </div>
      );
    }

    const cpuHistory = metricsHistory.current.map(m => m.cpu.usage);
    const memoryHistory = metricsHistory.current.map(m => m.memory.usage);
    const diskHistory = metricsHistory.current.map(m => m.disk.usage);

    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">System Overview</h2>
          <div className={`flex items-center space-x-2 ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-600' : 'bg-red-600'}`} />
            <span className="text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-6">
          {/* CPU */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium">CPU</span>
            </div>
            <div className="text-2xl font-bold">{systemMetrics.cpu.usage.toFixed(1)}%</div>
            <div className="text-xs text-gray-500">{systemMetrics.cpu.temperature}°C</div>
            <MiniChart data={cpuHistory} color="#3B82F6" />
          </div>
          
          {/* Memory */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <MemoryStick className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">Memory</span>
            </div>
            <div className="text-2xl font-bold">{systemMetrics.memory.usage.toFixed(1)}%</div>
            <div className="text-xs text-gray-500">
              {formatBytes(systemMetrics.memory.used)} / {formatBytes(systemMetrics.memory.total)}
            </div>
            <MiniChart data={memoryHistory} color="#10B981" />
          </div>
          
          {/* Disk */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <HardDrive className="w-4 h-4 text-yellow-600" />
              <span className="text-sm font-medium">Disk</span>
            </div>
            <div className="text-2xl font-bold">{systemMetrics.disk.usage.toFixed(1)}%</div>
            <div className="text-xs text-gray-500">
              {formatBytes(systemMetrics.disk.used)} / {formatBytes(systemMetrics.disk.total)}
            </div>
            <MiniChart data={diskHistory} color="#F59E0B" />
          </div>
        </div>

        {/* GPU if available */}
        {systemMetrics.gpu && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center space-x-2 mb-2">
              <Zap className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium">GPU</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-lg font-semibold">{systemMetrics.gpu.usage.toFixed(1)}%</div>
                <div className="text-gray-500">Usage</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{systemMetrics.gpu.memory.toFixed(1)}%</div>
                <div className="text-gray-500">Memory</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{systemMetrics.gpu.temperature}°C</div>
                <div className="text-gray-500">Temp</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const EmulatorSessions: React.FC = () => {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Active Emulators</h2>
          <div className="text-sm text-gray-500">
            {emulatorSessions.length} active
          </div>
        </div>
        
        {emulatorSessions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <PlayCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No active emulator sessions</p>
          </div>
        ) : (
          <div className="space-y-3">
            {emulatorSessions.map((session) => (
              <div key={session.sessionId} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className={getStatusColor(session.status)}>
                      {getStatusIcon(session.status)}
                    </div>
                    <span className="font-medium">{session.gameTitle}</span>
                    <span className="text-sm text-gray-500">({session.platform})</span>
                  </div>
                  <span className="text-sm text-gray-500">
                    {formatUptime(session.uptime)}
                  </span>
                </div>
                
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="font-medium">{session.fps.toFixed(0)} FPS</div>
                    <div className="text-gray-500">Frame Rate</div>
                  </div>
                  <div>
                    <div className="font-medium">{session.frameSkip}</div>
                    <div className="text-gray-500">Skipped</div>
                  </div>
                  <div>
                    <div className="font-medium">{session.audioLatency}ms</div>
                    <div className="text-gray-500">Audio Lag</div>
                  </div>
                  <div>
                    <div className="font-medium">{session.inputLatency}ms</div>
                    <div className="text-gray-500">Input Lag</div>
                  </div>
                </div>
                
                {/* Performance indicators */}
                <div className="mt-3 flex space-x-2">
                  {session.fps < 50 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">
                      <TrendingDown className="w-3 h-3 mr-1" />
                      Low FPS
                    </span>
                  )}
                  {session.frameSkip > 5 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
                      Frame Skip
                    </span>
                  )}
                  {session.inputLatency > 50 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-orange-100 text-orange-800">
                      High Latency
                    </span>
                  )}
                  {session.fps >= 58 && session.frameSkip <= 1 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      Optimal
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const StreamingSessions: React.FC = () => {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Active Streams</h2>
          <div className="text-sm text-gray-500">
            {streamSessions.reduce((sum, s) => sum + s.viewerCount, 0)} viewers
          </div>
        </div>
        
        {streamSessions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Monitor className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No active streams</p>
          </div>
        ) : (
          <div className="space-y-3">
            {streamSessions.map((stream) => (
              <div key={stream.sessionId} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <span className="font-medium">{stream.viewerCount} viewers</span>
                  </div>
                  <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    {stream.quality}
                  </span>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="font-medium">{(stream.bitrate / 1000000).toFixed(1)} Mbps</div>
                    <div className="text-gray-500">Bitrate</div>
                  </div>
                  <div>
                    <div className="font-medium">{stream.latency}ms</div>
                    <div className="text-gray-500">Latency</div>
                  </div>
                  <div>
                    <div className="font-medium">{stream.droppedFrames}</div>
                    <div className="text-gray-500">Dropped</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const AlertsPanel: React.FC = () => {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">System Alerts</h2>
          <button
            onClick={() => setAlerts([])}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear All
          </button>
        </div>
        
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No alerts</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-lg border-l-4 ${
                  alert.type === 'error'
                    ? 'border-red-500 bg-red-50'
                    : alert.type === 'warning'
                    ? 'border-yellow-500 bg-yellow-50'
                    : 'border-blue-500 bg-blue-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {alert.type === 'error' && <XCircle className="w-4 h-4 text-red-600" />}
                    {alert.type === 'warning' && <AlertTriangle className="w-4 h-4 text-yellow-600" />}
                    {alert.type === 'info' && <CheckCircle className="w-4 h-4 text-blue-600" />}
                    <span className="text-sm font-medium">{alert.message}</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {alert.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // =====================================================
  // MAIN DASHBOARD RENDER
  // =====================================================
  
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Performance Dashboard</h1>
            <p className="text-gray-600">Real-time monitoring of emulator and streaming performance</p>
          </div>
          
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
            
            <button
              onClick={() => window.location.reload()}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Activity className="w-6 h-6 text-blue-600" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Active Sessions</h3>
                <p className="text-2xl font-bold text-gray-900">
                  {emulatorSessions.filter(s => s.status === 'running').length}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <Users className="w-6 h-6 text-green-600" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Stream Viewers</h3>
                <p className="text-2xl font-bold text-gray-900">
                  {streamSessions.reduce((sum, s) => sum + s.viewerCount, 0)}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Zap className="w-6 h-6 text-yellow-600" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Avg FPS</h3>
                <p className="text-2xl font-bold text-gray-900">
                  {emulatorSessions.length > 0
                    ? (emulatorSessions.reduce((sum, s) => sum + s.fps, 0) / emulatorSessions.length).toFixed(0)
                    : '0'
                  }
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Alerts</h3>
                <p className="text-2xl font-bold text-gray-900">
                  {alerts.filter(a => a.type === 'error').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* System Overview - Full Width */}
          <div className="col-span-12">
            <SystemOverview />
          </div>
          
          {/* Emulator Sessions - 2/3 Width */}
          <div className="col-span-8">
            <EmulatorSessions />
          </div>
          
          {/* Alerts Panel - 1/3 Width */}
          <div className="col-span-4">
            <AlertsPanel />
          </div>
          
          {/* Streaming Sessions - Full Width */}
          <div className="col-span-12">
            <StreamingSessions />
          </div>
        </div>

        {/* Settings Panel */}
        {showDetails && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Dashboard Settings</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Refresh Interval (ms)
                  </label>
                  <select
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  >
                    <option value={500}>500ms (High Frequency)</option>
                    <option value={1000}>1s (Normal)</option>
                    <option value={5000}>5s (Low Frequency)</option>
                    <option value={10000}>10s (Battery Saver)</option>
                  </select>
                </div>
                
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isConnected}
                      disabled
                      className="mr-2"
                    />
                    Real-time Updates
                  </label>
                </div>
              </div>
              
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  onClick={() => setShowDetails(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowDetails(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerformanceDashboard;