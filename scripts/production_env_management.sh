# ==============================================================================
# PRODUCTION ENVIRONMENT VARIABLES TEMPLATE
# Secure configuration for RetroGame Server
# ==============================================================================

# ===========================================
# CRITICAL SECURITY WARNING
# ===========================================
# 1. NEVER commit this file with real values to version control
# 2. Use strong, unique passwords and secrets
# 3. Rotate secrets regularly
# 4. Consider using external secret management (HashiCorp Vault, AWS Secrets Manager)
# 5. Set proper file permissions: chmod 600 .env.production

# ===========================================
# SERVER CONFIGURATION
# ===========================================
NODE_ENV=production
PORT=8080
HOST=0.0.0.0

# Domain configuration
DOMAIN=your-domain.com
ADMIN_EMAIL=admin@your-domain.com

# ===========================================
# DATABASE CONFIGURATION
# ===========================================
# PostgreSQL Database
DATABASE_URL=postgresql://retrogame:CHANGE_THIS_DB_PASSWORD@postgres:5432/retrogame
DB_PASSWORD=CHANGE_THIS_DB_PASSWORD

# Database pool settings
DB_POOL_MIN=5
DB_POOL_MAX=20
DB_POOL_IDLE_TIMEOUT=10000
DB_POOL_CONNECTION_TIMEOUT=5000

# ===========================================
# REDIS CONFIGURATION
# ===========================================
REDIS_URL=redis://:CHANGE_THIS_REDIS_PASSWORD@redis:6379
REDIS_PASSWORD=CHANGE_THIS_REDIS_PASSWORD
REDIS_DB=0

# Redis pool settings
REDIS_POOL_MIN=5
REDIS_POOL_MAX=20

# ===========================================
# SECURITY CONFIGURATION
# ===========================================
# JWT Secret (Generate with: openssl rand -base64 32)
JWT_SECRET=CHANGE_THIS_JWT_SECRET_TO_A_LONG_RANDOM_STRING

# Session secret
SESSION_SECRET=CHANGE_THIS_SESSION_SECRET

# Encryption key for sensitive data (Generate with: openssl rand -base64 32)
ENCRYPTION_KEY=CHANGE_THIS_ENCRYPTION_KEY

# API rate limiting
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=15
RATE_LIMIT_SKIP_SUCCESSFUL=true

# Upload rate limiting
UPLOAD_RATE_LIMIT_MAX=10
UPLOAD_RATE_LIMIT_WINDOW=300

# ===========================================
# STORAGE CONFIGURATION
# ===========================================
# Storage paths (bind mounted)
UPLOAD_DIR=/opt/retrogame/uploads
ROM_DIR=/opt/retrogame/roms
MEDIA_DIR=/opt/retrogame/media
BIOS_DIR=/opt/retrogame/bios
TEMP_DIR=/opt/retrogame/temp
SAVES_DIR=/opt/retrogame/saves

# Upload limits
MAX_FILE_SIZE=4294967296
CHUNK_SIZE=1048576
UPLOAD_TIMEOUT=3600
MAX_CONCURRENT_UPLOADS=5

# File processing
ENABLE_VIRUS_SCAN=true
ENABLE_FILE_COMPRESSION=true
ENABLE_DUPLICATE_DETECTION=true

# ===========================================
# MONITORING AND OBSERVABILITY
# ===========================================
# Logging
LOG_LEVEL=info
LOG_FORMAT=json
ENABLE_ACCESS_LOG=true
ENABLE_ERROR_LOG=true

# Metrics
ENABLE_METRICS=true
METRICS_PORT=9464
METRICS_PATH=/metrics

# Health checks
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_INTERVAL=30000

# ===========================================
# NOTIFICATION CONFIGURATION
# ===========================================
# Slack notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

# Email notifications (SMTP)
SMTP_HOST=smtp.your-domain.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=notifications@your-domain.com
SMTP_PASS=CHANGE_THIS_SMTP_PASSWORD

# Webhook notifications
WEBHOOK_URL=https://your-monitoring-service.com/webhook

# ===========================================
# EXTERNAL API KEYS
# ===========================================
# Metadata scraping services
IGDB_CLIENT_ID=your_igdb_client_id
IGDB_CLIENT_SECRET=your_igdb_client_secret
THEGAMESDB_API_KEY=your_thegamesdb_api_key
SCREENSCRAPER_USERNAME=your_screenscraper_username
SCREENSCRAPER_PASSWORD=your_screenscraper_password

