#!/bin/bash

# ==============================================================================
# ENTERPRISE BACKUP SYSTEM
# Production-ready backup solution for RetroGame Server
# ==============================================================================

set -euo pipefail

# Configuration
BACKUP_BASE_DIR="${BACKUP_DIR:-/opt/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DATE=$(date +%Y-%m-%d)
RETENTION_DAYS="${RETENTION_DAYS:-30}"
WEEKLY_RETENTION="${WEEKLY_RETENTION:-12}"  # weeks
MONTHLY_RETENTION="${MONTHLY_RETENTION:-12}"  # months

# Docker compose project
COMPOSE_PROJECT="${COMPOSE_PROJECT:-retrogame}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/retrogame/docker-compose.yml}"

# Notification settings
WEBHOOK_URL="${WEBHOOK_URL:-}"
SMTP_SERVER="${SMTP_SERVER:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "${BACKUP_BASE_DIR}/backup.log"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a "${BACKUP_BASE_DIR}/backup.log"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "${BACKUP_BASE_DIR}/backup.log"
    send_notification "Backup Failed" "$1" "error"
    exit 1
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}" | tee -a "${BACKUP_BASE_DIR}/backup.log"
}

# Create backup directories
create_backup_dirs() {
    local dirs=(
        "${BACKUP_BASE_DIR}"
        "${BACKUP_BASE_DIR}/daily"
        "${BACKUP_BASE_DIR}/weekly"
        "${BACKUP_BASE_DIR}/monthly"
        "${BACKUP_BASE_DIR}/database"
        "${BACKUP_BASE_DIR}/config"
        "${BACKUP_BASE_DIR}/roms"
        "${BACKUP_BASE_DIR}/saves"
        "${BACKUP_BASE_DIR}/uploads"
        "${BACKUP_BASE_DIR}/logs"
    )
    
    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
    done
}

# Send notification
send_notification() {
    local title="$1"
    local message="$2"
    local level="${3:-info}"
    
    # Webhook notification
    if [[ -n "$WEBHOOK_URL" ]]; then
        curl -X POST "$WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{
                \"text\": \"RetroGame Backup: $title\",
                \"attachments\": [{
                    \"color\": \"$([ "$level" == "error" ] && echo "danger" || echo "good")\",
                    \"text\": \"$message\",
                    \"ts\": $(date +%s)
                }]
            }" 2>/dev/null || true
    fi
    
    # Email notification
    if [[ -n "$SMTP_SERVER" && -n "$ADMIN_EMAIL" ]]; then
        {
            echo "Subject: RetroGame Backup: $title"
            echo "From: backup@$(hostname)"
            echo "To: $ADMIN_EMAIL"
            echo ""
            echo "$message"
            echo ""
            echo "Backup completed on: $(date)"
            echo "Server: $(hostname)"
        } | sendmail "$ADMIN_EMAIL" 2>/dev/null || true
    fi
}

# Check if Docker containers are running
check_docker_status() {
    if ! docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
        warn "Some Docker containers are not running. Continuing with backup anyway."
    fi
}

# Backup PostgreSQL database
backup_database() {
    log "Starting database backup..."
    
    local backup_file="${BACKUP_BASE_DIR}/database/postgres_${DATE}.sql.gz"
    local latest_file="${BACKUP_BASE_DIR}/database/postgres_latest.sql.gz"
    
    # Create database backup
    if docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dumpall -U retrogame | gzip > "$backup_file"; then
        # Create latest symlink
        ln -sf "postgres_${DATE}.sql.gz" "$latest_file"
        
        # Verify backup integrity
        if gunzip -t "$backup_file"; then
            local size=$(du -h "$backup_file" | cut -f1)
            log "Database backup completed successfully: $backup_file ($size)"
        else
            error "Database backup verification failed"
        fi
    else
        error "Database backup failed"
    fi
}

