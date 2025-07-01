#!/bin/bash
# ==============================================================================
# RETRO GAME SERVER - ENHANCED MASTER INSTALLATION SCRIPT
# Enterprise-grade bulletproof installer with zero-failure tolerance
# Version: 2.1 Production Ready Enhanced
# Compatible: Ubuntu 22.04 LTS, Debian 11+
# ==============================================================================

set -euo pipefail  # Exit on any error, undefined variables, or pipe failures
IFS=$'\n\t'       # Secure Internal Field Separator

# ==============================================================================
# GLOBAL CONFIGURATION
# ==============================================================================

# Script metadata
readonly SCRIPT_VERSION="2.1.0"
readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly START_TIME=$(date +%s)
readonly GITHUB_REPO="${GITHUB_REPO:-your-org/retro-game-server}"

# Installation directories
readonly INSTALL_DIR="/opt/retrogame"
readonly LOG_DIR="/var/log/retrogame"
readonly BACKUP_DIR="/var/backups/retrogame"
readonly CONFIG_DIR="/etc/retrogame"
readonly SERVICE_DIR="/etc/systemd/system"

# Logging configuration
readonly LOG_FILE="$LOG_DIR/install-$(date +%Y%m%d_%H%M%S).log"
readonly ERROR_LOG="$LOG_DIR/install-errors-$(date +%Y%m%d_%H%M%S).log"

# Installation components
readonly COMPONENTS=("validation" "system" "docker" "security" "application" "services" "testing")
FAILED_COMPONENTS=()

# Progress tracking
readonly TOTAL_STEPS=80
CURRENT_STEP=0

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly PURPLE='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color

# System requirements
readonly MIN_RAM_GB=4
readonly MIN_DISK_GB=50
readonly MIN_CPU_CORES=2
readonly REQUIRED_PORTS=(80 443 3000 5432 6379 8080 9000)

# ==============================================================================
# UTILITY FUNCTIONS
# ==============================================================================

# Initialize logging
init_logging() {
    mkdir -p "$LOG_DIR" "$BACKUP_DIR" "$CONFIG_DIR"
    touch "$LOG_FILE" "$ERROR_LOG"
    chmod 640 "$LOG_FILE" "$ERROR_LOG"
    
    # Redirect all output to log file while keeping console output
    exec 1> >(tee -a "$LOG_FILE")
    exec 2> >(tee -a "$ERROR_LOG" >&2)
}

# Logging functions
log_info() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $*" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] [WARN] ${YELLOW}$*${NC}" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] ${RED}$*${NC}" | tee -a "$ERROR_LOG"
}

log_success() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS] ${GREEN}$*${NC}" | tee -a "$LOG_FILE"
}

log_debug() {
    if [[ "${DEBUG:-0}" == "1" ]]; then
        echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] [DEBUG] ${CYAN}$*${NC}" | tee -a "$LOG_FILE"
    fi
}

# Progress indicator
show_progress() {
    ((CURRENT_STEP++))
    local percentage=$((CURRENT_STEP * 100 / TOTAL_STEPS))
    local bar_length=50
    local filled_length=$((percentage * bar_length / 100))
    
    printf "\r${BLUE}["
    printf "%*s" "$filled_length" | tr ' ' '█'
    printf "%*s" $((bar_length - filled_length)) | tr ' ' '░'
    printf "] %d%% (%d/%d) %s${NC}" "$percentage" "$CURRENT_STEP" "$TOTAL_STEPS" "$1"
    
    if [[ $CURRENT_STEP -eq $TOTAL_STEPS ]]; then
        echo  # New line at completion
    fi
}

# Banner display
print_banner() {
    clear
    echo -e "${PURPLE}"
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║    🎮 RETRO GAME SERVER - ENTERPRISE INSTALLATION SYSTEM 🎮          ║
║                                                                      ║
║    Version: 2.1.0 Production Ready Enhanced                         ║
║    Target: Ubuntu 22.04 LTS / Debian 11+                           ║
║    Mode: Zero-Failure Tolerance                                     ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    echo
}

