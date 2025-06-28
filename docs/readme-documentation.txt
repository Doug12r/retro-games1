# 🎮 RetroGame Backend

**Enterprise-grade backend API for retro game ROM management with industrial-strength file upload handling, metadata scraping, and comprehensive game library management.**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://www.fastify.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

## ✨ Features

### 🚀 **Industrial-Strength File Upload System**
- **Chunked Upload Processing**: Handle files up to 4GB with resumable uploads
- **Multi-format Archive Support**: ZIP, 7Z, RAR, TAR with automatic extraction
- **File Validation**: Magic number verification, virus scanning, integrity checks
- **Duplicate Detection**: SHA256 hash-based duplicate prevention
- **Progress Tracking**: Real-time upload progress via WebSockets

### 🎯 **Comprehensive ROM Format Support**
- **Nintendo Systems**: NES, SNES, N64, Game Boy, GBA, DS
- **Sega Systems**: Genesis, Master System, Saturn, Dreamcast
- **Sony Systems**: PlayStation, PlayStation 2, PSP
- **Arcade Systems**: MAME, Neo Geo, CPS
- **Computer Systems**: DOS, Amiga, C64, Atari 2600

### 🔍 **Advanced Metadata Scraping**
- **Multiple Sources**: IGDB, TheGamesDB, ScreenScraper integration
- **Intelligent Matching**: Fuzzy string matching with confidence scoring
- **Rich Metadata**: Box art, screenshots, descriptions, ratings
- **Regional Support**: Multi-language and region-specific data
- **Automatic Fallbacks**: Local database with manual override options

### 📊 **Game Library Management**
- **Advanced Search & Filtering**: Full-text search with faceted filtering
- **Statistics Tracking**: Play time, session counts, usage analytics
- **User Features**: Favorites, ratings, notes, save states
- **Platform Organization**: Hierarchical organization by platform
- **Duplicate Management**: Smart duplicate detection and merging

### 🔧 **Enterprise Architecture**
- **High Performance**: Fastify framework with TypeScript
- **Scalable Database**: PostgreSQL with Prisma ORM
- **Caching Layer**: Redis for performance optimization
- **Real-time Updates**: WebSocket support for live progress
- **Comprehensive Logging**: Structured logging with Pino
- **Docker Ready**: Full containerization with docker-compose

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │   Database      │
│   (React)       │◄──►│   (Fastify)     │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   File Storage  │    │   Redis Cache   │
                       │   (Local/Cloud) │    │   (Sessions)    │
                       └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │  ROM Processing │
                       │  & Metadata     │
                       └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ LTS
- **PostgreSQL** 15+
- **Redis** 7+
- **Docker** & **Docker Compose** (optional but recommended)

### Option 1: Docker Compose (Recommended)

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/retro-game-backend.git
   cd retro-game-backend
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start the services**
   ```bash
   docker-compose up -d
   ```

4. **Initialize the database**
   ```bash
   docker-compose exec backend npm run db:migrate
   docker-compose exec backend npm run db:seed
   ```

5. **Access the API**
   - API: http://localhost:3001
   - Health Check: http://localhost:3001/api/health
   - API Documentation: http://localhost:3001/docs

### Option 2: Manual Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up database**
   ```bash
   # Start PostgreSQL and Redis
   npm run db:migrate
   npm run db:seed
   ```

3. **Build and start**
   ```bash
   npm run build
   npm start
   ```

## 📖 API Documentation

### Core Endpoints

#### Upload Management
```http
POST   /api/upload/initiate          # Initialize chunked upload
POST   /api/upload/chunk/:id/:index  # Upload file chunk
GET    /api/upload/status/:id        # Get upload status
DELETE /api/upload/cancel/:id        # Cancel upload
```

#### Game Library
```http
GET    /api/games                    # List games (paginated)
GET    /api/games/:id                # Get game details
PUT    /api/games/:id                # Update game
DELETE /api/games/:id                # Delete game
POST   /api/games/:id/play           # Record play session
POST   /api/games/:id/favorite       # Toggle favorite
```

#### Platform Management
```http
GET    /api/platforms                # List platforms
GET    /api/platforms/:id            # Get platform details
POST   /api/platforms                # Create platform
PUT    /api/platforms/:id            # Update platform
GET    /api/platforms/:id/stats      # Platform statistics
```

#### Search & Discovery
```http
POST   /api/search                   # Advanced search
GET    /api/stats                    # System statistics
GET    /api/info                     # System information
```

### WebSocket Events

Connect to `/ws` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

// Subscribe to upload progress
ws.send(JSON.stringify({
  type: 'subscribe_upload',
  uploadId: 'your-upload-id'
}));

// Listen for progress updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'upload_progress') {
    console.log('Progress:', data.data.progress);
  }
};
```

## 🔧 Configuration

### Environment Variables

Key configuration options in `.env`:

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/retrogame

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

# Storage
UPLOAD_DIR=./uploads
ROM_DIR=./roms
MAX_FILE_SIZE=4294967296

# API Keys (optional but recommended)
IGDB_CLIENT_ID=your_client_id
IGDB_CLIENT_SECRET=your_client_secret
THEGAMESDB_API_KEY=your_api_key
```

