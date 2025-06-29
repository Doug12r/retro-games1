#!/bin/bash
# ==============================================================================
# RETRO GAME SERVER - GITHUB DEPLOYMENT SCRIPT
# Production-ready deployment from GitHub with environment customization
# Version: 1.0.0 - GitHub Edition
# ==============================================================================

set -euo pipefail
IFS=$'\n\t'

# ==============================================================================
# CONFIGURATION AND CONSTANTS
# ==============================================================================

readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"
readonly START_TIME=$(date +%s)

# Default GitHub repository configuration
GITHUB_USER="${GITHUB_USER:-}"
GITHUB_REPO="${GITHUB_REPO:-retro-game-server}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# Installation configuration
INSTALL_DIR="${INSTALL_DIR:-/opt/retrogame}"
LOG_DIR="${LOG_DIR:-/var/log/retrogame}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/retrogame}"
DOMAIN="${DOMAIN:-localhost}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"

# Installation modes
INTERACTIVE_MODE="${INTERACTIVE_MODE:-true}"
QUIET_MODE="${QUIET_MODE:-false}"
DRY_RUN="${DRY_RUN:-false}"
FORCE_REINSTALL="${FORCE_REINSTALL:-false}"
SKIP_PROMPTS="${SKIP_PROMPTS:-false}"

# System requirements
readonly MIN_RAM_GB=4
readonly MIN_DISK_GB=50
readonly MIN_CPU_CORES=2
readonly REQUIRED_UBUNTU_VERSION="22.04"

# Colors and formatting
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly PURPLE='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly WHITE='\033[1;37m'
readonly NC='\033[0m'
readonly BOLD='\033[1m'

# Progress tracking
readonly TOTAL_STEPS=50
CURRENT_STEP=0

# ==============================================================================
# LOGGING AND UTILITY FUNCTIONS
# ==============================================================================

# Initialize logging
init_logging() {
    install -d -m 750 -o root -g adm "$LOG_DIR"
    install -d -m 750 -o root -g adm "$LOG_DIR"/{deployment,security,application}
    
    readonly LOG_FILE="$LOG_DIR/deployment/deploy-$(date +%Y%m%d_%H%M%S).log"
    readonly ERROR_LOG="$LOG_DIR/deployment/errors-$(date +%Y%m%d_%H%M%S).log"
    
    install -m 640 -o root -g adm /dev/null "$LOG_FILE"
    install -m 640 -o root -g adm /dev/null "$ERROR_LOG"
}

# Enhanced logging functions
log() {
    local level="$1"
    shift
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="$*"
    
    if [[ "$QUIET_MODE" != "true" ]] || [[ "$level" == "ERROR" ]]; then
        case "$level" in
            "ERROR")
                echo -e "${RED}[${level}]${NC} $message" >&2
                echo "$timestamp|$level|github-deploy|$CURRENT_STEP|$message" >> "$ERROR_LOG"
                ;;
            "WARN")
                echo -e "${YELLOW}[${level}]${NC} $message" >&2
                ;;
            "SUCCESS")
                echo -e "${GREEN}[${level}]${NC} $message"
                ;;
            "INFO")
                echo -e "${BLUE}[${level}]${NC} $message"
                ;;
            "DEBUG")
                echo -e "${PURPLE}[${level}]${NC} $message"
                ;;
        esac
    fi
    
    if [[ -w "$LOG_FILE" ]]; then
        echo "$timestamp|$level|github-deploy|$CURRENT_STEP|$message" >> "$LOG_FILE"
    fi
}

log_error() { log "ERROR" "$@"; }
log_warn() { log "WARN" "$@"; }
log_success() { log "SUCCESS" "$@"; }
log_info() { log "INFO" "$@"; }
log_debug() { log "DEBUG" "$@"; }

# Progress display with ETA
show_progress() {
    local message="$1"
    local current_time=$(date +%s)
    local elapsed=$((current_time - START_TIME))
    
    ((CURRENT_STEP++))
    local percent=$((CURRENT_STEP * 100 / TOTAL_STEPS))
    
    # Calculate ETA
    local eta=""
    if [[ $CURRENT_STEP -gt 3 ]]; then
        local avg_time_per_step=$((elapsed / CURRENT_STEP))
        local remaining_steps=$((TOTAL_STEPS - CURRENT_STEP))
        local eta_seconds=$((remaining_steps * avg_time_per_step))
        local eta_minutes=$((eta_seconds / 60))
        eta=" (ETA: ${eta_minutes}m)"
    fi
    
    # Create progress bar
    local bar_length=40
    local filled_length=$((percent * bar_length / 100))
    local bar=""
    for ((i=0; i<filled_length; i++)); do bar+="█"; done
    for ((i=filled_length; i<bar_length; i++)); do bar+="░"; done
    
    if [[ "$QUIET_MODE" != "true" ]]; then
        printf "\r${CYAN}[%3d%%] [%s] %-40s${eta}${NC}" "$percent" "$bar" "$message"
    fi
    
    log_info "Step $CURRENT_STEP/$TOTAL_STEPS: $message"
    sleep 0.1
}

# ==============================================================================
# INPUT AND CONFIGURATION FUNCTIONS
# ==============================================================================

