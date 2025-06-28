#!/bin/bash

# Enhanced RetroGame Master Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR-USERNAME/YOUR-REPO/main/install.sh | sudo bash

set -euo pipefail

# Configuration
REPO_URL="https://github.com/doug12r/retro-games1"
BRANCH="main"
INSTALL_DIR="/opt/retrogame"
LOG_FILE="/var/log/retrogame-install.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR] $1${NC}" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "${YELLOW}[WARN] $1${NC}" | tee -a "$LOG_FILE"
}

log_info() {
    echo -e "${BLUE}[INFO] $1${NC}" | tee -a "$LOG_FILE"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check Ubuntu version
check_ubuntu() {
    if ! grep -q "Ubuntu" /etc/os-release; then
        log_error "This script is designed for Ubuntu systems"
        exit 1
    fi
    
    local version=$(lsb_release -rs | cut -d. -f1)
    if [[ $version -lt 20 ]]; then
        log_error "Ubuntu 20.04 or newer is required"
        exit 1
    fi
    
    log "Ubuntu $(lsb_release -rs) detected"
}

# Check system requirements
check_requirements() {
    log "Checking system requirements..."
    
    # Check memory (minimum 2GB)
    local mem_gb=$(free -g | awk '/^Mem:/{print $2}')
    if [[ $mem_gb -lt 2 ]]; then
        log_warn "Only ${mem_gb}GB RAM detected. 2GB+ recommended"
    fi
    
    # Check disk space (minimum 10GB)
    local disk_gb=$(df / | awk 'NR==2{print int($4/1024/1024)}')
    if [[ $disk_gb -lt 10 ]]; then
        log_error "Insufficient disk space. ${disk_gb}GB available, 10GB+ required"
        exit 1
    fi
    
    log "System requirements check passed"
}

# Install dependencies
install_dependencies() {
    log "Installing system dependencies..."
    
    # Update package lists
    apt-get update -qq
    
    # Install essential packages
    apt-get install -y -qq \
        curl \
        wget \
        git \
        docker.io \
        docker-compose \
        nodejs \
        npm \
        build-essential \
        software-properties-common \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release
    
    # Enable and start Docker
    systemctl enable docker
    systemctl start docker
    
    # Add current user to docker group (if not root)
    if [[ -n "${SUDO_USER:-}" ]]; then
        usermod -aG docker "$SUDO_USER"
        log "Added $SUDO_USER to docker group (logout/login required)"
    fi
    
    log "Dependencies installed successfully"
}

# Clone and setup repository
setup_repository() {
    log "Setting up RetroGame repository..."
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    
    # Clone repository
    if [[ -d ".git" ]]; then
        log "Repository already exists, pulling latest changes..."
        git pull origin "$BRANCH"
    else
        log "Cloning repository..."
        git clone -b "$BRANCH" "$REPO_URL" .
    fi
    
    # Make scripts executable
    find . -name "*.sh" -exec chmod +x {} \;
    
    log "Repository setup completed"
}

# Build and start services
start_services() {
    log "Building and starting RetroGame services..."
    
    cd "$INSTALL_DIR"
    
    # Build Docker images
    docker-compose build --parallel
    
    # Start services
    docker-compose up -d
    
    # Wait for services to be ready
    log "Waiting for services to start..."
    sleep 30
    
    # Check service health
    if docker-compose ps | grep -q "Up"; then
        log "Services started successfully"
    else
        log_error "Some services failed to start"
        docker-compose logs
        exit 1
    fi
}

# Setup firewall
setup_firewall() {
    log "Configuring firewall..."
    
    # Enable UFW
    ufw --force enable
    
    # Allow SSH
    ufw allow ssh
    
    # Allow web services
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 3000/tcp
    ufw allow 8080/tcp
    
    # Allow emulator ports
    ufw allow 5900:5920/tcp  # VNC
    ufw allow 6080/tcp       # NoVNC
    
    log "Firewall configured"
}

# Create systemd service
create_service() {
    log "Creating systemd service..."
    
    cat > /etc/systemd/system/retrogame.service << EOF
[Unit]
Description=RetroGame Emulator Service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable retrogame.service
    
    log "Systemd service created and enabled"
}

# Display completion message
show_completion() {
    log "="
    log "🎮 RetroGame Installation Complete! 🎮"
    log "="
    log_info "Services are running at:"
    log_info "  • Frontend: http://$(hostname -I | awk '{print $1}'):3000"
    log_info "  • API: http://$(hostname -I | awk '{print $1}'):8080"
    log_info "  • Emulator VNC: http://$(hostname -I | awk '{print $1}'):6080"
    log ""
    log_info "Useful commands:"
    log_info "  • Check status: docker-compose ps"
    log_info "  • View logs: docker-compose logs -f"
    log_info "  • Restart: sudo systemctl restart retrogame"
    log_info "  • Stop: sudo systemctl stop retrogame"
    log ""
    log_info "Installation directory: $INSTALL_DIR"
    log_info "Log file: $LOG_FILE"
    log_info "Repository: https://github.com/doug12r/retro-games1"
    log_info "Issues: https://github.com/doug12r/retro-games1/issues"
    log ""
    log "🚀 Happy gaming! 🚀"
}

# Cleanup function
cleanup() {
    if [[ $? -ne 0 ]]; then
        log_error "Installation failed. Check $LOG_FILE for details"
        log_info "You can retry the installation or check our documentation at:"
        log_info "https://github.com/doug12r/retro-games1"
    fi
}

# Main installation function
main() {
    trap cleanup EXIT
    
    log "Starting RetroGame installation..."
    
    check_root
    check_ubuntu
    check_requirements
    install_dependencies
    setup_repository
    start_services
    setup_firewall
    create_service
    show_completion
    
    log "Installation completed successfully!"
}

# Handle command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --repo-url)
            REPO_URL="$2"
            shift 2
            ;;
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --repo-url URL     GitHub repository URL (default: https://github.com/doug12r/retro-games1)"
            echo "  --branch BRANCH    Git branch to clone (default: main)"
            echo "  --install-dir DIR  Installation directory (default: /opt/retrogame)"
            echo "  --help            Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main installation
main "$@"