### Supported File Formats

| Platform | Extensions | BIOS Required |
|----------|------------|---------------|
| NES | `.nes`, `.unif`, `.fds` | No |
| SNES | `.sfc`, `.smc`, `.fig`, `.swc` | No |
| N64 | `.n64`, `.v64`, `.z64`, `.rom` | No |
| Game Boy | `.gb`, `.gbc`, `.sgb` | No |
| GBA | `.gba`, `.agb`, `.bin` | Yes |
| Genesis | `.md`, `.gen`, `.smd`, `.bin` | No |
| PlayStation | `.bin`, `.cue`, `.iso`, `.pbp`, `.chd` | Yes |
| PlayStation 2 | `.iso`, `.bin`, `.mdf`, `.nrg` | Yes |
| Archives | `.zip`, `.7z`, `.rar` | - |

## 🔒 Security Features

- **Input Validation**: Comprehensive validation with Zod schemas
- **File Scanning**: Optional virus scanning with ClamAV
- **Rate Limiting**: Configurable request rate limiting
- **CORS Protection**: Configurable cross-origin policies
- **Security Headers**: Helmet.js for security headers
- **Path Traversal Protection**: Secure file path handling
- **Archive Bomb Protection**: Size and ratio limits

## 📊 Monitoring & Observability

### Logging
- **Structured Logging**: JSON-formatted logs with Pino
- **Log Levels**: Configurable from fatal to trace
- **Correlation IDs**: Request tracking across services
- **Performance Metrics**: Response times and throughput

### Health Checks
```bash
# Basic health check
curl http://localhost:3001/api/health

# Detailed system statistics
curl http://localhost:3001/api/stats
```

### Metrics (Optional)
- **Prometheus**: Metrics collection
- **Grafana**: Visualization dashboard
- **Alert Manager**: Monitoring alerts

## 🧪 Development

### Running Tests
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Code Quality
```bash
# Lint code
npm run lint

# Format code
npm run format

# Type checking
npm run build
```

### Database Operations
```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Reset database
npm run db:reset

# Seed data
npm run db:seed
```

## 🚀 Deployment

### Production Checklist

1. **Environment Setup**
   - [ ] Copy `.env.example` to `.env.production`
   - [ ] Set strong passwords and secrets
   - [ ] Configure API keys for metadata scraping
   - [ ] Set up SSL/TLS certificates

2. **Database Setup**
   - [ ] Deploy PostgreSQL instance
   - [ ] Run database migrations
   - [ ] Set up database backups
   - [ ] Configure connection pooling

3. **Redis Setup**
   - [ ] Deploy Redis instance
   - [ ] Configure persistence
   - [ ] Set up clustering (if needed)

4. **File Storage**
   - [ ] Configure storage directories
   - [ ] Set up backup strategy
   - [ ] Consider cloud storage integration

5. **Security**
   - [ ] Enable virus scanning
   - [ ] Configure rate limiting
   - [ ] Set up monitoring and alerts
   - [ ] Review and test security measures

### Docker Production Deployment

```bash
# Build production image
docker build -t retro-game-backend:latest .

# Deploy with docker-compose
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Monitor logs
docker-compose logs -f backend
```

### Kubernetes Deployment

Helm charts and Kubernetes manifests are available in the `/k8s` directory:

```bash
# Deploy with Helm
helm install retro-game ./k8s/helm-chart

# Or use kubectl
kubectl apply -f k8s/manifests/
```

## 🔧 Troubleshooting

### Common Issues

**Upload failures**
- Check disk space and permissions
- Verify file format support
- Check upload size limits

**Database connection errors**
- Verify DATABASE_URL configuration
- Check PostgreSQL service status
- Review connection pool settings

**Redis connection issues**
- Verify Redis service status
- Check authentication credentials
- Review network connectivity

**Memory issues**
- Monitor memory usage during uploads
- Adjust chunk sizes for large files
- Configure garbage collection

### Debug Logging
```bash
# Enable debug logging
LOG_LEVEL=debug npm start

# Or with Docker
docker-compose up -d
docker-compose logs -f backend
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Install dependencies: `npm install`
4. Run tests: `npm test`
5. Submit a pull request

### Code Standards
- **TypeScript**: Strict mode enabled
- **ESLint**: Airbnb configuration
- **Prettier**: Code formatting
- **Conventional Commits**: Commit message format

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Emulation Community**: For format specifications and tools
- **Open Source Libraries**: All the amazing libraries that make this possible
- **Contributors**: Everyone who has contributed to this project

## 📞 Support

- **Documentation**: [docs.retrogame.dev](https://docs.retrogame.dev)
- **Issues**: [GitHub Issues](https://github.com/your-org/retro-game-backend/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/retro-game-backend/discussions)
- **Discord**: [Community Server](https://discord.gg/retrogame)

---

**Built with ❤️ for the retro gaming community**