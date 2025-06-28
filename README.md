# Retro Games1 Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![CI/CD](https://github.com/doug12r/retro-games1/actions/workflows/ci.yml/badge.svg)](https://github.com/doug12r/retro-games1/actions)

**Enterprise-grade retro game server with ROM management, browser-based emulation, and modern web interface**

[Documentation](docs/) • [Quick Start](#quick-start) • [API Docs](docs/API.md) • [Contributing](CONTRIBUTING.md)

## Features

**Industrial-Strength File Upload System**
- Chunked upload processing for files up to 4GB with resume capability
- Real-time progress tracking with speed/ETA indicators
- Comprehensive file validation and integrity checking
- Support for ZIP/7Z/RAR archive extraction

**Comprehensive Emulation Support**
- Browser-based emulation for lightweight games (EmulatorJS)
- Native emulator integration for demanding titles (RetroArch)
- Support for 50+ retro gaming platforms
- VNC streaming for native emulator output

**Advanced ROM Management**
- Automatic metadata scraping from multiple sources (IGDB, TheGamesDB)
- Intelligent duplicate detection with SHA256 hashing
- Platform-specific organization and categorization
- Box art and screenshot downloads

**Modern Web Interface**
- Responsive design with mobile-first approach
- Real-time upload progress via WebSockets
- Game library with advanced search and filtering
- Touch-friendly controls for mobile gaming

**Enterprise Architecture**
- Docker containerization with microservices
- PostgreSQL database with Redis caching
- Comprehensive monitoring and logging
- Production-ready security hardening

## Supported Platforms

### Nintendo Systems
- **NES** - Nintendo Entertainment System
- **SNES** - Super Nintendo Entertainment System
- **N64** - Nintendo 64
- **Game Boy** - Original and Color
- **GBA** - Game Boy Advance
- **DS** - Nintendo DS

### Sega Systems
- **Genesis** - Sega Genesis/Mega Drive
- **Master System** - Sega Master System
- **Saturn** - Sega Saturn
- **Dreamcast** - Sega Dreamcast

### Sony Systems
- **PlayStation** - Original PlayStation
- **PlayStation 2** - PS2
- **PSP** - PlayStation Portable

### Arcade Systems
- **MAME** - Multiple Arcade Machine Emulator
- **Neo Geo** - SNK Neo Geo
- **CPS** - Capcom Play System

### Computer Systems
- **DOS** - MS-DOS games
- **Amiga** - Commodore Amiga
- **C64** - Commodore 64
- **Atari 2600** - Atari Video Computer System

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for development)
- 4GB+ RAM and 50GB+ storage

### Installation

1. **Clone the repository**
   `ash
   git clone https://github.com/doug12r/retro-games1.git
   cd retro-games1
   `

2. **Set up environment**
   `ash
   cp .env.example .env
   # Edit .env with your configuration
   `

3. **Start the server**
   `ash
   make prod
   `

4. **Access the application**
   - Web Interface: http://localhost
   - API Documentation: http://localhost/api/docs
   - Admin Panel: http://admin.localhost

### Development Setup

`ash
# Set up development environment
make setup-dev

# Start development servers
make dev

# Run tests
make test
`

## Project Structure

`
retro-games1/
├── backend/           # Node.js TypeScript API
├── frontend/          # React TypeScript UI
├── emulator/          # Emulator service
├── infrastructure/    # Docker, K8s, monitoring
├── scripts/           # Build and deployment scripts
├── docs/              # Comprehensive documentation
└── tests/             # Integration and E2E tests
`

## Configuration

### Environment Variables

Key configuration options in .env:

- **Database**: PostgreSQL connection settings
- **Redis**: Cache configuration
- **Storage**: ROM and media storage paths
- **Security**: JWT secrets and encryption keys
- **External APIs**: IGDB, TheGamesDB API keys
- **Emulator**: VNC and display settings

### Docker Services

- **Frontend**: React application with Nginx
- **Backend**: Node.js API with Fastify
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **Emulator**: RetroArch with VNC
- **Proxy**: Caddy reverse proxy

## Documentation

- [Installation Guide](docs/guides/installation.md)
- [Architecture Overview](docs/architecture/overview.md)
- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [ROM Management](docs/guides/rom-management.md)
- [Emulator Setup](docs/guides/emulator-setup.md)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: git checkout -b feature/amazing-feature
3. Make your changes with proper commit messages
4. Add tests and ensure they pass
5. Submit a pull request

### Code Standards

- **TypeScript**: Strict mode enabled
- **ESLint**: Airbnb configuration
- **Prettier**: Code formatting
- **Conventional Commits**: Commit message format

## Deployment

### Production Deployment

`ash
# Production with Docker Compose
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Monitor services
docker-compose logs -f
`

### Kubernetes Deployment

`ash
# Deploy with Kubernetes
kubectl apply -f infrastructure/kubernetes/

# Monitor deployment
kubectl get pods -n retro-games1
`

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Emulation Community**: For format specifications and emulator development
- **Open Source Libraries**: All the amazing libraries that make this possible
- **Contributors**: Everyone who has contributed to this project
- **RetroArch Team**: For the comprehensive emulation framework

## Support

- **Issues**: [GitHub Issues](https://github.com/doug12r/retro-games1/issues)
- **Discussions**: [GitHub Discussions](https://github.com/doug12r/retro-games1/discussions)
- **Documentation**: [Project Wiki](https://github.com/doug12r/retro-games1/wiki)

---

**Built for the retro gaming community by doug12r**