# Backup Redis data
backup_redis() {
    log "Starting Redis backup..."
    
    local backup_file="${BACKUP_BASE_DIR}/database/redis_${DATE}.rdb"
    local latest_file="${BACKUP_BASE_DIR}/database/redis_latest.rdb"
    
    # Force Redis to save data
    docker-compose -f "$COMPOSE_FILE" exec -T redis redis-cli -a "${REDIS_PASSWORD:-redis123}" BGSAVE
    
    # Wait for background save to complete
    while [ "$(docker-compose -f "$COMPOSE_FILE" exec -T redis redis-cli -a "${REDIS_PASSWORD:-redis123}" LASTSAVE)" = "$(docker-compose -f "$COMPOSE_FILE" exec -T redis redis-cli -a "${REDIS_PASSWORD:-redis123}" LASTSAVE)" ]; do
        sleep 1
    done
    
    # Copy Redis dump file
    if docker cp "$(docker-compose -f "$COMPOSE_FILE" ps -q redis)":/data/dump.rdb "$backup_file"; then
        ln -sf "redis_${DATE}.rdb" "$latest_file"
        local size=$(du -h "$backup_file" | cut -f1)
        log "Redis backup completed successfully: $backup_file ($size)"
    else
        error "Redis backup failed"
    fi
}

# Backup ROM collection
backup_roms() {
    log "Starting ROM collection backup..."
    
    local backup_file="${BACKUP_BASE_DIR}/roms/roms_${DATE}.tar.gz"
    local latest_file="${BACKUP_BASE_DIR}/roms/roms_latest.tar.gz"
    local source_dir="/opt/retrogame/roms"
    
    if [[ ! -d "$source_dir" ]]; then
        warn "ROM directory not found: $source_dir"
        return 0
    fi
    
    # Only backup if it's the weekly backup day (Sunday) or if forced
    if [[ "$(date +%u)" == "7" ]] || [[ "${FORCE_ROM_BACKUP:-false}" == "true" ]]; then
        if tar -czf "$backup_file" -C /opt/retrogame roms/ --exclude="*.tmp" --exclude="*.part"; then
            ln -sf "roms_${DATE}.tar.gz" "$latest_file"
            local size=$(du -h "$backup_file" | cut -f1)
            log "ROM backup completed successfully: $backup_file ($size)"
        else
            error "ROM backup failed"
        fi
    else
        info "Skipping ROM backup (only runs weekly on Sundays)"
    fi
}

# Backup configuration files
backup_configs() {
    log "Starting configuration backup..."
    
    local backup_file="${BACKUP_BASE_DIR}/config/config_${DATE}.tar.gz"
    local latest_file="${BACKUP_BASE_DIR}/config/config_latest.tar.gz"
    
    local config_files=(
        "/opt/retrogame/docker-compose.yml"
        "/opt/retrogame/.env"
        "/opt/retrogame/Caddyfile"
        "/etc/caddy/"
        "/opt/retrogame/monitoring/"
        "/etc/fail2ban/"
        "/etc/ufw/"
        "/etc/apparmor.d/"
        "/usr/local/bin/security-*.sh"
        "/usr/local/bin/backup-*.sh"
        "/usr/local/bin/update-*.sh"
    )
    
    local temp_dir=$(mktemp -d)
    
    # Copy configuration files to temporary directory
    for config in "${config_files[@]}"; do
        if [[ -e "$config" ]]; then
            local dest_dir="$temp_dir$(dirname "$config")"
            mkdir -p "$dest_dir"
            cp -r "$config" "$dest_dir/" 2>/dev/null || warn "Failed to copy $config"
        fi
    done
    
    # Create configuration backup
    if tar -czf "$backup_file" -C "$temp_dir" .; then
        rm -rf "$temp_dir"
        ln -sf "config_${DATE}.tar.gz" "$latest_file"
        local size=$(du -h "$backup_file" | cut -f1)
        log "Configuration backup completed successfully: $backup_file ($size)"
    else
        rm -rf "$temp_dir"
        error "Configuration backup failed"
    fi
}