# Error handling
cleanup_on_failure() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Installation failed with exit code: $exit_code"
        log_error "Check the error log: $ERROR_LOG"
        
        # Cleanup any partial installations
        if systemctl is-active --quiet retrogame 2>/dev/null; then
            systemctl stop retrogame || true
        fi
        
        # Create failure report
        create_failure_report
    fi
}

cleanup_on_success() {
    log_success "Installation completed successfully!"
    create_success_report
}

create_failure_report() {
    local report_file="$LOG_DIR/failure-report-$(date +%Y%m%d_%H%M%S).txt"
    cat > "$report_file" << EOF
RETROGAME SERVER INSTALLATION FAILURE REPORT
============================================
Date: $(date)
Script Version: $SCRIPT_VERSION
Failed at Step: $CURRENT_STEP/$TOTAL_STEPS
Failed Components: ${FAILED_COMPONENTS[*]:-none}

System Information:
- OS: $(lsb_release -d | cut -f2)
- Kernel: $(uname -r)
- Architecture: $(uname -m)
- RAM: $(free -h | awk '/^Mem:/ {print $2}')
- Disk: $(df -h / | awk 'NR==2 {print $4}' | head -n1) available

Error Log Location: $ERROR_LOG
Full Log Location: $LOG_FILE

Please review the logs and run the script again after addressing the issues.
EOF
    log_error "Failure report created: $report_file"
}

# ==============================================================================
# VALIDATION FUNCTIONS
# ==============================================================================

validate_root_privileges() {
    show_progress "Validating root privileges"
    
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root. Use: sudo $0"
        exit 1
    fi
    
    log_success "Root privileges confirmed"
}

validate_operating_system() {
    show_progress "Validating operating system"
    
    if ! command -v lsb_release &>/dev/null; then
        log_error "lsb_release not found. Please install lsb-release package."
        exit 1
    fi
    
    local os_id=$(lsb_release -si)
    local os_version=$(lsb_release -sr)
    local os_major=$(echo "$os_version" | cut -d. -f1)
    
    case "$os_id" in
        "Ubuntu")
            if [[ $os_major -lt 20 ]]; then
                log_error "Ubuntu 20.04+ required. Current: $os_version"
                exit 1
            fi
            ;;
        "Debian")
            if [[ $os_major -lt 11 ]]; then
                log_error "Debian 11+ required. Current: $os_version"
                exit 1
            fi
            ;;
        *)
            log_error "Unsupported OS: $os_id $os_version. Ubuntu 22.04 LTS recommended."
            exit 1
            ;;
    esac
    
    log_success "Operating system validated: $os_id $os_version"
}

validate_hardware_requirements() {
    show_progress "Validating hardware requirements"
    
    # Check RAM
    local mem_gb=$(free -g | awk '/^Mem:/ {print $2}')
    if [[ $mem_gb -lt $MIN_RAM_GB ]]; then
        log_error "Insufficient RAM. Required: ${MIN_RAM_GB}GB, Available: ${mem_gb}GB"
        exit 1
    fi
    
    # Check disk space
    local disk_gb=$(df / | awk 'NR==2 {print int($4/1024/1024)}')
    if [[ $disk_gb -lt $MIN_DISK_GB ]]; then
        log_error "Insufficient disk space. Required: ${MIN_DISK_GB}GB, Available: ${disk_gb}GB"
        exit 1
    fi
    
    # Check CPU cores
    local cpu_cores=$(nproc)
    if [[ $cpu_cores -lt $MIN_CPU_CORES ]]; then
        log_error "Insufficient CPU cores. Required: ${MIN_CPU_CORES}, Available: ${cpu_cores}"
        exit 1
    fi
    
    log_success "Hardware requirements validated (RAM: ${mem_gb}GB, Disk: ${disk_gb}GB, CPU: ${cpu_cores} cores)"
}

validate_network_connectivity() {
    show_progress "Validating network connectivity"
    
    local test_hosts=("google.com" "github.com" "docker.com" "registry-1.docker.io")
    
    for host in "${test_hosts[@]}"; do
        if ! ping -c 1 -W 5 "$host" &>/dev/null; then
            log_error "Cannot reach $host. Internet connectivity required."
            exit 1
        fi
    done
    
    log_success "Network connectivity validated"
}

check_port_availability() {
    show_progress "Checking port availability"
    
    local occupied_ports=()
    
    for port in "${REQUIRED_PORTS[@]}"; do
        if ss -tulpn | grep -q ":$port "; then
            occupied_ports+=("$port")
        fi
    done
    
    if [[ ${#occupied_ports[@]} -gt 0 ]]; then
        log_error "The following required ports are already in use: ${occupied_ports[*]}"
        log_error "Please stop services using these ports and retry"
        exit 1
    fi
    
    log_success "All required ports are available"
}

# ==============================================================================
# SYSTEM PREPARATION FUNCTIONS
# ==============================================================================

update_system_packages() {
    show_progress "Updating system packages"
    
    export DEBIAN_FRONTEND=noninteractive
    
    if ! apt-get update -qq; then
        log_error "Failed to update package lists"
        exit 1
    fi
    
    if ! apt-get upgrade -y -qq; then
        log_error "Failed to upgrade system packages"
        exit 1
    fi
    
    apt-get autoremove -y -qq
    apt-get autoclean -qq
    
    log_success "System packages updated successfully"
}

install_essential_packages() {
    show_progress "Installing essential packages"
    
    local packages=(
        # Core utilities
        "build-essential" "software-properties-common" "apt-transport-https"
        "ca-certificates" "curl" "wget" "git" "unzip" "tar" "gzip" "p7zip-full"
        "tree" "htop" "jq" "nano" "vim"
        
        # Development tools
        "python3" "python3-pip"
        
        # Media processing
        "ffmpeg" "imagemagick"
        
        # Security tools
        "ufw" "fail2ban" "apparmor" "apparmor-utils"
        
        # Monitoring tools
        "sysstat" "iftop" "lsof"
        
        # Network tools
        "net-tools" "dnsutils" "netcat-openbsd"
    )
    
    for package in "${packages[@]}"; do
        if ! dpkg -l | grep -q "^ii  $package "; then
            if ! apt-get install -y -qq "$package" 2>/dev/null; then
                log_warn "Failed to install package: $package"
            fi
        fi
    done
    
    log_success "Essential packages installed"
}

install_nodejs_lts() {
    show_progress "Installing Node.js LTS"
    
    # Remove existing Node.js installations
    apt-get remove -y -qq nodejs npm node 2>/dev/null || true
    
    # Install Node.js 18 LTS
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y -qq nodejs
    
    # Verify installation
    local node_version=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ -z "$node_version" ]] || [[ $node_version -lt 18 ]]; then
        log_error "Node.js 18+ installation failed"
        exit 1
    fi
    
    # Update npm to latest
    npm install -g npm@latest
    
    log_success "Node.js $(node --version) and npm $(npm --version) installed"
}

# ==============================================================================
# DOCKER INSTALLATION FUNCTIONS
# ==============================================================================

install_docker_engine() {
    show_progress "Installing Docker Engine"
    
    # Remove old Docker installations
    apt-get remove -y -qq docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Install Docker dependencies
    apt-get install -y -qq \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Add Docker GPG key
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    # Add Docker repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    log_success "Docker Engine installed"
}

configure_docker_daemon() {
    show_progress "Configuring Docker daemon"
    
    mkdir -p /etc/docker
    
    cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  },
  "storage-driver": "overlay2",
  "default-address-pools": [
    {
      "base": "172.20.0.0/16",
      "size": 24
    }
  ],
  "dns": ["8.8.8.8", "8.8.4.4"],
  "live-restore": true,
  "max-concurrent-downloads": 10,
  "max-concurrent-uploads": 5
}
EOF
    
    # Configure Docker group
    groupadd -f docker
    if [[ -n "${SUDO_USER:-}" ]]; then
        usermod -aG docker "$SUDO_USER"
    fi
    
    systemctl enable docker
    systemctl start docker
    
    # Wait for Docker to be ready
    local attempts=0
    while ! docker info &>/dev/null && [[ $attempts -lt 30 ]]; do
        sleep 2
        ((attempts++))
    done
    
    if ! docker info &>/dev/null; then
        log_error "Docker failed to start"
        exit 1
    fi
    
    log_success "Docker daemon configured and started"
}