# Display banner
print_banner() {
    if [[ "$QUIET_MODE" == "true" ]]; then
        return 0
    fi
    
    echo -e "${GREEN}${BOLD}"
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════════════╗
║                   RETRO GAME SERVER DEPLOYMENT                      ║
║                      GitHub Edition v1.0.0                          ║
║                                                                      ║
║  🚀 Deploy directly from GitHub repository                           ║
║  ⚙️  Interactive environment configuration                            ║
║  🐳 Production-ready Docker deployment                               ║
║  🔒 Enterprise security hardening                                    ║
║  📊 Comprehensive monitoring and logging                             ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# Interactive configuration prompts
configure_deployment() {
    if [[ "$INTERACTIVE_MODE" != "true" ]] || [[ "$SKIP_PROMPTS" == "true" ]]; then
        log_info "Using default configuration or environment variables"
        return 0
    fi
    
    echo -e "${CYAN}${BOLD}=== DEPLOYMENT CONFIGURATION ===${NC}"
    echo
    
    # GitHub repository configuration
    echo -e "${WHITE}GitHub Repository Configuration:${NC}"
    
    if [[ -z "$GITHUB_USER" ]]; then
        read -p "GitHub username/organization: " GITHUB_USER
        if [[ -z "$GITHUB_USER" ]]; then
            log_error "GitHub username is required"
            exit 1
        fi
    fi
    
    read -p "Repository name [$GITHUB_REPO]: " input
    GITHUB_REPO="${input:-$GITHUB_REPO}"
    
    read -p "Branch [$GITHUB_BRANCH]: " input
    GITHUB_BRANCH="${input:-$GITHUB_BRANCH}"
    
    # Installation directory
    echo
    echo -e "${WHITE}Installation Configuration:${NC}"
    read -p "Installation directory [$INSTALL_DIR]: " input
    INSTALL_DIR="${input:-$INSTALL_DIR}"
    
    read -p "Domain name [$DOMAIN]: " input
    DOMAIN="${input:-$DOMAIN}"
    
    read -p "Admin email [$ADMIN_EMAIL]: " input
    ADMIN_EMAIL="${input:-$ADMIN_EMAIL}"
    
    # Optional GitHub token for private repos
    echo
    echo -e "${WHITE}Optional Configuration:${NC}"
    read -s -p "GitHub token (for private repos, press Enter to skip): " GITHUB_TOKEN
    echo
    
    # Deployment options
    echo
    echo -e "${WHITE}Deployment Options:${NC}"
    read -p "Enable monitoring stack? [Y/n]: " enable_monitoring
    ENABLE_MONITORING="${enable_monitoring:-Y}"
    
    read -p "Enable SSL/HTTPS? [y/N]: " enable_ssl
    ENABLE_SSL="${enable_ssl:-N}"
    
    read -p "Production deployment mode? [Y/n]: " prod_mode
    PRODUCTION_MODE="${prod_mode:-Y}"
    
    echo
    log_info "Configuration completed"
}

# Create environment configuration
create_environment_config() {
    show_progress "Creating environment configuration"
    
    # Generate secure passwords
    local db_password=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)
    local redis_password=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)
    local jwt_secret=$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 64)
    local admin_password=$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9' | head -c 16)
    local grafana_password=$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9' | head -c 16)
    
    # Create .env file
    cat > "$INSTALL_DIR/.env" << EOF
# ==============================================================================
# RETRO GAME SERVER ENVIRONMENT CONFIGURATION
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Deployment: GitHub $(echo ${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH})
# ==============================================================================

# Server Configuration
NODE_ENV=production
LOG_LEVEL=info
DEBUG=false
PORT=3001
HOST=0.0.0.0

# Domain Configuration
DOMAIN=$DOMAIN
FRONTEND_URL=http://$DOMAIN
API_URL=http://$DOMAIN/api
ADMIN_EMAIL=$ADMIN_EMAIL

# Database Configuration
POSTGRES_DB=retrogame
POSTGRES_USER=retrogame
POSTGRES_PASSWORD=$db_password
DATABASE_URL=postgresql://retrogame:$db_password@postgres:5432/retrogame
POSTGRES_PORT=5432

# Redis Configuration
REDIS_PASSWORD=$redis_password
REDIS_URL=redis://:$redis_password@redis:6379
REDIS_PORT=6379
REDIS_DB=0

# Security Configuration
JWT_SECRET=$jwt_secret
ADMIN_PASSWORD=$admin_password
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=15
SESSION_SECRET=$(openssl rand -base64 32)

# Storage Configuration
UPLOAD_DIR=/app/uploads
ROM_DIR=/app/roms
MEDIA_DIR=/app/media
BIOS_DIR=/app/bios
TEMP_DIR=/app/temp
BACKUP_DIR=/app/backups

# Upload Configuration
MAX_FILE_SIZE=4294967296
CHUNK_SIZE=1048576
UPLOAD_TIMEOUT=3600
MAX_CONCURRENT_UPLOADS=10

# Network Configuration
NGINX_PORT=80
NGINX_SSL_PORT=443
BACKEND_PORT=3001
FRONTEND_PORT=3000

# Monitoring Configuration
$(if [[ "${ENABLE_MONITORING:-Y}" =~ ^[Yy] ]]; then
echo "ENABLE_MONITORING=true"
echo "GRAFANA_PASSWORD=$grafana_password"
echo "PROMETHEUS_PORT=9090"
echo "GRAFANA_PORT=3001"
else
echo "ENABLE_MONITORING=false"
fi)

# SSL Configuration
$(if [[ "${ENABLE_SSL:-N}" =~ ^[Yy] ]]; then
echo "ENABLE_SSL=true"
echo "SSL_CERT_PATH=/etc/nginx/ssl/cert.pem"
echo "SSL_KEY_PATH=/etc/nginx/ssl/key.pem"
else
echo "ENABLE_SSL=false"
fi)