# Backup save states and game data
backup_saves() {
    log "Starting save states backup..."
    
    local backup_file="${BACKUP_BASE_DIR}/saves/saves_${DATE}.tar.gz"
    local latest_file="${BACKUP_BASE_DIR}/saves/saves_latest.tar.gz"
    local source_dir="/opt/retrogame/saves"
    
    if [[ ! -d "$source_dir" ]]; then
        warn "Saves directory not found: $source_dir"
        return 0
    fi
    
    if tar -czf "$backup_file" -C /opt/retrogame saves/; then
        ln -sf "saves_${DATE}.tar.gz" "$latest_file"
        local size=$(du -h "$backup_file" | cut -f1)
        log "Save states backup completed successfully: $backup_file ($size)"
    else
        error "Save states backup failed"
    fi
}

# Backup uploads and user data
backup_uploads() {
    log "Starting uploads backup..."
    
    local backup_file="${BACKUP_BASE_DIR}/uploads/uploads_${DATE}.tar.gz"
    local latest_file="${BACKUP_BASE_DIR}/uploads/uploads_latest.tar.gz"
    local source_dir="/opt/retrogame/uploads"
    
    if [[ ! -d "$source_dir" ]]; then
        warn "Uploads directory not found: $source_dir"
        return 0
    fi
    
    if tar -czf "$backup_file" -C /opt/retrogame uploads/ --exclude="*.tmp" --exclude="*.part"; then
        ln -sf "uploads_${DATE}.tar.gz" "$latest_file"
        local size=$(du -h "$backup_file" | cut -f1)
        log "Uploads backup completed successfully: $backup_file ($size)"
    else
        error "Uploads backup failed"
    fi
}

# Backup logs
backup_logs() {
    log "Starting logs backup..."
    
    local backup_file="${BACKUP_BASE_DIR}/logs/logs_${DATE}.tar.gz"
    local latest_file="${BACKUP_BASE_DIR}/logs/logs_latest.tar.gz"
    
    local log_dirs=(
        "/var/log/caddy/"
        "/var/log/fail2ban/"
        "/var/log/ufw.log"
        "/var/log/auth.log"
        "/var/log/syslog"
        "/opt/retrogame/logs/"
    )
    
    local temp_dir=$(mktemp -d)
    
    # Copy log files to temporary directory
    for log_path in "${log_dirs[@]}"; do
        if [[ -e "$log_path" ]]; then
            local dest_dir="$temp_dir$(dirname "$log_path")"
            mkdir -p "$dest_dir"
            cp -r "$log_path" "$dest_dir/" 2>/dev/null || warn "Failed to copy $log_path"
        fi
    done
    
    # Create logs backup (only if we have logs to backup)
    if [[ -n "$(find "$temp_dir" -type f)" ]]; then
        if tar -czf "$backup_file" -C "$temp_dir" .; then
            rm -rf "$temp_dir"
            ln -sf "logs_${DATE}.tar.gz" "$latest_file"
            local size=$(du -h "$backup_file" | cut -f1)
            log "Logs backup completed successfully: $backup_file ($size)"
        else
            rm -rf "$temp_dir"
            error "Logs backup failed"
        fi
    else
        rm -rf "$temp_dir"
        info "No logs found to backup"
    fi
}

