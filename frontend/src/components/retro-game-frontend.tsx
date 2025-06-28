import React, { useState, useCallback, useEffect } from 'react';
import { Upload, Play, Search, Filter, Grid, List, CheckCircle, AlertCircle, Clock, X } from 'lucide-react';

// Types
interface GamePlatform {
  id: string;
  name: string;
  extensions: string[];
  icon: string;
}

interface UploadProgress {
  fileName: string;
  progress: number;
  speed: number;
  eta: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  chunks: number;
  totalChunks: number;
}

interface GameMetadata {
  id: string;
  title: string;
  platform: string;
  genre: string;
  year: number;
  rating: number;
  boxArt?: string;
  size: number;
  lastPlayed?: Date;
}

// Supported platforms and formats
const SUPPORTED_PLATFORMS: GamePlatform[] = [
  { id: 'nes', name: 'Nintendo NES', extensions: ['.nes', '.unif', '.fds'], icon: '🎮' },
  { id: 'snes', name: 'Super Nintendo', extensions: ['.sfc', '.smc', '.fig', '.swc'], icon: '🎮' },
  { id: 'n64', name: 'Nintendo 64', extensions: ['.n64', '.v64', '.z64', '.rom'], icon: '🎮' },
  { id: 'gameboy', name: 'Game Boy', extensions: ['.gb', '.gbc', '.sgb'], icon: '📱' },
  { id: 'gba', name: 'Game Boy Advance', extensions: ['.gba', '.agb'], icon: '📱' },
  { id: 'genesis', name: 'Sega Genesis', extensions: ['.md', '.gen', '.smd', '.bin'], icon: '🎮' },
  { id: 'psx', name: 'PlayStation', extensions: ['.bin', '.cue', '.iso', '.img', '.pbp', '.chd'], icon: '💿' },
  { id: 'ps2', name: 'PlayStation 2', extensions: ['.iso', '.bin', '.mdf', '.nrg'], icon: '💿' },
  { id: 'arcade', name: 'Arcade', extensions: ['.zip', '.7z', '.rar'], icon: '🕹️' },
];

// Utility functions
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatTime = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
};