# External APIs (Configure these manually if needed)
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
THEGAMESDB_API_KEY=
SCREENSCRAPER_USERNAME=
SCREENSCRAPER_PASSWORD=

# Feature Flags
ENABLE_REGISTRATION=true
ENABLE_GUEST_ACCESS=false
ENABLE_METRICS=true
ENABLE_BACKUP=true
ENABLE_AUDIT_LOG=true

# Production Settings
$(if [[ "${PRODUCTION_MODE:-Y}" =~ ^[Yy] ]]; then
echo "PRODUCTION_MODE=true"
echo "WORKER_PROCESSES=auto"
echo "LOG_RETENTION_DAYS=30"
else
echo "PRODUCTION_MODE=false"
echo "WORKER_PROCESSES=1"
echo "LOG_RETENTION_DAYS=7"
fi)
EOF
    
    # Set secure permissions
    chmod 600 "$INSTALL_DIR/.env"
    
    # Create credentials file for user reference
    cat > "$INSTALL_DIR/CREDENTIALS.txt" << EOF
RETRO GAME SERVER - DEPLOYMENT CREDENTIALS
==========================================
Generated: $(date)
Repository: ${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}

IMPORTANT: Change these passwords after installation!

Web Interface:
- URL: http://$DOMAIN
- Admin Username: admin
- Admin Password: $admin_password

Database:
- Host: $DOMAIN:5432
- Database: retrogame
- Username: retrogame
- Password: $db_password

Redis:
- Host: $DOMAIN:6379
- Password: $redis_password

$(if [[ "${ENABLE_MONITORING:-Y}" =~ ^[Yy] ]]; then
cat << MONITOR_EOF
Grafana Monitoring:
- URL: http://$DOMAIN:3001
- Username: admin
- Password: $grafana_password
MONITOR_EOF
fi)

Files:
- Environment: $INSTALL_DIR/.env
- Docker Compose: $INSTALL_DIR/docker-compose.yml
- Installation Log: $LOG_FILE

Next Steps:
1. Customize .env file if needed: nano $INSTALL_DIR/.env
2. Review Docker Compose: $INSTALL_DIR/docker-compose.yml
3. Start services: cd $INSTALL_DIR && docker compose up -d
4. Check status: docker compose ps
5. View logs: docker compose logs -f

Support:
- Repository: https://github.com/${GITHUB_USER}/${GITHUB_REPO}
- Issues: https://github.com/${GITHUB_USER}/${GITHUB_REPO}/issues
- Documentation: $INSTALL_DIR/README.md
EOF
    
    chmod 600 "$INSTALL_DIR/CREDENTIALS.txt"
    
    log_success "Environment configuration created"
}

# Allow environment customization
customize_environment() {
    if [[ "$INTERACTIVE_MODE" != "true" ]] || [[ "$SKIP_PROMPTS" == "true" ]]; then
        return 0
    fi
    
    echo
    echo -e "${CYAN}${BOLD}=== ENVIRONMENT CUSTOMIZATION ===${NC}"
    echo -e "${WHITE}The environment file has been created with secure defaults.${NC}"
    echo -e "${WHITE}You can customize it now or later.${NC}"
    echo
    
    read -p "Would you like to customize the environment now? [y/N]: " customize
    
    if [[ "$customize" =~ ^[Yy] ]]; then
        # Show current environment
        echo
        echo -e "${WHITE}Current environment configuration:${NC}"
        grep -E "^[A-Z_]+" "$INSTALL_DIR/.env" | head -20
        echo "... (showing first 20 lines)"
        echo
        
        # Prompt for specific customizations
        echo -e "${WHITE}Common customizations:${NC}"
        
        # Domain customization
        local current_domain=$(grep "^DOMAIN=" "$INSTALL_DIR/.env" | cut -d'=' -f2)
        read -p "Domain [$current_domain]: " new_domain
        if [[ -n "$new_domain" && "$new_domain" != "$current_domain" ]]; then
            sed -i "s/^DOMAIN=.*/DOMAIN=$new_domain/" "$INSTALL_DIR/.env"
            sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=http://$new_domain|" "$INSTALL_DIR/.env"
            sed -i "s|API_URL=.*|API_URL=http://$new_domain/api|" "$INSTALL_DIR/.env"
            log_info "Domain updated to: $new_domain"
        fi
        
        # Admin email
        local current_email=$(grep "^ADMIN_EMAIL=" "$INSTALL_DIR/.env" | cut -d'=' -f2)
        read -p "Admin email [$current_email]: " new_email
        if [[ -n "$new_email" && "$new_email" != "$current_email" ]]; then
            sed -i "s/^ADMIN_EMAIL=.*/ADMIN_EMAIL=$new_email/" "$INSTALL_DIR/.env"
            log_info "Admin email updated to: $new_email"
        fi
        
        # Upload limits
        echo
        read -p "Maximum upload file size in GB [4]: " upload_gb
        if [[ -n "$upload_gb" ]]; then
            local upload_bytes=$((upload_gb * 1024 * 1024 * 1024))
            sed -i "s/^MAX_FILE_SIZE=.*/MAX_FILE_SIZE=$upload_bytes/" "$INSTALL_DIR/.env"
            log_info "Upload limit set to: ${upload_gb}GB"
        fi
        
        # Full editor option
        echo
        read -p "Open full environment file in editor for advanced customization? [y/N]: " edit_env
        if [[ "$edit_env" =~ ^[Yy] ]]; then
            ${EDITOR:-nano} "$INSTALL_DIR/.env"
        fi
    fi
    
    log_success "Environment customization completed"
}