# Create incremental backup
create_incremental_backup() {
    local backup_type="$1"  # daily, weekly, monthly
    local target_dir="${BACKUP_BASE_DIR}/${backup_type}"
    local archive_name="retrogame_${backup_type}_${DATE}.tar.gz"
    local archive_path="${target_dir}/${archive_name}"
    
    log "Creating $backup_type incremental backup..."
    
    # Create manifest of current backup
    cat > "${target_dir}/manifest_${DATE}.txt" << EOF
Backup Type: $backup_type
Backup Date: $(date)
Server: $(hostname)
Docker Compose Project: $COMPOSE_PROJECT

Included Files:
EOF
    
    # Find and include backup files
    local backup_files=()
    for category in database config saves uploads; do
        local latest_file="${BACKUP_BASE_DIR}/${category}/${category}_latest.tar.gz"
        if [[ -f "$latest_file" ]]; then
            backup_files+=("$latest_file")
            echo "- $latest_file" >> "${target_dir}/manifest_${DATE}.txt"
        fi
    done
    
    # Include ROM backup only for weekly/monthly
    if [[ "$backup_type" != "daily" ]]; then
        local rom_latest="${BACKUP_BASE_DIR}/roms/roms_latest.tar.gz"
        if [[ -f "$rom_latest" ]]; then
            backup_files+=("$rom_latest")
            echo "- $rom_latest" >> "${target_dir}/manifest_${DATE}.txt"
        fi
    fi
    
    # Create the incremental backup archive
    if tar -czf "$archive_path" "${backup_files[@]}" "${target_dir}/manifest_${DATE}.txt"; then
        local size=$(du -h "$archive_path" | cut -f1)
        log "$backup_type backup created successfully: $archive_path ($size)"
        
        # Create latest symlink
        ln -sf "$archive_name" "${target_dir}/latest.tar.gz"
    else
        error "Failed to create $backup_type backup"
    fi
}

# Cleanup old backups
cleanup_backups() {
    log "Starting backup cleanup..."
    
    # Cleanup daily backups
    find "${BACKUP_BASE_DIR}/daily" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete
    find "${BACKUP_BASE_DIR}/database" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete
    find "${BACKUP_BASE_DIR}/database" -name "*.rdb" -mtime +${RETENTION_DAYS} -delete
    
    # Cleanup weekly backups
    find "${BACKUP_BASE_DIR}/weekly" -name "*.tar.gz" -mtime +$((WEEKLY_RETENTION * 7)) -delete
    
    # Cleanup monthly backups
    find "${BACKUP_BASE_DIR}/monthly" -name "*.tar.gz" -mtime +$((MONTHLY_RETENTION * 30)) -delete
    
    # Cleanup individual category backups
    for category in config saves uploads logs; do
        find "${BACKUP_BASE_DIR}/${category}" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete
    done
    
    # Cleanup ROM backups (keep fewer due to size)
    find "${BACKUP_BASE_DIR}/roms" -name "*.tar.gz" -mtime +7 -delete
    
    # Cleanup old manifest files
    find "${BACKUP_BASE_DIR}" -name "manifest_*.txt" -mtime +${RETENTION_DAYS} -delete
    
    log "Backup cleanup completed"
}