const validateFile = (file: File): { valid: boolean; platform?: string; errors: string[] } => {
  const errors: string[] = [];
  let platform: string | undefined;
  
  // Size check (4GB max)
  if (file.size > 4 * 1024 * 1024 * 1024) {
    errors.push('File size exceeds 4GB limit');
  }
  
  // Extension check
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  const matchingPlatform = SUPPORTED_PLATFORMS.find(p => 
    p.extensions.includes(extension)
  );
  
  if (!matchingPlatform) {
    errors.push(`Unsupported file format: ${extension}`);
  } else {
    platform = matchingPlatform.id;
  }
  
  // Filename validation
  if (file.name.match(/[<>:"/\\|?*]/)) {
    errors.push('Filename contains invalid characters');
  }
  
  return { valid: errors.length === 0, platform, errors };
};

// Components
const ProgressBar: React.FC<{ progress: number; className?: string }> = ({ progress, className = '' }) => (
  <div className={`w-full bg-gray-200 rounded-full h-2 ${className}`}>
    <div 
      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
      style={{ width: `${progress}%` }}
    />
  </div>
);

const UploadItem: React.FC<{ upload: UploadProgress; onCancel: () => void }> = ({ upload, onCancel }) => {
  const getStatusIcon = () => {
    switch (upload.status) {
      case 'complete': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error': return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'processing': return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      default: return <Clock className="w-5 h-5 text-blue-500" />;
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <span className="font-medium text-sm truncate max-w-xs">{upload.fileName}</span>
        </div>
        {upload.status === 'uploading' && (
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      
      <ProgressBar progress={upload.progress} className="mb-2" />
      
      <div className="flex justify-between text-xs text-gray-500">
        <span>
          {upload.chunks}/{upload.totalChunks} chunks • {formatBytes(upload.speed)}/s
        </span>
        <span>
          {upload.status === 'uploading' ? `${formatTime(upload.eta)} remaining` : upload.status}
        </span>
      </div>
    </div>
  );
};

const GameCard: React.FC<{ game: GameMetadata; viewMode: 'grid' | 'list' }> = ({ game, viewMode }) => {
  const platform = SUPPORTED_PLATFORMS.find(p => p.id === game.platform);
  
  if (viewMode === 'list') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center space-x-4 hover:shadow-md transition-shadow">
        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-2xl">
          {platform?.icon || '🎮'}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{game.title}</h3>
          <p className="text-sm text-gray-500">{platform?.name} • {game.year}</p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-500">{formatBytes(game.size)}</span>
          <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-1">
            <Play className="w-4 h-4" />
            <span>Play</span>
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="w-full h-32 bg-gray-100 rounded-lg mb-3 flex items-center justify-center text-4xl">
        {platform?.icon || '🎮'}
      </div>
      <h3 className="font-semibold text-gray-900 truncate mb-1">{game.title}</h3>
      <p className="text-sm text-gray-500 mb-2">{platform?.name}</p>
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">{game.year}</span>
        <button className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors">
          Play
        </button>
      </div>
    </div>
  );
};

const RetroGameApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'library' | 'upload'>('library');
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [games, setGames] = useState<GameMetadata[]>([
    {
      id: '1',
      title: 'Super Mario Bros',
      platform: 'nes',
      genre: 'Platform',
      year: 1985,
      rating: 4.8,
      size: 32 * 1024,
    },
    {
      id: '2',
      title: 'The Legend of Zelda: A Link to the Past',
      platform: 'snes',
      genre: 'Adventure',
      year: 1991,
      rating: 4.9,
      size: 1024 * 1024,
    },
    {
      id: '3',
      title: 'Sonic the Hedgehog',
      platform: 'genesis',
      genre: 'Platform',
      year: 1991,
      rating: 4.7,
      size: 512 * 1024,
    },
  ]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [dragActive, setDragActive] = useState(false);

  const filteredGames = games.filter(game => {
    const matchesSearch = game.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPlatform = selectedPlatform === 'all' || game.platform === selectedPlatform;
    return matchesSearch && matchesPlatform;
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }, []);

  const processFiles = useCallback((files: File[]) => {
    files.forEach(file => {
      const validation = validateFile(file);
      
      if (!validation.valid) {
        console.error(`Validation failed for ${file.name}:`, validation.errors);
        return;
      }
      
      // Simulate chunked upload
      const totalChunks = Math.ceil(file.size / (1024 * 1024)); // 1MB chunks
      const newUpload: UploadProgress = {
        fileName: file.name,
        progress: 0,
        speed: 0,
        eta: 0,
        status: 'uploading',
        chunks: 0,
        totalChunks,
      };
      
      setUploads(prev => [...prev, newUpload]);
      
      // Simulate upload progress
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          
          setUploads(prev => prev.map(upload => 
            upload.fileName === file.name 
              ? { ...upload, progress: 100, status: 'complete' as const }
              : upload
          ));
          
          // Add to games library
          const platform = SUPPORTED_PLATFORMS.find(p => 
            p.extensions.some(ext => file.name.toLowerCase().endsWith(ext))
          );
          
          if (platform) {
            const newGame: GameMetadata = {
              id: Date.now().toString(),
              title: file.name.replace(/\.[^/.]+$/, ''),
              platform: platform.id,
              genre: 'Unknown',
              year: new Date().getFullYear(),
              rating: 0,
              size: file.size,
            };
            
            setGames(prev => [...prev, newGame]);
          }
        } else {
          const speed = Math.random() * 1024 * 1024 * 5; // Random speed up to 5MB/s
          const eta = ((100 - progress) / progress) * (Date.now() / 1000);
          
          setUploads(prev => prev.map(upload => 
            upload.fileName === file.name 
              ? { 
                  ...upload, 
                  progress, 
                  speed,
                  eta,
                  chunks: Math.floor((progress / 100) * totalChunks)
                }
              : upload
          ));
        }
      }, 200);
    });
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
  }, [processFiles]);

  const cancelUpload = useCallback((fileName: string) => {
    setUploads(prev => prev.filter(upload => upload.fileName !== fileName));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">🎮 RetroHub</h1>
            </div>
            <nav className="flex space-x-8">
              <button
                onClick={() => setActiveTab('library')}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === 'library'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Game Library
              </button>
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  activeTab === 'upload'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Upload ROMs
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'library' && (
          <div>
            {/* Search and Filters */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search games..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <select
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Platforms</option>
                {SUPPORTED_PLATFORMS.map(platform => (
                  <option key={platform.id} value={platform.id}>
                    {platform.name}
                  </option>
                ))}
              </select>
              
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-4 py-2 ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-4 py-2 ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Games Grid/List */}
            <div className={
              viewMode === 'grid' 
                ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                : 'space-y-3'
            }>
              {filteredGames.map(game => (
                <GameCard key={game.id} game={game} viewMode={viewMode} />
              ))}
            </div>

            {filteredGames.length === 0 && (
              <div className="text-center py-12">
                <div className="text-gray-400 text-6xl mb-4">🎮</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No games found</h3>
                <p className="text-gray-500">Try adjusting your search or upload some ROMs to get started.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'upload' && (
          <div>
            {/* Upload Zone */}
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                dragActive 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Drop ROM files here or click to browse
              </h3>
              <p className="text-gray-500 mb-4">
                Supports files up to 4GB. Multiple formats supported including ISO, BIN, ROM, ZIP and more.
              </p>
              <input
                type="file"
                multiple
                accept=".nes,.snes,.n64,.gb,.gbc,.gba,.md,.gen,.bin,.iso,.cue,.zip,.7z,.rar"
                onChange={handleFileInput}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
              >
                Choose Files
              </label>
            </div>

            {/* Supported Formats */}
            <div className="mt-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Supported Platforms</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {SUPPORTED_PLATFORMS.map(platform => (
                  <div key={platform.id} className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">{platform.icon}</span>
                      <div>
                        <h4 className="font-medium text-gray-900">{platform.name}</h4>
                        <p className="text-sm text-gray-500">
                          {platform.extensions.join(', ')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upload Queue */}
            {uploads.length > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Upload Queue</h3>
                <div className="space-y-3">
                  {uploads.map((upload, index) => (
                    <UploadItem
                      key={`${upload.fileName}-${index}`}
                      upload={upload}
                      onCancel={() => cancelUpload(upload.fileName)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default RetroGameApp;