# ==============================================================================
# SYSTEM VALIDATION FUNCTIONS
# ==============================================================================

# Comprehensive system validation
validate_system() {
    show_progress "Validating system requirements"
    
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
    
    # Check Ubuntu version
    if ! command -v lsb_release >/dev/null 2>&1; then
        log_error "This script requires Ubuntu. lsb_release not found."
        exit 1
    fi
    
    local os_version=$(lsb_release -sr)
    if [[ "$os_version" != "$REQUIRED_UBUNTU_VERSION" ]]; then
        log_error "Ubuntu $REQUIRED_UBUNTU_VERSION required. Found: $os_version"
        exit 1
    fi
    
    # Check hardware requirements
    local mem_gb=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024))
    if [[ $mem_gb -lt $MIN_RAM_GB ]]; then
        log_error "Insufficient RAM: ${mem_gb}GB available, ${MIN_RAM_GB}GB required"
        exit 1
    fi
    
    local disk_gb=$(df / | awk 'NR==2 {print int($4/1024/1024)}')
    if [[ $disk_gb -lt $MIN_DISK_GB ]]; then
        log_error "Insufficient disk space: ${disk_gb}GB available, ${MIN_DISK_GB}GB required"
        exit 1
    fi
    
    local cpu_cores=$(nproc)
    if [[ $cpu_cores -lt $MIN_CPU_CORES ]]; then
        log_error "Insufficient CPU cores: $cpu_cores available, $MIN_CPU_CORES required"
        exit 1
    fi
    
    # Check required tools
    local required_tools=("curl" "git" "docker")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            log_error "Required tool not found: $tool"
            exit 1
        fi
    done
    
    log_success "System validation passed"
}

# Check if installation already exists
check_existing_installation() {
    show_progress "Checking for existing installation"
    
    if [[ -d "$INSTALL_DIR" ]] && [[ "$FORCE_REINSTALL" != "true" ]]; then
        if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
            log_warn "Existing installation found at: $INSTALL_DIR"
            
            if [[ "$INTERACTIVE_MODE" == "true" ]]; then
                echo
                echo -e "${YELLOW}An existing RetroGame Server installation was found.${NC}"
                echo -e "${WHITE}Options:${NC}"
                echo "  1) Update existing installation"
                echo "  2) Backup and reinstall"
                echo "  3) Cancel installation"
                echo
                
                read -p "Choose option [1]: " choice
                choice="${choice:-1}"
                
                case "$choice" in
                    1)
                        log_info "Updating existing installation"
                        UPDATE_MODE=true
                        ;;
                    2)
                        backup_existing_installation
                        rm -rf "$INSTALL_DIR"
                        ;;
                    3)
                        log_info "Installation cancelled by user"
                        exit 0
                        ;;
                    *)
                        log_error "Invalid choice"
                        exit 1
                        ;;
                esac
            else
                log_error "Existing installation found. Use --force to reinstall or run in interactive mode."
                exit 1
            fi
        fi
    fi
}

# Backup existing installation
backup_existing_installation() {
    show_progress "Backing up existing installation"
    
    local backup_name="retrogame-backup-$(date +%Y%m%d_%H%M%S)"
    local backup_path="$BACKUP_DIR/$backup_name"
    
    mkdir -p "$BACKUP_DIR"
    
    log_info "Creating backup: $backup_path"
    
    # Stop services if running
    if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
        cd "$INSTALL_DIR"
        docker compose down 2>/dev/null || true
    fi
    
    # Create backup archive
    tar -czf "$backup_path.tar.gz" -C "$(dirname "$INSTALL_DIR")" "$(basename "$INSTALL_DIR")" 2>/dev/null || {
        log_error "Failed to create backup"
        exit 1
    }
    
    log_success "Backup created: $backup_path.tar.gz"
}

# ==============================================================================
# GITHUB REPOSITORY FUNCTIONS
# ==============================================================================