# ===========================================
# MONITORING SERVICES
# ===========================================
# Grafana
GRAFANA_PASSWORD=CHANGE_THIS_GRAFANA_PASSWORD
GRAFANA_PASSWORD_HASH=$2a$12$CHANGE_THIS_TO_BCRYPT_HASH

# Prometheus
PROMETHEUS_RETENTION_TIME=30d
PROMETHEUS_RETENTION_SIZE=10GB

# ElasticSearch
KIBANA_ENCRYPTION_KEY=CHANGE_THIS_KIBANA_ENCRYPTION_KEY

# ===========================================
# EMULATOR CONFIGURATION
# ===========================================
VNC_PASSWORD=CHANGE_THIS_VNC_PASSWORD
EMULATOR_TIMEOUT=3600
MAX_EMULATOR_SESSIONS=10

# ===========================================
# BACKUP CONFIGURATION
# ===========================================
BACKUP_DIR=/opt/backups
BACKUP_RETENTION_DAYS=30
BACKUP_SCHEDULE="0 2 * * *"
ENABLE_BACKUP_COMPRESSION=true
ENABLE_BACKUP_ENCRYPTION=true
BACKUP_ENCRYPTION_KEY=CHANGE_THIS_BACKUP_ENCRYPTION_KEY

# Cloud backup (optional)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BACKUP_BUCKET=your-backup-bucket

# ===========================================
# PERFORMANCE TUNING
# ===========================================
# Node.js memory limits
NODE_OPTIONS="--max-old-space-size=2048 --max-semi-space-size=64"

# Worker processes
WORKER_PROCESSES=auto
CLUSTER_MODE=false

# Cache settings
CACHE_TTL=3600
STATIC_CACHE_TTL=86400

# ===========================================
# FEATURE FLAGS
# ===========================================
ENABLE_WEBSOCKETS=true
ENABLE_FILE_SHARING=true
ENABLE_USER_REGISTRATION=false
ENABLE_GUEST_ACCESS=true
ENABLE_API_DOCUMENTATION=false
ENABLE_DEBUG_MODE=false

# ===========================================
# SSL/TLS CONFIGURATION
# ===========================================
# SSL certificates (Let's Encrypt auto-managed by Caddy)
SSL_CERT_PATH=/data/caddy/certificates
ENABLE_HSTS=true
ENABLE_HTTP2=true
ENABLE_HTTP3=true

# ===========================================
# MAINTENANCE
# ===========================================
MAINTENANCE_MODE=false
MAINTENANCE_MESSAGE="System maintenance in progress. Please try again later."

---

# ==============================================================================
# SECRETS MANAGEMENT SCRIPT
# Secure handling of environment variables and secrets
# ==============================================================================

#!/bin/bash
# secrets-manager.sh

set -euo pipefail

SECRETS_DIR="/opt/retrogame/secrets"
ENV_FILE="/opt/retrogame/.env.production"
VAULT_FILE="/opt/retrogame/vault.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Generate secure random password
generate_password() {
    local length="${1:-32}"
    openssl rand -base64 "$length" | tr -d "=+/" | cut -c1-"$length"
}

# Generate JWT secret
generate_jwt_secret() {
    openssl rand -base64 64 | tr -d "\n"
}

# Generate encryption key
generate_encryption_key() {
    openssl rand -base64 32 | tr -d "\n"
}

# Create bcrypt hash
create_bcrypt_hash() {
    local password="$1"
    python3 -c "import bcrypt; print(bcrypt.hashpw('$password'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8'))"
}