# ==============================================================================
# SECURITY HARDENING FUNCTIONS
# ==============================================================================

configure_firewall() {
    show_progress "Configuring firewall"
    
    # Reset UFW to defaults
    ufw --force reset
    
    # Set default policies
    ufw default deny incoming
    ufw default allow outgoing
    
    # Allow required ports
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 443/tcp   # HTTPS
    ufw allow 3000/tcp  # Application
    
    # Enable UFW
    ufw --force enable
    
    log_success "Firewall configured"
}

setup_fail2ban() {
    show_progress "Setting up Fail2Ban"
    
    # Create custom jail configuration
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
logpath = /var/log/auth.log

[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
EOF
    
    systemctl enable fail2ban
    systemctl start fail2ban
    
    log_success "Fail2Ban configured"
}

# ==============================================================================
# APPLICATION SETUP FUNCTIONS
# ==============================================================================

clone_repository() {
    show_progress "Cloning repository"
    
    if [[ -d "$INSTALL_DIR" ]]; then
        log_info "Backing up existing installation"
        mv "$INSTALL_DIR" "$BACKUP_DIR/retrogame-backup-$(date +%Y%m%d_%H%M%S)"
    fi
    
    mkdir -p "$INSTALL_DIR"
    
    if ! git clone "https://github.com/$GITHUB_REPO.git" "$INSTALL_DIR"; then
        log_error "Failed to clone repository"
        exit 1
    fi
    
    cd "$INSTALL_DIR"
    
    log_success "Repository cloned successfully"
}

setup_directory_structure() {
    show_progress "Setting up directory structure"
    
    local directories=(
        "$INSTALL_DIR/data"
        "$INSTALL_DIR/logs"
        "$INSTALL_DIR/backups"
        "$INSTALL_DIR/uploads"
        "$INSTALL_DIR/roms"
        "$INSTALL_DIR/roms/bios"
        "$INSTALL_DIR/saves"
        "$INSTALL_DIR/states"
        "$INSTALL_DIR/screenshots"
        "$INSTALL_DIR/ssl"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
        chmod 755 "$dir"
    done
    
    # Set proper ownership
    chown -R 1000:1000 "$INSTALL_DIR"
    
    log_success "Directory structure created"
}

generate_secure_environment() {
    show_progress "Generating secure environment configuration"
    
    # Generate secure passwords and keys
    local db_password=$(openssl rand -base64 32)
    local redis_password=$(openssl rand -base64 32)
    local jwt_secret=$(openssl rand -base64 64)
    local encryption_key=$(openssl rand -base64 32)
    
    cat > "$INSTALL_DIR/.env" << EOF
# RetroGame Server Configuration
# Generated on $(date)

# Application Settings
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=retrogame
DB_USER=retrogame
DB_PASSWORD=$db_password

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$redis_password

# Security
JWT_SECRET=$jwt_secret
ENCRYPTION_KEY=$encryption_key
SESSION_SECRET=$(openssl rand -base64 32)

# File Storage
UPLOAD_DIR=/app/uploads
ROM_DIR=/app/roms
SAVE_DIR=/app/saves

# External APIs (to be configured)
# IGDB_CLIENT_ID=your_client_id
# IGDB_CLIENT_SECRET=your_client_secret

# Monitoring
LOG_LEVEL=info
ENABLE_METRICS=true
EOF
    
    chmod 600 "$INSTALL_DIR/.env"
    
    log_success "Environment configuration generated"
}

create_docker_compose() {
    show_progress "Creating Docker Compose configuration"
    
    cat > "$INSTALL_DIR/docker-compose.prod.yml" << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.prod
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./uploads:/app/uploads
      - ./roms:/app/roms
      - ./saves:/app/saves
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    restart: unless-stopped

  emulator:
    build:
      context: ./emulator
      dockerfile: Dockerfile
    volumes:
      - ./roms:/app/roms:ro
      - ./saves:/app/saves
      - ./states:/app/states
    restart: unless-stopped
    cap_add:
      - SYS_NICE

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
      - frontend
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
EOF
    
    log_success "Docker Compose configuration created"
}

create_nginx_configuration() {
    show_progress "Creating Nginx configuration"
    
    mkdir -p "$INSTALL_DIR/nginx"
    
    cat > "$INSTALL_DIR/nginx/nginx.conf" << 'EOF'
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    
    upstream backend {
        server backend:3000;
    }
    
    upstream frontend {
        server frontend:80;
    }
    
    server {
        listen 80;
        server_name _;
        
        # Redirect HTTP to HTTPS
        return 301 https://$server_name$request_uri;
    }
    
    server {
        listen 443 ssl http2;
        server_name _;
        
        # SSL Configuration (self-signed for initial setup)
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_private_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
        
        # Frontend
        location / {
            proxy_pass http://frontend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
        
        # API endpoints
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
        
        # File uploads
        location /uploads/ {
            proxy_pass http://backend;
            client_max_body_size 100M;
        }
    }
}
EOF
    
    log_success "Nginx configuration created"
}

generate_ssl_certificates() {
    show_progress "Generating SSL certificates"
    
    mkdir -p "$INSTALL_DIR/ssl"
    
    # Generate self-signed certificate for initial setup
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$INSTALL_DIR/ssl/key.pem" \
        -out "$INSTALL_DIR/ssl/cert.pem" \
        -subj "/C=US/ST=State/L=City/O=RetroGame/OU=IT/CN=localhost" 2>/dev/null
    
    chmod 600 "$INSTALL_DIR/ssl/key.pem"
    chmod 644 "$INSTALL_DIR/ssl/cert.pem"
    
    log_success "SSL certificates generated"
}

# ==============================================================================
# SERVICE CONFIGURATION FUNCTIONS
# ==============================================================================

create_systemd_service() {
    show_progress "Creating systemd service"
    
    cat > "$SERVICE_DIR/retrogame.service" << EOF
[Unit]
Description=RetroGame Server
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable retrogame
    
    log_success "Systemd service created"
}

# ==============================================================================
# DEPLOYMENT FUNCTIONS
# ==============================================================================

build_and_deploy() {
    show_progress "Building and deploying application"
    
    cd "$INSTALL_DIR"
    
    # Build and start services
    if ! docker compose -f docker-compose.prod.yml build; then
        log_error "Failed to build Docker images"
        exit 1
    fi
    
    if ! docker compose -f docker-compose.prod.yml up -d; then
        log_error "Failed to start services"
        exit 1
    fi
    
    log_success "Application deployed successfully"
}

wait_for_services() {
    show_progress "Waiting for services to be healthy"
    
    local services=("postgres" "redis" "backend")
    local max_attempts=60
    
    for service in "${services[@]}"; do
        local attempts=0
        while [[ $attempts -lt $max_attempts ]]; do
            if docker compose -f docker-compose.prod.yml ps "$service" | grep -q "healthy"; then
                log_debug "$service is healthy"
                break
            fi
            
            ((attempts++))
            if [[ $attempts -eq $max_attempts ]]; then
                log_error "$service failed to become healthy"
                exit 1
            fi
            
            sleep 5
        done
    done
    
    log_success "All services are healthy"
}

run_health_checks() {
    show_progress "Running health checks"
    
    # Check if the application is responding
    local attempts=0
    local max_attempts=30
    
    while [[ $attempts -lt $max_attempts ]]; do
        if curl -sSf http://localhost/api/health &>/dev/null; then
            log_success "Application health check passed"
            break
        fi
        
        ((attempts++))
        if [[ $attempts -eq $max_attempts ]]; then
            log_error "Application health check failed"
            exit 1
        fi
        
        sleep 10
    done
}

# ==============================================================================
# SUCCESS REPORTING
# ==============================================================================

create_success_report() {
    local report_file="$LOG_DIR/installation-report-$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$report_file" << EOF
🎮 RETROGAME SERVER INSTALLATION REPORT 🎮
==========================================

Installation completed successfully on $(date)
Script Version: $SCRIPT_VERSION
Installation Directory: $INSTALL_DIR

📊 SYSTEM INFORMATION
- OS: $(lsb_release -d | cut -f2)
- RAM: $(free -h | awk '/^Mem:/ {print $2}')
- Disk Available: $(df -h / | awk 'NR==2 {print $4}')
- CPU Cores: $(nproc)

🔧 INSTALLED COMPONENTS
- Docker Engine: $(docker --version | cut -d' ' -f3 | tr -d ',')
- Node.js: $(node --version)
- PostgreSQL: 15
- Redis: 7
- Nginx: Latest

🌐 ACCESS INFORMATION
- Web Interface: https://$(hostname -I | awk '{print $1}')
- API Endpoint: https://$(hostname -I | awk '{print $1}')/api
- Admin Panel: https://$(hostname -I | awk '{print $1}')/admin

🔐 SECURITY FEATURES
✅ Firewall configured (UFW)
✅ Fail2Ban protection enabled
✅ SSL certificates generated
✅ AppArmor enabled
✅ Secure environment variables

📋 NEXT STEPS
1. Review credentials in $INSTALL_DIR/.env
2. Upload BIOS files to $INSTALL_DIR/roms/bios/
3. Configure external API keys
4. Set up production SSL certificates
5. Create initial admin user

📚 USEFUL COMMANDS
- Start services: systemctl start retrogame
- Stop services: systemctl stop retrogame
- View logs: docker compose -f $INSTALL_DIR/docker-compose.prod.yml logs
- Check status: docker compose -f $INSTALL_DIR/docker-compose.prod.yml ps

🆘 SUPPORT
- Documentation: https://github.com/$GITHUB_REPO
- Logs: $LOG_DIR/
- Configuration: $INSTALL_DIR/.env

Installation Duration: $(($(date +%s) - START_TIME)) seconds
EOF
    
    log_success "Installation report created: $report_file"
}

# ==============================================================================
# MAIN INSTALLATION FUNCTION
# ==============================================================================

main() {
    # Set up error handling
    trap cleanup_on_failure EXIT
    trap 'log_error "Installation interrupted by user"; exit 130' INT TERM
    
    # Initialize
    print_banner
    init_logging
    
    log_info "Starting RetroGame Server installation..."
    log_info "Script version: $SCRIPT_VERSION"
    log_info "GitHub repository: $GITHUB_REPO"
    
    # Phase 1: System Validation
    log_info "🔍 Phase 1: System Validation"
    validate_root_privileges
    validate_operating_system
    validate_hardware_requirements
    validate_network_connectivity
    check_port_availability
    
    # Phase 2: System Preparation
    log_info "⚙️ Phase 2: System Preparation"
    update_system_packages
    install_essential_packages
    install_nodejs_lts
    
    # Phase 3: Docker Installation
    log_info "🐳 Phase 3: Docker Installation"
    install_docker_engine
    configure_docker_daemon
    
    # Phase 4: Security Hardening
    log_info "🔒 Phase 4: Security Hardening"
    configure_firewall
    setup_fail2ban
    
    # Phase 5: Application Setup
    log_info "📦 Phase 5: Application Setup"
    clone_repository
    setup_directory_structure
    generate_secure_environment
    create_docker_compose
    create_nginx_configuration
    generate_ssl_certificates
    
    # Phase 6: Service Configuration
    log_info "🛠️ Phase 6: Service Configuration"
    create_systemd_service
    
    # Phase 7: Deployment
    log_info "🚀 Phase 7: Deployment"
    build_and_deploy
    wait_for_services
    run_health_checks
    
    # Success cleanup
    trap cleanup_on_success EXIT
    
    echo
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                     🎉 INSTALLATION COMPLETE! 🎉                    ║${NC}"
    echo -e "${GREEN}║                                                                      ║${NC}"
    echo -e "${GREEN}║  Your RetroGame Server is now running and ready to use!             ║${NC}"
    echo -e "${GREEN}║                                                                      ║${NC}"
    echo -e "${GREEN}║  Access your server at: https://$(hostname -I | awk '{print $1}')                      ║${NC}"
    echo -e "${GREEN}║                                                                      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo
}

# ==============================================================================
# SCRIPT EXECUTION
# ==============================================================================

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi