#!/bin/bash

# ==============================================================================
# UPDATE MANAGEMENT AND DEPLOYMENT SCRIPT
# Zero-downtime deployment and update management for RetroGame Server
# ==============================================================================

set -euo pipefail

# Configuration
COMPOSE_FILE="${COMPOSE_FILE:-/opt/retrogame/docker-compose.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-retrogame}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
REGISTRY="${REGISTRY:-retrogame}"
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"
ROLLBACK_LIMIT="${ROLLBACK_LIMIT:-3}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    send_notification "❌ Deployment Failed" "$1" "error"
    exit 1
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Send notifications
send_notification() {
    local title="$1"
    local message="$2"
    local level="${3:-info}"
    
    if [[ -n "$SLACK_WEBHOOK" ]]; then
        local color="good"
        [[ "$level" == "error" ]] && color="danger"
        [[ "$level" == "warning" ]] && color="warning"
        
        curl -X POST "$SLACK_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "{
                \"text\": \"$title\",
                \"attachments\": [{
                    \"color\": \"$color\",
                    \"text\": \"$message\",
                    \"fields\": [{
                        \"title\": \"Server\",
                        \"value\": \"$(hostname)\",
                        \"short\": true
                    }, {
                        \"title\": \"Time\",
                        \"value\": \"$(date)\",
                        \"short\": true
                    }]
                }]
            }" 2>/dev/null || true
    fi
}

# Check prerequisites
check_prerequisites() {
    local required_commands=("docker" "docker-compose" "curl" "jq")
    
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            error "Required command not found: $cmd"
        fi
    done
    
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        error "Docker compose file not found: $COMPOSE_FILE"
    fi
    
    info "Prerequisites check passed"
}

# Health check function
health_check() {
    local service="$1"
    local max_attempts="${2:-30}"
    local attempt=0
    
    log "Performing health check for $service..."
    
    while [[ $attempt -lt $max_attempts ]]; do
        if docker-compose -f "$COMPOSE_FILE" ps "$service" | grep -q "Up (healthy)"; then
            log "$service is healthy"
            return 0
        fi
        
        ((attempt++))
        info "Health check attempt $attempt/$max_attempts for $service..."
        sleep 10
    done
    
    error "$service failed health check after $max_attempts attempts"
}

# Create backup before deployment
create_pre_deployment_backup() {
    log "Creating pre-deployment backup..."
    
    local backup_script="/usr/local/bin/backup-system.sh"
    if [[ -f "$backup_script" ]]; then
        "$backup_script" backup
    else
        warn "Backup script not found, creating basic backup..."
        
        # Basic database backup
        docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dumpall -U retrogame | \
            gzip > "${BACKUP_DIR}/pre-deployment-$(date +%Y%m%d_%H%M%S).sql.gz"
    fi
    
    log "Pre-deployment backup completed"
}