# Initialize secrets
init_secrets() {
    log "Initializing secrets..."
    
    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"
    
    # Generate all required secrets
    local db_password=$(generate_password 24)
    local redis_password=$(generate_password 24)
    local jwt_secret=$(generate_jwt_secret)
    local session_secret=$(generate_password 32)
    local encryption_key=$(generate_encryption_key)
    local grafana_password=$(generate_password 16)
    local vnc_password=$(generate_password 12)
    local kibana_key=$(generate_encryption_key)
    local backup_key=$(generate_encryption_key)
    
    # Create bcrypt hash for Grafana
    local grafana_hash=$(create_bcrypt_hash "$grafana_password")
    
    # Store secrets in vault
    cat > "$VAULT_FILE" << EOF
{
  "db_password": "$db_password",
  "redis_password": "$redis_password",
  "jwt_secret": "$jwt_secret",
  "session_secret": "$session_secret",
  "encryption_key": "$encryption_key",
  "grafana_password": "$grafana_password",
  "grafana_password_hash": "$grafana_hash",
  "vnc_password": "$vnc_password",
  "kibana_encryption_key": "$kibana_key",
  "backup_encryption_key": "$backup_key",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "1.0"
}
EOF
    
    chmod 600 "$VAULT_FILE"
    
    log "Secrets generated and stored in vault"
    
    # Display passwords for manual setup
    echo ""
    warn "IMPORTANT: Store these passwords securely!"
    echo "Database Password: $db_password"
    echo "Redis Password: $redis_password"
    echo "Grafana Password: $grafana_password"
    echo "VNC Password: $vnc_password"
    echo ""
}

# Generate environment file from template
generate_env_file() {
    log "Generating environment file..."
    
    if [[ ! -f "$VAULT_FILE" ]]; then
        error "Vault file not found. Run 'init' first."
    fi
    
    # Read secrets from vault
    local db_password=$(jq -r '.db_password' "$VAULT_FILE")
    local redis_password=$(jq -r '.redis_password' "$VAULT_FILE")
    local jwt_secret=$(jq -r '.jwt_secret' "$VAULT_FILE")
    local session_secret=$(jq -r '.session_secret' "$VAULT_FILE")
    local encryption_key=$(jq -r '.encryption_key' "$VAULT_FILE")
    local grafana_password=$(jq -r '.grafana_password' "$VAULT_FILE")
    local grafana_hash=$(jq -r '.grafana_password_hash' "$VAULT_FILE")
    local vnc_password=$(jq -r '.vnc_password' "$VAULT_FILE")
    local kibana_key=$(jq -r '.kibana_encryption_key' "$VAULT_FILE")
    local backup_key=$(jq -r '.backup_encryption_key' "$VAULT_FILE")
    
    # Create environment file from template
    cat > "$ENV_FILE" << EOF
# ==============================================================================
# PRODUCTION ENVIRONMENT - AUTO-GENERATED
# Generated on: $(date)
# ==============================================================================

NODE_ENV=production
PORT=8080
HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://retrogame:${db_password}@postgres:5432/retrogame
DB_PASSWORD=${db_password}

# Redis
REDIS_URL=redis://:${redis_password}@redis:6379
REDIS_PASSWORD=${redis_password}

# Security
JWT_SECRET=${jwt_secret}
SESSION_SECRET=${session_secret}
ENCRYPTION_KEY=${encryption_key}

# Monitoring
GRAFANA_PASSWORD=${grafana_password}
GRAFANA_PASSWORD_HASH=${grafana_hash}
KIBANA_ENCRYPTION_KEY=${kibana_key}

# Emulator
VNC_PASSWORD=${vnc_password}

# Backup
BACKUP_ENCRYPTION_KEY=${backup_key}

# Storage
UPLOAD_DIR=/opt/retrogame/uploads
ROM_DIR=/opt/retrogame/roms
MEDIA_DIR=/opt/retrogame/media
BIOS_DIR=/opt/retrogame/bios
TEMP_DIR=/opt/retrogame/temp
SAVES_DIR=/opt/retrogame/saves

# Upload limits
MAX_FILE_SIZE=4294967296
CHUNK_SIZE=1048576
UPLOAD_TIMEOUT=3600

# Security
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=15

# Features
ENABLE_VIRUS_SCAN=true
ENABLE_METRICS=true
ENABLE_WEBSOCKETS=true

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Domain (CHANGE THIS)
DOMAIN=localhost
ADMIN_EMAIL=admin@localhost

# External services (ADD YOUR KEYS)
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
THEGAMESDB_API_KEY=
SLACK_WEBHOOK_URL=
EOF

    chmod 600 "$ENV_FILE"
    
    log "Environment file generated: $ENV_FILE"
    warn "Remember to update DOMAIN, ADMIN_EMAIL, and external service keys!"
}