# Verify backup integrity
verify_backups() {
    log "Verifying backup integrity..."
    
    local verification_failed=false
    
    # Check database backup
    local db_backup="${BACKUP_BASE_DIR}/database/postgres_latest.sql.gz"
    if [[ -f "$db_backup" ]]; then
        if ! gunzip -t "$db_backup"; then
            error "Database backup verification failed"
            verification_failed=true
        fi
    fi
    
    # Check other tar.gz backups
    for backup_file in "${BACKUP_BASE_DIR}"/*/*.tar.gz; do
        if [[ -f "$backup_file" && "$backup_file" != *"latest"* ]]; then
            if ! tar -tzf "$backup_file" >/dev/null 2>&1; then
                warn "Backup verification failed for: $backup_file"
                verification_failed=true
            fi
        fi
    done
    
    if [[ "$verification_failed" == "false" ]]; then
        log "All backups verified successfully"
    else
        warn "Some backup verifications failed - check logs"
    fi
}

# Generate backup report
generate_report() {
    log "Generating backup report..."
    
    local report_file="${BACKUP_BASE_DIR}/backup_report_${DATE}.txt"
    
    cat > "$report_file" << EOF
RetroGame Server Backup Report
==============================
Date: $(date)
Server: $(hostname)
Backup Directory: $BACKUP_BASE_DIR

Backup Status:
EOF
    
    # Add backup sizes and status
    for category in database config roms saves uploads logs; do
        local latest_file="${BACKUP_BASE_DIR}/${category}/"*"_latest"*
        if ls $latest_file 1> /dev/null 2>&1; then
            local size=$(du -h $latest_file 2>/dev/null | cut -f1 | head -1)
            echo "✅ $category: $size" >> "$report_file"
        else
            echo "❌ $category: No backup found" >> "$report_file"
        fi
    done
    
    cat >> "$report_file" << EOF

Disk Usage:
$(df -h "${BACKUP_BASE_DIR}")

Total Backup Size:
$(du -sh "${BACKUP_BASE_DIR}")

Retention Policy:
- Daily backups: ${RETENTION_DAYS} days
- Weekly backups: ${WEEKLY_RETENTION} weeks
- Monthly backups: ${MONTHLY_RETENTION} months

Next Scheduled Backup:
$(crontab -l | grep backup-system.sh || echo "Not scheduled")
EOF
    
    # Display report
    cat "$report_file"
    
    # Send notification
    send_notification "Backup Completed" "$(cat "$report_file")" "info"
}

# Restore function
restore_backup() {
    local backup_type="${1:-latest}"
    local component="${2:-all}"
    
    warn "Starting restore process for $component from $backup_type backup"
    
    read -p "Are you sure you want to restore? This will overwrite current data. (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Restore cancelled"
        return 0
    fi
    
    case "$component" in
        "database"|"db")
            restore_database "$backup_type"
            ;;
        "config")
            restore_config "$backup_type"
            ;;
        "saves")
            restore_saves "$backup_type"
            ;;
        "all")
            restore_database "$backup_type"
            restore_config "$backup_type"
            restore_saves "$backup_type"
            ;;
        *)
            error "Unknown component: $component"
            ;;
    esac
}

# Restore database
restore_database() {
    local backup_type="$1"
    local backup_file="${BACKUP_BASE_DIR}/database/postgres_${backup_type}.sql.gz"
    
    if [[ ! -f "$backup_file" ]]; then
        backup_file="${BACKUP_BASE_DIR}/database/postgres_latest.sql.gz"
    fi
    
    if [[ ! -f "$backup_file" ]]; then
        error "Database backup file not found"
    fi
    
    log "Restoring database from $backup_file"
    
    # Stop application containers
    docker-compose -f "$COMPOSE_FILE" stop backend frontend
    
    # Restore database
    gunzip -c "$backup_file" | docker-compose -f "$COMPOSE_FILE" exec -T postgres psql -U retrogame
    
    # Restart containers
    docker-compose -f "$COMPOSE_FILE" start backend frontend
    
    log "Database restore completed"
}

# Main backup function
main() {
    local operation="${1:-backup}"
    
    case "$operation" in
        "backup"|"")
            log "Starting RetroGame backup process..."
            create_backup_dirs
            check_docker_status
            
            # Perform backups
            backup_database
            backup_redis
            backup_configs
            backup_saves
            backup_uploads
            backup_roms
            backup_logs
            
            # Create incremental backups
            create_incremental_backup "daily"
            
            # Weekly backup (Sundays)
            if [[ "$(date +%u)" == "7" ]]; then
                create_incremental_backup "weekly"
            fi
            
            # Monthly backup (1st of month)
            if [[ "$(date +%d)" == "01" ]]; then
                create_incremental_backup "monthly"
            fi
            
            verify_backups
            cleanup_backups
            generate_report
            
            log "Backup process completed successfully"
            ;;
        "restore")
            restore_backup "$2" "$3"
            ;;
        "verify")
            verify_backups
            ;;
        "cleanup")
            cleanup_backups
            ;;
        "report")
            generate_report
            ;;
        *)
            echo "Usage: $0 {backup|restore|verify|cleanup|report}"
            echo "  backup          - Perform full backup"
            echo "  restore [type] [component] - Restore from backup"
            echo "  verify          - Verify backup integrity"
            echo "  cleanup         - Clean up old backups"
            echo "  report          - Generate backup report"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"