# Update system packages
update_system() {
    log "Updating system packages..."
    
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get upgrade -y -qq
    apt-get autoremove -y -qq
    apt-get autoclean -qq
    
    # Update Docker if needed
    local current_version=$(docker --version | grep -oP '\d+\.\d+\.\d+')
    local latest_version=$(curl -s https://api.github.com/repos/docker/docker-ce/releases/latest | jq -r '.tag_name' | sed 's/v//')
    
    if [[ "$current_version" != "$latest_version" ]]; then
        info "Updating Docker from $current_version to $latest_version"
        curl -fsSL https://get.docker.com | sh
        systemctl restart docker
    fi
    
    log "System packages updated"
}

# Pull latest images
pull_images() {
    log "Pulling latest container images..."
    
    # Pull all images defined in compose file
    docker-compose -f "$COMPOSE_FILE" pull --ignore-pull-failures
    
    # Build custom images with cache
    docker-compose -f "$COMPOSE_FILE" build --pull
    
    log "Images updated successfully"
}

# Zero-downtime deployment
deploy_zero_downtime() {
    log "Starting zero-downtime deployment..."
    
    send_notification "🚀 Deployment Started" "Zero-downtime deployment initiated"
    
    # Create backup
    create_pre_deployment_backup
    
    # Pull latest images
    pull_images
    
    # Update services one by one to maintain availability
    local services=("backend" "frontend" "emulator-service")
    
    for service in "${services[@]}"; do
        log "Updating service: $service"
        
        # Scale up new instance
        docker-compose -f "$COMPOSE_FILE" up -d --scale "$service"=2 --no-recreate "$service"
        
        # Wait for new instance to be healthy
        sleep 30
        health_check "$service"
        
        # Remove old instance
        local old_container=$(docker-compose -f "$COMPOSE_FILE" ps -q "$service" | head -1)
        if [[ -n "$old_container" ]]; then
            docker stop "$old_container"
            docker rm "$old_container"
        fi
        
        # Scale back to 1
        docker-compose -f "$COMPOSE_FILE" up -d --scale "$service"=1 --no-recreate "$service"
        
        log "Service $service updated successfully"
    done
    
    # Update supporting services (can have brief downtime)
    local support_services=("caddy" "prometheus" "grafana")
    
    for service in "${support_services[@]}"; do
        log "Updating support service: $service"
        docker-compose -f "$COMPOSE_FILE" up -d "$service"
        health_check "$service" 15
    done
    
    log "Zero-downtime deployment completed"
    send_notification "✅ Deployment Successful" "All services updated and healthy"
}

# Rollback deployment
rollback_deployment() {
    local version="${1:-previous}"
    
    warn "Starting rollback to $version..."
    send_notification "⚠️ Rollback Started" "Rolling back to $version"
    
    # Get previous image versions
    local backup_compose="/opt/retrogame/docker-compose.backup.yml"
    
    if [[ -f "$backup_compose" ]]; then
        log "Rolling back using backup compose file"
        docker-compose -f "$backup_compose" up -d
    else
        # Try to rollback using Docker image tags
        log "Attempting to rollback using image tags"
        
        # This would require a more sophisticated tagging strategy
        # For now, we'll restore from the latest backup
        warn "No backup compose file found, restoring from backup..."
        restore_from_backup
    fi
    
    # Verify rollback
    sleep 30
    if check_all_services_healthy; then
        log "Rollback completed successfully"
        send_notification "✅ Rollback Successful" "Services restored to previous version"
    else
        error "Rollback failed - services are not healthy"
    fi
}

# Check if all services are healthy
check_all_services_healthy() {
    local services=("backend" "frontend" "postgres" "redis" "caddy")
    
    for service in "${services[@]}"; do
        if ! docker-compose -f "$COMPOSE_FILE" ps "$service" | grep -q "Up"; then
            return 1
        fi
    done
    
    return 0
}

# Restore from backup
restore_from_backup() {
    warn "Restoring from backup..."
    
    local backup_script="/usr/local/bin/backup-system.sh"
    if [[ -f "$backup_script" ]]; then
        "$backup_script" restore latest all
    else
        error "Backup script not found, cannot restore"
    fi
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."
    
    # Wait for database to be ready
    health_check "postgres"
    
    # Run migrations
    docker-compose -f "$COMPOSE_FILE" exec -T backend npm run db:migrate 2>/dev/null || \
    docker-compose -f "$COMPOSE_FILE" exec -T backend npm run db:deploy || \
    warn "Migration command not found or failed"
    
    log "Database migrations completed"
}

# Performance optimization
optimize_performance() {
    log "Applying performance optimizations..."
    
    # Docker system cleanup
    docker system prune -f
    docker image prune -f
    docker volume prune -f
    
    # Optimize PostgreSQL
    docker-compose -f "$COMPOSE_FILE" exec -T postgres psql -U retrogame -d retrogame -c "VACUUM ANALYZE;"
    
    # Restart services to apply optimizations
    docker-compose -f "$COMPOSE_FILE" restart redis
    
    log "Performance optimizations applied"
}

# Security updates
update_security() {
    log "Applying security updates..."
    
    # Update security packages only
    apt-get update -qq
    apt-get upgrade -y -qq --with-new-pkgs \
        $(apt list --upgradable 2>/dev/null | grep -E "(security|CVE)" | cut -d'/' -f1)
    
    # Update security configurations
    local security_script="/usr/local/bin/security-hardening.sh"
    if [[ -f "$security_script" ]]; then
        "$security_script" --update-only
    fi
    
    # Restart security services
    systemctl restart fail2ban ufw apparmor || true
    
    log "Security updates completed"
}

# Configuration validation
validate_configuration() {
    log "Validating configuration..."
    
    # Validate Docker Compose file
    docker-compose -f "$COMPOSE_FILE" config >/dev/null
    
    # Validate Caddy configuration
    if docker-compose -f "$COMPOSE_FILE" exec caddy caddy validate /etc/caddy/Caddyfile; then
        log "Caddy configuration is valid"
    else
        error "Caddy configuration validation failed"
    fi
    
    # Check environment variables
    local required_env_vars=("DB_PASSWORD" "REDIS_PASSWORD" "JWT_SECRET")
    for var in "${required_env_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            error "Required environment variable not set: $var"
        fi
    done
    
    log "Configuration validation passed"
}

# Maintenance mode
maintenance_mode() {
    local action="$1"  # on|off
    
    case "$action" in
        "on")
            log "Enabling maintenance mode..."
            
            # Create maintenance page
            cat > /tmp/maintenance.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Maintenance - RetroGame Server</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .container { max-width: 600px; margin: 0 auto; }
        h1 { color: #333; }
        .emoji { font-size: 48px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="emoji">🔧</div>
        <h1>Maintenance in Progress</h1>
        <p>We're currently updating the RetroGame Server to serve you better.</p>
        <p>Please check back in a few minutes.</p>
        <p><small>If this continues for more than 30 minutes, please contact support.</small></p>
    </div>
</body>
</html>
EOF

            # Update Caddy to serve maintenance page
            docker cp /tmp/maintenance.html "$(docker-compose -f "$COMPOSE_FILE" ps -q caddy)":/var/www/maintenance.html
            
            send_notification "🔧 Maintenance Mode" "Maintenance mode enabled"
            ;;
        "off")
            log "Disabling maintenance mode..."
            
            # Restart Caddy to restore normal operation
            docker-compose -f "$COMPOSE_FILE" restart caddy
            
            send_notification "✅ Maintenance Complete" "Maintenance mode disabled"
            ;;
        *)
            error "Invalid maintenance mode action: $action"
            ;;
    esac
}