# Rotate secrets
rotate_secrets() {
    local secret_type="$1"
    
    log "Rotating $secret_type secret..."
    
    case "$secret_type" in
        "jwt")
            local new_secret=$(generate_jwt_secret)
            jq --arg secret "$new_secret" '.jwt_secret = $secret | .updated_at = now | .version = (.version | tonumber + 0.1 | tostring)' "$VAULT_FILE" > "${VAULT_FILE}.tmp"
            mv "${VAULT_FILE}.tmp" "$VAULT_FILE"
            log "JWT secret rotated"
            ;;
        "encryption")
            local new_key=$(generate_encryption_key)
            jq --arg key "$new_key" '.encryption_key = $key | .updated_at = now | .version = (.version | tonumber + 0.1 | tostring)' "$VAULT_FILE" > "${VAULT_FILE}.tmp"
            mv "${VAULT_FILE}.tmp" "$VAULT_FILE"
            log "Encryption key rotated"
            ;;
        "passwords")
            local db_password=$(generate_password 24)
            local redis_password=$(generate_password 24)
            local grafana_password=$(generate_password 16)
            local grafana_hash=$(create_bcrypt_hash "$grafana_password")
            
            jq --arg db "$db_password" \
               --arg redis "$redis_password" \
               --arg grafana "$grafana_password" \
               --arg hash "$grafana_hash" \
               '.db_password = $db | .redis_password = $redis | .grafana_password = $grafana | .grafana_password_hash = $hash | .updated_at = now | .version = (.version | tonumber + 0.1 | tostring)' \
               "$VAULT_FILE" > "${VAULT_FILE}.tmp"
            mv "${VAULT_FILE}.tmp" "$VAULT_FILE"
            
            warn "Passwords rotated. Update services manually:"
            echo "New DB Password: $db_password"
            echo "New Redis Password: $redis_password"
            echo "New Grafana Password: $grafana_password"
            ;;
        *)
            error "Unknown secret type: $secret_type"
            ;;
    esac
    
    # Regenerate environment file
    generate_env_file
}

# Backup secrets
backup_secrets() {
    local backup_file="/opt/backups/secrets-backup-$(date +%Y%m%d_%H%M%S).tar.gz.enc"
    
    log "Creating encrypted secrets backup..."
    
    # Create temporary directory
    local temp_dir=$(mktemp -d)
    
    # Copy secrets
    cp "$VAULT_FILE" "$temp_dir/"
    cp "$ENV_FILE" "$temp_dir/"
    
    # Create encrypted backup
    tar -czf - -C "$temp_dir" . | \
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 -out "$backup_file"
    
    rm -rf "$temp_dir"
    chmod 600 "$backup_file"
    
    log "Secrets backup created: $backup_file"
    warn "Store the encryption password securely!"
}

# Verify secrets
verify_secrets() {
    log "Verifying secrets..."
    
    if [[ ! -f "$VAULT_FILE" ]]; then
        error "Vault file not found"
    fi
    
    if [[ ! -f "$ENV_FILE" ]]; then
        error "Environment file not found"
    fi
    
    # Check file permissions
    local vault_perms=$(stat -c "%a" "$VAULT_FILE")
    local env_perms=$(stat -c "%a" "$ENV_FILE")
    
    if [[ "$vault_perms" != "600" ]]; then
        warn "Vault file permissions are $vault_perms, should be 600"
    fi
    
    if [[ "$env_perms" != "600" ]]; then
        warn "Environment file permissions are $env_perms, should be 600"
    fi
    
    # Verify JSON structure
    if ! jq empty "$VAULT_FILE" 2>/dev/null; then
        error "Vault file is not valid JSON"
    fi
    
    # Check for empty secrets
    local empty_secrets=$(jq -r 'to_entries[] | select(.value == "") | .key' "$VAULT_FILE")
    if [[ -n "$empty_secrets" ]]; then
        warn "Empty secrets found: $empty_secrets"
    fi
    
    log "Secrets verification completed"
}

# Main function
main() {
    local command="${1:-help}"
    
    case "$command" in
        "init")
            init_secrets
            generate_env_file
            ;;
        "generate")
            generate_env_file
            ;;
        "rotate")
            rotate_secrets "${2:-all}"
            ;;
        "backup")
            backup_secrets
            ;;
        "verify")
            verify_secrets
            ;;
        "help"|*)
            echo "Usage: $0 {init|generate|rotate|backup|verify}"
            echo ""
            echo "  init     - Initialize secrets and generate environment file"
            echo "  generate - Generate environment file from existing secrets"
            echo "  rotate   - Rotate secrets (jwt|encryption|passwords)"
            echo "  backup   - Create encrypted backup of secrets"
            echo "  verify   - Verify secrets integrity"
            exit 1
            ;;
    esac
}

main "$@"