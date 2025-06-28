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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Built for the retro gaming community by doug12r**