# Generate deployment report
generate_report() {
    log "Generating deployment report..."
    
    local report_file="/tmp/deployment-report-$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$report_file" << EOF
RetroGame Server Deployment Report
==================================
Date: $(date)
Server: $(hostname)
Compose Project: $COMPOSE_PROJECT

Service Status:
EOF
    
    # Add service status
    docker-compose -f "$COMPOSE_FILE" ps >> "$report_file"
    
    cat >> "$report_file" << EOF

Image Versions:
EOF
    
    # Add image versions
    docker-compose -f "$COMPOSE_FILE" images >> "$report_file"
    
    cat >> "$report_file" << EOF

System Resources:
$(free -h)

Disk Usage:
$(df -h /)

Docker System:
$(docker system df)
EOF
    
    # Display report
    cat "$report_file"
    
    # Send report
    send_notification "📊 Deployment Report" "$(cat "$report_file")"
}

# Main function
main() {
    local operation="${1:-deploy}"
    
    case "$operation" in
        "deploy")
            log "Starting full deployment process..."
            check_prerequisites
            validate_configuration
            maintenance_mode on
            deploy_zero_downtime
            run_migrations
            optimize_performance
            maintenance_mode off
            generate_report
            log "Deployment completed successfully"
            ;;
        "update-system")
            update_system
            ;;
        "update-security")
            update_security
            ;;
        "rollback")
            rollback_deployment "$2"
            ;;
        "maintenance")
            maintenance_mode "$2"
            ;;
        "validate")
            validate_configuration
            ;;
        "report")
            generate_report
            ;;
        "health-check")
            if check_all_services_healthy; then
                log "All services are healthy"
                exit 0
            else
                error "Some services are not healthy"
            fi
            ;;
        *)
            echo "Usage: $0 {deploy|update-system|update-security|rollback|maintenance|validate|report|health-check}"
            echo ""
            echo "  deploy           - Full zero-downtime deployment"
            echo "  update-system    - Update system packages"
            echo "  update-security  - Apply security updates"
            echo "  rollback [version] - Rollback to previous version"
            echo "  maintenance {on|off} - Enable/disable maintenance mode"
            echo "  validate         - Validate configuration"
            echo "  report           - Generate deployment report"
            echo "  health-check     - Check service health"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"