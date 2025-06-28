import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Download,
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  Trash2,
  Info,
  Shield,
  HardDrive,
  Cpu,
  Settings,
  Eye,
  EyeOff,
  RefreshCw
} from 'lucide-react';

// =====================================================
// BIOS MANAGEMENT SYSTEM
// =====================================================

interface BiosFile {
  id: string;
  fileName: string;
  displayName: string;
  filePath: string;
  fileSize: number;
  fileHash: string;
  platforms: string[];
  region: string;
  version: string;
  description: string;
  isRequired: boolean;
  isValidated: boolean;
  validationError?: string;
  uploadedAt: Date;
  lastValidated?: Date;
}

interface PlatformBiosInfo {
  platformId: string;
  platformName: string;
  biosRequired: boolean;
  requiredFiles: Array<{
    fileName: string;
    description: string;
    isOptional: boolean;
    expectedHash?: string;
    expectedSize?: number;
  }>;
  status: 'complete' | 'partial' | 'missing';
  missingFiles: string[];
}

interface BiosValidationResult {
  isValid: boolean;
  hash: string;
  size: number;
  format: string;
  region?: string;
  version?: string;
  errors: string[];
  warnings: string[];
}

const BiosManagementSystem: React.FC = () => {
  // =====================================================
  // STATE MANAGEMENT
  // =====================================================
  
  const [biosFiles, setBiosFiles] = useState<BiosFile[]>([]);
  const [platformInfo, setPlatformInfo] = useState<PlatformBiosInfo[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyRequired, setShowOnlyRequired] = useState(false);
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
  const [validationResults, setValidationResults] = useState<{ [key: string]: BiosValidationResult }>({});
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState<{ [key: string]: boolean }>({});
  const [sortBy, setSortBy] = useState<'name' | 'platform' | 'size' | 'date'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // =====================================================
  // DATA FETCHING
  // =====================================================
  
  useEffect(() => {
    loadBiosFiles();
    loadPlatformInfo();
  }, []);

  const loadBiosFiles = async () => {
    try {
      const response = await fetch('/api/bios');
      const data = await response.json();
      setBiosFiles(data.biosFiles);
    } catch (error) {
      console.error('Failed to load BIOS files:', error);
    }
  };

  const loadPlatformInfo = async () => {
    try {
      const response = await fetch('/api/platforms');
      const data = await response.json();
      
      const platformBiosInfo = data.platforms.map((platform: any) => ({
        platformId: platform.id,
        platformName: platform.name,
        biosRequired: platform.biosRequired,
        requiredFiles: platform.biosFiles?.map((file: string) => ({
          fileName: file,
          description: getBiosDescription(file),
          isOptional: false,
          expectedHash: getExpectedHash(file),
          expectedSize: getExpectedSize(file)
        })) || [],
        status: calculatePlatformStatus(platform),
        missingFiles: getMissingFiles(platform)
      }));
      
      setPlatformInfo(platformBiosInfo);
    } catch (error) {
      console.error('Failed to load platform info:', error);
    }
  };

  // =====================================================
  // UTILITY FUNCTIONS
  // =====================================================
  
  const getBiosDescription = (fileName: string): string => {
    const descriptions: { [key: string]: string } = {
      'scph1001.bin': 'PlayStation BIOS (NTSC-U)',
      'scph5501.bin': 'PlayStation BIOS (NTSC-U) v2.0',
      'scph7001.bin': 'PlayStation BIOS (NTSC-U) v4.1',
      'gba_bios.bin': 'Game Boy Advance BIOS',
      'bios7.bin': 'Nintendo DS ARM7 BIOS',
      'bios9.bin': 'Nintendo DS ARM9 BIOS',
      'firmware.bin': 'Nintendo DS Firmware',
      'neogeo.zip': 'Neo Geo BIOS',
      'kick31.rom': 'Amiga Kickstart 3.1',
      'kick13.rom': 'Amiga Kickstart 1.3'
    };
    return descriptions[fileName] || fileName;
  };

  const getExpectedHash = (fileName: string): string | undefined => {
    const hashes: { [key: string]: string } = {
      'scph1001.bin': '239665b1a3dade1b5a52c06338011044',
      'scph5501.bin': '8dd7d5296a650fac7319bce665a6a53c',
      'gba_bios.bin': 'a860e8c0b6d573d191e4ec7db1b1e4f6'
    };
    return hashes[fileName];
  };

  const getExpectedSize = (fileName: string): number | undefined => {
    const sizes: { [key: string]: number } = {
      'scph1001.bin': 524288,
      'scph5501.bin': 524288,
      'gba_bios.bin': 16384
    };
    return sizes[fileName];
  };

  const calculatePlatformStatus = (platform: any): 'complete' | 'partial' | 'missing' => {
    if (!platform.biosRequired) return 'complete';
    
    const requiredFiles = platform.biosFiles || [];
    const availableFiles = biosFiles.filter(b => 
      requiredFiles.includes(b.fileName) && b.isValidated
    );
    
    if (availableFiles.length === requiredFiles.length) return 'complete';
    if (availableFiles.length > 0) return 'partial';
    return 'missing';
  };

  const getMissingFiles = (platform: any): string[] => {
    if (!platform.biosRequired) return [];
    
    const requiredFiles = platform.biosFiles || [];
    const availableFiles = biosFiles.map(b => b.fileName);
    
    return requiredFiles.filter((file: string) => !availableFiles.includes(file));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'partial':
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'missing':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <FileText className="w-5 h-5 text-gray-600" />;
    }
  };

  // =====================================================
  // FILE OPERATIONS
  // =====================================================
  
  const handleFileUpload = async (files: FileList) => {
    const fileArray = Array.from(files);
    
    for (const file of fileArray) {
      const formData = new FormData();
      formData.append('file', file);
      
      try {
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
        
        const response = await fetch('/api/bios/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (response.ok) {
          setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
          await validateBiosFile(file.name);
          await loadBiosFiles();
        } else {
          throw new Error('Upload failed');
        }
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        setUploadProgress(prev => {
          const updated = { ...prev };
          delete updated[file.name];
          return updated;
        });
      }
    }
  };

  const validateBiosFile = async (fileName: string) => {
    try {
      const response = await fetch(`/api/bios/${fileName}/validate`, {
        method: 'POST'
      });
      const result = await response.json();
      
      setValidationResults(prev => ({
        ...prev,
        [fileName]: result
      }));
      
      return result;
    } catch (error) {
      console.error(`Failed to validate ${fileName}:`, error);
      return null;
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const deleteBiosFile = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this BIOS file?')) return;
    
    try {
      const response = await fetch(`/api/bios/${fileId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        await loadBiosFiles();
        await loadPlatformInfo();
      }
    } catch (error) {
      console.error('Failed to delete BIOS file:', error);
    }
  };

  const downloadBiosFile = async (file: BiosFile) => {
    try {
      const response = await fetch(`/api/bios/${file.fileName}/download`);
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download BIOS file:', error);
    }
  };

  const validateAllFiles = async () => {
    for (const file of biosFiles) {
      await validateBiosFile(file.fileName);
    }
  };

  // =====================================================
  // FILTERING AND SORTING
  // =====================================================
  
  const filteredFiles = biosFiles.filter(file => {
    if (selectedPlatform !== 'all' && !file.platforms.includes(selectedPlatform)) {
      return false;
    }
    
    if (searchTerm && !file.fileName.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !file.description.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    
    if (showOnlyRequired && !file.isRequired) {
      return false;
    }
    
    if (showOnlyMissing && file.isValidated) {
      return false;
    }
    
    return true;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'name':
        comparison = a.fileName.localeCompare(b.fileName);
        break;
      case 'platform':
        comparison = a.platforms[0]?.localeCompare(b.platforms[0] || '') || 0;
        break;
      case 'size':
        comparison = a.fileSize - b.fileSize;
        break;
      case 'date':
        comparison = a.uploadedAt.getTime() - b.uploadedAt.getTime();
        break;
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  // =====================================================
  // COMPONENT SECTIONS
  // =====================================================
  
  const PlatformOverview: React.FC = () => (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">Platform BIOS Status</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {platformInfo.map((platform) => (
          <div
            key={platform.platformId}
            className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
            onClick={() => setSelectedPlatform(platform.platformId)}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">{platform.platformName}</h3>
              {getStatusIcon(platform.status)}
            </div>
            
            <div className="text-sm text-gray-600">
              {platform.biosRequired ? (
                <>
                  <div className="flex justify-between">
                    <span>Required files:</span>
                    <span>{platform.requiredFiles.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Missing:</span>
                    <span className={platform.missingFiles.length > 0 ? 'text-red-600' : 'text-green-600'}>
                      {platform.missingFiles.length}
                    </span>
                  </div>
                </>
              ) : (
                <span className="text-green-600">No BIOS required</span>
              )}
            </div>
            
            {platform.missingFiles.length > 0 && (
              <div className="mt-2">
                <details className="text-xs">
                  <summary className="cursor-pointer text-red-600">
                    Missing files ({platform.missingFiles.length})
                  </summary>
                  <ul className="mt-1 pl-4 list-disc">
                    {platform.missingFiles.map(file => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const UploadArea: React.FC = () => (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">Upload BIOS Files</h2>
      
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
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
          Drop BIOS files here or click to browse
        </h3>
        <p className="text-gray-500 mb-4">
          Supports .bin, .rom, .zip and other common BIOS file formats
        </p>
        
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".bin,.rom,.zip,.bios"
          onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
          className="hidden"
        />
        
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          Choose Files
        </button>
      </div>
      
      {/* Upload Progress */}
      {Object.keys(uploadProgress).length > 0 && (
        <div className="mt-4 space-y-2">
          {Object.entries(uploadProgress).map(([fileName, progress]) => (
            <div key={fileName} className="flex items-center space-x-3">
              <span className="text-sm font-medium min-w-0 flex-1 truncate">{fileName}</span>
              <div className="w-32 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 w-12 text-right">{progress}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const FilesTable: React.FC = () => (
    <div className="bg-white rounded-lg shadow">
      {/* Table Header with Controls */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">BIOS Files ({sortedFiles.length})</h2>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={validateAllFiles}
              className="flex items-center space-x-2 px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Validate All</span>
            </button>
            
            {selectedFiles.size > 0 && (
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedFiles.size} selected files?`)) {
                    selectedFiles.forEach(id => deleteBiosFile(id));
                    setSelectedFiles(new Set());
                  }
                }}
                className="flex items-center space-x-2 px-3 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete ({selectedFiles.size})</span>
              </button>
            )}
          </div>
        </div>
        
        {/* Filters and Search */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-2">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search BIOS files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="all">All Platforms</option>
            {platformInfo.map(platform => (
              <option key={platform.platformId} value={platform.platformId}>
                {platform.platformName}
              </option>
            ))}
          </select>
          
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={showOnlyRequired}
              onChange={(e) => setShowOnlyRequired(e.target.checked)}
            />
            <span>Required only</span>
          </label>
          
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={showOnlyMissing}
              onChange={(e) => setShowOnlyMissing(e.target.checked)}
            />
            <span>Missing only</span>
          </label>
          
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [newSortBy, newSortOrder] = e.target.value.split('-');
              setSortBy(newSortBy as any);
              setSortOrder(newSortOrder as any);
            }}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="platform-asc">Platform A-Z</option>
            <option value="platform-desc">Platform Z-A</option>
            <option value="size-asc">Size Low-High</option>
            <option value="size-desc">Size High-Low</option>
            <option value="date-asc">Date Old-New</option>
            <option value="date-desc">Date New-Old</option>
          </select>
        </div>
      </div>
      
      {/* Files Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <input
                  type="checkbox"
                  checked={selectedFiles.size === sortedFiles.length && sortedFiles.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedFiles(new Set(sortedFiles.map(f => f.id)));
                    } else {
                      setSelectedFiles(new Set());
                    }
                  }}
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                File
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Platform
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Size
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedFiles.map((file) => (
              <React.Fragment key={file.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.id)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedFiles);
                        if (e.target.checked) {
                          newSelected.add(file.id);
                        } else {
                          newSelected.delete(file.id);
                        }
                        setSelectedFiles(newSelected);
                      }}
                    />
                  </td>
                  
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <FileText className="w-5 h-5 text-gray-400 mr-3" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{file.fileName}</div>
                        <div className="text-sm text-gray-500">{file.description}</div>
                      </div>
                    </div>
                  </td>
                  
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {file.platforms.map(platform => (
                        <span
                          key={platform}
                          className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800"
                        >
                          {platform}
                        </span>
                      ))}
                    </div>
                  </td>
                  
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatFileSize(file.fileSize)}
                  </td>
                  
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {file.isValidated ? (
                        <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600 mr-2" />
                      )}
                      <span className={`text-sm ${file.isValidated ? 'text-green-600' : 'text-red-600'}`}>
                        {file.isValidated ? 'Valid' : 'Invalid'}
                      </span>
                      {file.isRequired && (
                        <Shield className="w-4 h-4 text-yellow-600 ml-2" title="Required" />
                      )}
                    </div>
                  </td>
                  
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setShowDetails(prev => ({ ...prev, [file.id]: !prev[file.id] }))}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        {showDetails[file.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      
                      <button
                        onClick={() => downloadBiosFile(file)}
                        className="text-green-600 hover:text-green-900"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      
                      <button
                        onClick={() => validateBiosFile(file.fileName)}
                        className="text-yellow-600 hover:text-yellow-900"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      
                      <button
                        onClick={() => deleteBiosFile(file.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                
                {/* Expandable Details Row */}
                {showDetails[file.id] && (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 bg-gray-50">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <h4 className="font-medium mb-2">File Information</h4>
                          <dl className="space-y-1">
                            <div className="flex justify-between">
                              <dt className="text-gray-500">Hash:</dt>
                              <dd className="font-mono text-xs">{file.fileHash}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-gray-500">Uploaded:</dt>
                              <dd>{file.uploadedAt.toLocaleDateString()}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-gray-500">Region:</dt>
                              <dd>{file.region || 'Unknown'}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-gray-500">Version:</dt>
                              <dd>{file.version || 'Unknown'}</dd>
                            </div>
                          </dl>
                        </div>
                        
                        <div>
                          <h4 className="font-medium mb-2">Validation</h4>
                          {validationResults[file.fileName] ? (
                            <div className="space-y-1">
                              <div className={`text-sm ${validationResults[file.fileName].isValid ? 'text-green-600' : 'text-red-600'}`}>
                                {validationResults[file.fileName].isValid ? 'Valid BIOS file' : 'Invalid BIOS file'}
                              </div>
                              {validationResults[file.fileName].errors.map((error, i) => (
                                <div key={i} className="text-red-600 text-xs">{error}</div>
                              ))}
                              {validationResults[file.fileName].warnings.map((warning, i) => (
                                <div key={i} className="text-yellow-600 text-xs">{warning}</div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-gray-500 text-sm">Not validated</div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        
        {sortedFiles.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No BIOS files found</p>
            <p>Upload some BIOS files to get started</p>
          </div>
        )}
      </div>
    </div>
  );

  // =====================================================
  // MAIN RENDER
  // =====================================================
  
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">BIOS Management</h1>
          <p className="text-gray-600">
            Manage BIOS files for all supported emulation platforms
          </p>
        </div>

        {/* Platform Overview */}
        <PlatformOverview />
        
        {/* Upload Area */}
        <UploadArea />
        
        {/* Files Table */}
        <FilesTable />
      </div>
    </div>
  );
};

export default BiosManagementSystem;