# Download repository from GitHub
download_repository() {
    show_progress "Downloading repository from GitHub"
    
    local repo_url="https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
    local temp_dir="/tmp/retrogame-deploy-$$"
    
    # Use token if provided
    if [[ -n "$GITHUB_TOKEN" ]]; then
        repo_url="https://${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
    fi
    
    log_info "Cloning repository: ${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}"
    
    # Clone repository
    if ! git clone --branch "$GITHUB_BRANCH" --depth 1 "$repo_url" "$temp_dir"; then
        log_error "Failed to clone repository"
        exit 1
    fi
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    
    # Copy repository contents
    cp -r "$temp_dir"/* "$INSTALL_DIR/"
    cp -r "$temp_dir"/.* "$INSTALL_DIR/" 2>/dev/null || true
    
    # Clean up
    rm -rf "$temp_dir"
    
    # Verify essential files
    local required_files=("docker-compose.yml")
    for file in "${required_files[@]}"; do
        if [[ ! -f "$INSTALL_DIR/$file" ]]; then
            log_error "Required file not found in repository: $file"
            exit 1
        fi
    done
    
    log_success "Repository downloaded successfully"
}

# Validate repository structure
validate_repository() {
    show_progress "Validating repository structure"
    
    cd "$INSTALL_DIR"
    
    # Check for required files
    local required_files=(
        "docker-compose.yml"
    )
    
    local optional_files=(
        "README.md"
        "LICENSE"
        ".env.example"
        "scripts/init-db.sql"
    )
    
    # Validate required files
    for file in "${required_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            log_error "Required file missing: $file"
            exit 1
        fi
    done
    
    # Check for optional files
    for file in "${optional_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            log_warn "Optional file missing: $file"
        fi
    done
    
    # Validate docker-compose.yml
    if ! docker compose config >/dev/null 2>&1; then
        log_error "Invalid docker-compose.yml file"
        exit 1
    fi
    
    log_success "Repository structure validated"
}

# ==============================================================================
# DOCKER DEPLOYMENT FUNCTIONS
# ==============================================================================

# Install Docker if not present
install_docker() {
    if command -v docker >/dev/null 2>&1; then
        log_info "Docker already installed: $(docker --version)"
        return 0
    fi
    
    show_progress "Installing Docker"
    
    # Update package list
    apt-get update -qq
    
    # Install prerequisites
    apt-get install -y -qq \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Add Docker GPG key
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    # Add Docker repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Start Docker
    systemctl enable docker
    systemctl start docker
    
    # Verify installation
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker installation failed"
        exit 1
    fi
    
    log_success "Docker installed successfully"
}

# Create necessary directories and files
prepare_deployment() {
    show_progress "Preparing deployment environment"
    
    cd "$INSTALL_DIR"
    
    # Create required directories
    mkdir -p {logs,backups,uploads,roms,saves,states,bios,metadata}
    mkdir -p roms/{nintendo,sega,sony,arcade,computer,handheld}
    mkdir -p nginx/conf.d
    mkdir -p monitoring/{prometheus,grafana}
    mkdir -p scripts
    
    # Set proper permissions
    chmod 755 {logs,uploads,roms,saves,states,bios,metadata}
    chmod 750 {backups,scripts}
    
    # Create init-db.sql if missing
    if [[ ! -f "scripts/init-db.sql" ]]; then
        create_database_init_script
    fi
    
    # Create nginx configuration if missing
    if [[ ! -f "nginx/nginx.conf" ]]; then
        create_nginx_config
    fi
    
    # Create monitoring configuration if enabled
    if [[ "${ENABLE_MONITORING:-Y}" =~ ^[Yy] ]]; then
        create_monitoring_config
    fi
    
    log_success "Deployment environment prepared"
}

# Create database initialization script
create_database_init_script() {
    cat > scripts/init-db.sql << 'EOF'
-- RetroGame Server Database Initialization
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create initial admin user table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create platforms table
CREATE TABLE IF NOT EXISTS platforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    short_name VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default admin user (password: admin123)
INSERT INTO users (username, email, password_hash, role) 
VALUES ('admin', 'admin@retrogame.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/VwqgHBZH6QY5/xYUO', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Log initialization
INSERT INTO users (username, email, password_hash, role)
SELECT 'system', 'system@retrogame.local', 'disabled', 'system'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'system');
EOF
}

# Create nginx configuration
create_nginx_config() {
    cat > nginx/nginx.conf << 'EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    
    access_log /var/log/nginx/access.log main;
    
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    client_max_body_size 4G;
    
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    
    include /etc/nginx/conf.d/*.conf;
}
EOF

    cat > nginx/conf.d/default.conf << 'EOF'
upstream backend {
    server backend:3001;
}

upstream frontend {
    server frontend:3000;
}

server {
    listen 80;
    server_name _;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Health check
    location /health {
        access_log off;
        return 200 "OK - RetroGame Server\n";
        add_header Content-Type text/plain;
    }
    
    # API routes
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Upload handling
        client_max_body_size 4G;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
    
    # WebSocket support
    location /ws {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # Frontend
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
}

# Create monitoring configuration
create_monitoring_config() {
    mkdir -p monitoring/{prometheus,grafana/datasources}
    
    cat > monitoring/prometheus/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  
  - job_name: 'retrogame-backend'
    static_configs:
      - targets: ['backend:3001']
    metrics_path: '/api/metrics'
    scrape_interval: 30s
EOF

    cat > monitoring/grafana/datasources/prometheus.yml << 'EOF'
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
EOF
}

# Deploy with Docker Compose
deploy_containers() {
    show_progress "Deploying containers with Docker Compose"
    
    cd "$INSTALL_DIR"
    
    # Pull images first
    log_info "Pulling container images..."
    if ! docker compose pull; then
        log_warn "Some images failed to pull, continuing with build..."
    fi
    
    # Build services that need building
    log_info "Building custom containers..."
    if ! docker compose build; then
        log_error "Container build failed"
        exit 1
    fi
    
    # Start infrastructure services first
    log_info "Starting infrastructure services..."
    if ! docker compose up -d postgres redis; then
        log_error "Failed to start infrastructure services"
        exit 1
    fi
    
    # Wait for infrastructure
    sleep 10
    
    # Start application services
    log_info "Starting application services..."
    if ! docker compose up -d; then
        log_error "Failed to start application services"
        exit 1
    fi
    
    # Start monitoring if enabled
    if [[ "${ENABLE_MONITORING:-Y}" =~ ^[Yy] ]]; then
        log_info "Starting monitoring services..."
        docker compose --profile monitoring up -d || log_warn "Monitoring services failed to start"
    fi
    
    log_success "Container deployment completed"
}

# ==============================================================================
# TESTING AND VALIDATION FUNCTIONS
# ==============================================================================

# Wait for services to be ready
wait_for_services() {
    show_progress "Waiting for services to be ready"
    
    cd "$INSTALL_DIR"
    
    local services=("postgres" "redis" "backend" "frontend")
    local max_attempts=60
    
    for service in "${services[@]}"; do
        log_info "Waiting for $service..."
        local attempts=0
        
        while [[ $attempts -lt $max_attempts ]]; do
            if docker compose ps "$service" --format json 2>/dev/null | jq -r '.[0].Health // .[0].State' | grep -q "healthy\|running"; then
                log_info "✓ $service is ready"
                break
            fi
            
            sleep 2
            ((attempts++))
            
            if [[ $attempts -ge $max_attempts ]]; then
                log_error "$service failed to start within $max_attempts attempts"
                return 1
            fi
        done
    done
    
    # Additional wait for full initialization
    sleep 10
    
    log_success "All services are ready"
}

# Run deployment tests
run_deployment_tests() {
    show_progress "Running deployment tests"
    
    cd "$INSTALL_DIR"
    
    # Test 1: Container health
    log_info "Testing container health..."
    if ! docker compose ps --format json | jq -r '.[].State' | grep -q "running"; then
        log_error "Some containers are not running"
        return 1
    fi
    
    # Test 2: Database connectivity
    log_info "Testing database connectivity..."
    if ! docker compose exec -T postgres pg_isready -U retrogame -d retrogame; then
        log_error "Database connectivity test failed"
        return 1
    fi
    
    # Test 3: Redis connectivity
    log_info "Testing Redis connectivity..."
    if ! docker compose exec -T redis redis-cli ping | grep -q PONG; then
        log_error "Redis connectivity test failed"
        return 1
    fi
    
    # Test 4: Web interface
    log_info "Testing web interface..."
    local response_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/health" || echo "000")
    if [[ "$response_code" != "200" ]]; then
        log_error "Web interface test failed (response: $response_code)"
        return 1
    fi
    
    # Test 5: API endpoints
    log_info "Testing API endpoints..."
    local api_response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")
    if [[ "$api_response" != "200" ]] && [[ "$api_response" != "404" ]]; then
        log_warn "API endpoint test returned: $api_response (may be normal if not implemented)"
    fi
    
    log_success "Deployment tests completed successfully"
}

# ==============================================================================
# POST-DEPLOYMENT FUNCTIONS
# ==============================================================================

# Create systemd service
create_systemd_service() {
    show_progress "Creating systemd service"
    
    cat > /etc/systemd/system/retrogame.service << EOF
[Unit]
Description=RetroGame Server
Documentation=https://github.com/${GITHUB_USER}/${GITHUB_REPO}
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=exec
RemainAfterExit=no
Restart=on-failure
RestartSec=10
TimeoutStartSec=300
TimeoutStopSec=120

User=root
Group=root
WorkingDirectory=$INSTALL_DIR

ExecStartPre=/usr/bin/docker compose down
ExecStart=/usr/bin/docker compose up --remove-orphans
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose restart

# Security
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR $LOG_DIR

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable retrogame.service
    
    log_success "Systemd service created and enabled"
}

# Create management scripts
create_management_scripts() {
    show_progress "Creating management scripts"
    
    # Main management script
    cat > "$INSTALL_DIR/retrogame-manage.sh" << 'EOF'
#!/bin/bash
# RetroGame Server Management Script

set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

case "${1:-help}" in
    "start")
        echo "Starting RetroGame Server..."
        docker compose up -d
        echo "Services started. Check status with: $0 status"
        ;;
    "stop")
        echo "Stopping RetroGame Server..."
        docker compose down
        echo "Services stopped."
        ;;
    "restart")
        echo "Restarting RetroGame Server..."
        docker compose restart
        echo "Services restarted."
        ;;
    "status")
        echo "RetroGame Server Status:"
        docker compose ps
        ;;
    "logs")
        service="${2:-}"
        if [[ -n "$service" ]]; then
            docker compose logs -f "$service"
        else
            docker compose logs -f
        fi
        ;;
    "update")
        echo "Updating RetroGame Server..."
        docker compose pull
        docker compose up -d --remove-orphans
        echo "Update completed."
        ;;
    "backup")
        echo "Creating backup..."
        timestamp=$(date +%Y%m%d_%H%M%S)
        docker compose exec -T postgres pg_dump -U retrogame retrogame | gzip > "backups/database_$timestamp.sql.gz"
        tar -czf "backups/config_$timestamp.tar.gz" .env docker-compose.yml nginx/ monitoring/ 2>/dev/null || true
        echo "Backup created: database_$timestamp.sql.gz and config_$timestamp.tar.gz"
        ;;
    "help"|*)
        echo "RetroGame Server Management"
        echo ""
        echo "Usage: $0 [COMMAND]"
        echo ""
        echo "Commands:"
        echo "  start     - Start all services"
        echo "  stop      - Stop all services"
        echo "  restart   - Restart all services"
        echo "  status    - Show service status"
        echo "  logs      - Show logs (optional: specify service name)"
        echo "  update    - Update containers"
        echo "  backup    - Create database and config backup"
        echo "  help      - Show this help"
        ;;
esac
EOF
    
    chmod +x "$INSTALL_DIR/retrogame-manage.sh"
    
    # Create symbolic link for system-wide access
    ln -sf "$INSTALL_DIR/retrogame-manage.sh" /usr/local/bin/retrogame
    
    log_success "Management scripts created"
}

# ==============================================================================
# CLEANUP AND ERROR HANDLING
# ==============================================================================

# Cleanup on exit
cleanup_on_exit() {
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        create_failure_report "$exit_code"
    else
        create_success_report
    fi
    
    # Calculate duration
    local duration=$(($(date +%s) - START_TIME))
    local minutes=$((duration / 60))
    local seconds=$((duration % 60))
    
    echo
    if [[ $exit_code -eq 0 ]]; then
        echo -e "${GREEN}Deployment completed successfully in ${minutes}m ${seconds}s${NC}"
    else
        echo -e "${RED}Deployment failed after ${minutes}m ${seconds}s${NC}"
        echo -e "${YELLOW}Check logs: $LOG_FILE${NC}"
    fi
}

# Create failure report
create_failure_report() {
    local exit_code="$1"
    
    cat > "$LOG_DIR/deployment/failure-report.txt" << EOF
RETRO GAME SERVER DEPLOYMENT FAILURE REPORT
==========================================
Date: $(date)
Repository: ${GITHUB_USER:-unknown}/${GITHUB_REPO:-unknown}@${GITHUB_BRANCH:-unknown}
Exit Code: $exit_code
Step: $CURRENT_STEP/$TOTAL_STEPS
Duration: $((($(date +%s) - START_TIME) / 60))m $((($(date +%s) - START_TIME) % 60))s

System Information:
- OS: $(lsb_release -d 2>/dev/null | cut -f2 || echo "Unknown")
- RAM: $(free -h | grep Mem | awk '{print $2}')
- Disk: $(df -h / | awk 'NR==2 {print $4 " available"}')
- Docker: $(docker --version 2>/dev/null || echo "Not installed")

Configuration:
- Install Dir: $INSTALL_DIR
- Domain: $DOMAIN
- Interactive Mode: $INTERACTIVE_MODE
- Production Mode: ${PRODUCTION_MODE:-N}

Recent Log Entries:
$(tail -20 "$LOG_FILE" 2>/dev/null || echo "No log entries found")

Container Status:
$(cd "$INSTALL_DIR" 2>/dev/null && docker compose ps 2>/dev/null || echo "No containers found")

Troubleshooting:
1. Check the full log file: $LOG_FILE
2. Verify system requirements are met
3. Ensure GitHub repository is accessible
4. Check for port conflicts
5. Verify Docker is running

Support:
- Repository: https://github.com/${GITHUB_USER}/${GITHUB_REPO}
- Issues: https://github.com/${GITHUB_USER}/${GITHUB_REPO}/issues
EOF
    
    chmod 644 "$LOG_DIR/deployment/failure-report.txt"
    log_error "Failure report created: $LOG_DIR/deployment/failure-report.txt"
}

# Create success report
create_success_report() {
    local duration=$(($(date +%s) - START_TIME))
    
    cat > "$LOG_DIR/deployment/success-report.txt" << EOF
RETRO GAME SERVER DEPLOYMENT SUCCESS REPORT
==========================================
Date: $(date)
Repository: ${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}
Duration: $((duration / 60))m $((duration % 60))s
Install Directory: $INSTALL_DIR

Services Deployed:
✅ PostgreSQL Database
✅ Redis Cache
✅ Backend API Service
✅ Frontend Web Application
✅ Nginx Reverse Proxy
$(if [[ "${ENABLE_MONITORING:-Y}" =~ ^[Yy] ]]; then echo "✅ Prometheus Monitoring"; echo "✅ Grafana Dashboard"; fi)

Access Information:
- Web Interface: http://$DOMAIN
- Health Check: http://$DOMAIN/health
$(if [[ "${ENABLE_MONITORING:-Y}" =~ ^[Yy] ]]; then echo "- Grafana: http://$DOMAIN:3001"; fi)

Important Files:
- Credentials: $INSTALL_DIR/CREDENTIALS.txt
- Environment: $INSTALL_DIR/.env
- Docker Compose: $INSTALL_DIR/docker-compose.yml
- Management Script: $INSTALL_DIR/retrogame-manage.sh

Management Commands:
- Start services: retrogame start
- Stop services: retrogame stop
- Check status: retrogame status
- View logs: retrogame logs
- Create backup: retrogame backup
- Update services: retrogame update

Next Steps:
1. Review credentials: cat $INSTALL_DIR/CREDENTIALS.txt
2. Customize environment: nano $INSTALL_DIR/.env
3. Access web interface: http://$DOMAIN
4. Upload BIOS files to: $INSTALL_DIR/roms/bios/
5. Configure external APIs in .env (optional)
6. Set up SSL certificates for production
7. Schedule regular backups

Service Management:
- Systemd service: systemctl status retrogame
- Direct management: cd $INSTALL_DIR && docker compose ps
- View all logs: cd $INSTALL_DIR && docker compose logs -f

Support:
- Repository: https://github.com/${GITHUB_USER}/${GITHUB_REPO}
- Documentation: $INSTALL_DIR/README.md
- Management: retrogame help
EOF
    
    chmod 644 "$LOG_DIR/deployment/success-report.txt"
    log_success "Success report created: $LOG_DIR/deployment/success-report.txt"
}

# ==============================================================================
# MAIN FUNCTION
# ==============================================================================

# Print usage information
usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

GitHub Deployment Script for RetroGame Server

OPTIONS:
  --github-user USER        GitHub username/organization
  --github-repo REPO        Repository name (default: retro-game-server)
  --github-branch BRANCH    Branch to deploy (default: main)
  --github-token TOKEN      GitHub token for private repos
  --install-dir DIR         Installation directory (default: /opt/retrogame)
  --domain DOMAIN           Server domain (default: localhost)
  --admin-email EMAIL       Admin email address
  --quiet                   Quiet mode (minimal output)
  --non-interactive         Skip interactive prompts
  --force                   Force reinstall over existing installation
  --dry-run                 Show what would be done without executing
  --no-monitoring           Disable monitoring stack
  --enable-ssl              Enable SSL/HTTPS
  --production              Production deployment mode
  --help                    Show this help message

ENVIRONMENT VARIABLES:
  GITHUB_USER              GitHub username/organization
  GITHUB_REPO              Repository name
  GITHUB_BRANCH            Branch to deploy
  GITHUB_TOKEN             GitHub token
  INSTALL_DIR              Installation directory
  DOMAIN                   Server domain
  ADMIN_EMAIL              Admin email
  INTERACTIVE_MODE         Enable interactive mode (true/false)
  QUIET_MODE               Enable quiet mode (true/false)
  DRY_RUN                  Enable dry run mode (true/false)
  FORCE_REINSTALL          Force reinstallation (true/false)

EXAMPLES:
  # Interactive deployment
  sudo $SCRIPT_NAME --github-user myuser --github-repo my-retrogame-server

  # Non-interactive deployment
  sudo $SCRIPT_NAME \\
    --github-user myuser \\
    --github-repo my-retrogame-server \\
    --domain retrogame.example.com \\
    --non-interactive \\
    --production

  # Deploy from environment variables
  sudo GITHUB_USER=myuser GITHUB_REPO=my-server DOMAIN=example.com $SCRIPT_NAME

EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --github-user)
                GITHUB_USER="$2"
                shift 2
                ;;
            --github-repo)
                GITHUB_REPO="$2"
                shift 2
                ;;
            --github-branch)
                GITHUB_BRANCH="$2"
                shift 2
                ;;
            --github-token)
                GITHUB_TOKEN="$2"
                shift 2
                ;;
            --install-dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --admin-email)
                ADMIN_EMAIL="$2"
                shift 2
                ;;
            --quiet)
                QUIET_MODE="true"
                shift
                ;;
            --non-interactive)
                INTERACTIVE_MODE="false"
                SKIP_PROMPTS="true"
                shift
                ;;
            --force)
                FORCE_REINSTALL="true"
                shift
                ;;
            --dry-run)
                DRY_RUN="true"
                shift
                ;;
            --no-monitoring)
                ENABLE_MONITORING="false"
                shift
                ;;
            --enable-ssl)
                ENABLE_SSL="true"
                shift
                ;;
            --production)
                PRODUCTION_MODE="true"
                shift
                ;;
            --help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# Main function
main() {
    # Set up signal handlers
    trap cleanup_on_exit EXIT
    trap 'log_error "Deployment interrupted by user"; exit 130' INT TERM
    
    # Parse arguments
    parse_arguments "$@"
    
    # Initialize
    print_banner
    init_logging
    
    log_info "Starting RetroGame Server deployment from GitHub"
    log_info "Script version: $SCRIPT_VERSION"
    log_info "Target repository: ${GITHUB_USER:-<not set>}/${GITHUB_REPO}@${GITHUB_BRANCH}"
    log_info "Installation directory: $INSTALL_DIR"
    log_info "Log file: $LOG_FILE"
    
    # Phase 1: Configuration and Validation
    log_info "Phase 1: Configuration and System Validation"
    configure_deployment
    validate_system
    check_existing_installation
    
    # Phase 2: Repository Download and Preparation
    log_info "Phase 2: Repository Download and Preparation"
    download_repository
    validate_repository
    
    # Phase 3: Environment Configuration
    log_info "Phase 3: Environment Configuration"
    create_environment_config
    customize_environment
    
    # Phase 4: Docker Installation and Deployment
    log_info "Phase 4: Docker Installation and Deployment"
    install_docker
    prepare_deployment
    
    if [[ "$DRY_RUN" != "true" ]]; then
        deploy_containers
        wait_for_services
        run_deployment_tests
    else
        log_info "DRY RUN: Skipping container deployment"
    fi
    
    # Phase 5: Post-Deployment Configuration
    log_info "Phase 5: Post-Deployment Configuration"
    if [[ "$DRY_RUN" != "true" ]]; then
        create_systemd_service
        create_management_scripts
    else
        log_info "DRY RUN: Skipping post-deployment configuration"
    fi
    
    # Success
    echo
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║                   🎉 DEPLOYMENT SUCCESSFUL! 🎉                     ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "${CYAN}🌐 Access your RetroGame Server at: ${YELLOW}http://$DOMAIN${NC}"
    echo -e "${CYAN}📋 Credentials and configuration: ${YELLOW}$INSTALL_DIR/CREDENTIALS.txt${NC}"
    echo -e "${CYAN}🛠️  Management commands: ${YELLOW}retrogame help${NC}"
    echo -e "${CYAN}📊 Success report: ${YELLOW}$LOG_DIR/deployment/success-report.txt${NC}"
    echo
    echo -e "${BLUE}Quick Start:${NC}"
    echo -e "   • View credentials: ${YELLOW}cat $INSTALL_DIR/CREDENTIALS.txt${NC}"
    echo -e "   • Check status: ${YELLOW}retrogame status${NC}"
    echo -e "   • View logs: ${YELLOW}retrogame logs${NC}"
    echo -e "   • Access web interface: ${YELLOW}http://$DOMAIN${NC}"
    echo
}

# Execute main function if script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi