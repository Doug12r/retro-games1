# ===========================================
# RETRO GAME BACKEND - ENVIRONMENT VARIABLES
# ===========================================
# Copy this file to .env and update with your actual values

# ===========================================
# SERVER CONFIGURATION
# ===========================================
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

# ===========================================
# DATABASE CONFIGURATION
# ===========================================
# PostgreSQL connection string
# Format: postgresql://username:password@host:port/database
DATABASE_URL=postgresql://retrogame:retrogame123@localhost:5432/retrogame

# Docker PostgreSQL settings
POSTGRES_PASSWORD=retrogame123
POSTGRES_PORT=5432

# ===========================================
# REDIS CONFIGURATION
# ===========================================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis123
REDIS_DB=0

# ===========================================
# STORAGE CONFIGURATION
# ===========================================
# Directory paths for file storage
UPLOAD_DIR=./uploads
ROM_DIR=./roms
MEDIA_DIR=./media
BIOS_DIR=./bios
TEMP_DIR=./temp

# ===========================================
# UPLOAD CONFIGURATION
# ===========================================
# Maximum file size in bytes (4GB default)
MAX_FILE_SIZE=4294967296

# Chunk size for upload in bytes (1MB default)
CHUNK_SIZE=1048576

# Upload timeout in seconds (1 hour default)
UPLOAD_TIMEOUT=3600

# ===========================================
# FRONTEND CONFIGURATION
# ===========================================
FRONTEND_URL=http://localhost:3000

# ===========================================
# API KEYS FOR METADATA SCRAPING
# ===========================================

# IGDB (Internet Game Database) - https://api.igdb.com/
# Register at: https://dev.twitch.tv/console/apps
IGDB_CLIENT_ID=your_igdb_client_id
IGDB_CLIENT_SECRET=your_igdb_client_secret

# TheGamesDB - https://thegamesdb.net/
# Get API key at: https://forums.thegamesdb.net/
THEGAMESDB_API_KEY=your_thegamesdb_api_key

# ScreenScraper - https://www.screenscraper.fr/
# Register at: https://www.screenscraper.fr/
SCREENSCRAPER_USERNAME=your_screenscraper_username
SCREENSCRAPER_PASSWORD=your_screenscraper_password

# ===========================================
# SECURITY CONFIGURATION
# ===========================================
# JWT secret for authentication (change in production!)
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Rate limiting
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=15

# ===========================================
# PROCESSING CONFIGURATION
# ===========================================
# Enable virus scanning (requires ClamAV)
ENABLE_VIRUS_SCAN=false

# ClamAV configuration (if virus scanning enabled)
CLAMAV_HOST=localhost
CLAMAV_PORT=3310

# ===========================================
# LOGGING CONFIGURATION
# ===========================================
# Log level: fatal, error, warn, info, debug, trace
LOG_LEVEL=info

# ===========================================
# DOCKER COMPOSE CONFIGURATION
# ===========================================
# Ports for services
BACKEND_PORT=3001
NGINX_PORT=80
NGINX_SSL_PORT=443

# Admin interfaces
PGADMIN_PORT=5050
PGADMIN_EMAIL=admin@retrogame.local
PGADMIN_PASSWORD=admin123

REDIS_COMMANDER_PORT=8081
REDIS_COMMANDER_USER=admin
REDIS_COMMANDER_PASSWORD=admin123

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000
GRAFANA_PASSWORD=admin123

# ===========================================
# DEVELOPMENT CONFIGURATION
# ===========================================
# Database seeding
SEED_SAMPLE_DATA=true
SEED_PLATFORMS=true

# Development features
ENABLE_API_DOCS=true
ENABLE_CORS=true

# ===========================================
# PRODUCTION CONFIGURATION
# ===========================================
# SSL/TLS
SSL_CERT_PATH=/path/to/certificate.crt
SSL_KEY_PATH=/path/to/private.key

# Email notifications (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=notifications@yourdomain.com
SMTP_PASS=your_email_password

# Webhook notifications (optional)
WEBHOOK_URL=https://your-webhook-url.com/notifications

# Cloud storage (optional)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-retro-game-bucket

# ===========================================
# MONITORING & ANALYTICS
# ===========================================
# Application monitoring
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project

# Analytics
GOOGLE_ANALYTICS_ID=GA-XXXXXXXXX

# Performance monitoring
NEW_RELIC_LICENSE_KEY=your_new_relic_license_key

# ===========================================
# BACKUP CONFIGURATION
# ===========================================
# Backup settings
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
BACKUP_S3_BUCKET=your-backup-bucket

# ===========================================
# FEATURE FLAGS
# ===========================================
# Enable/disable features
ENABLE_WEBSOCKETS=true
ENABLE_FILE_COMPRESSION=true
ENABLE_DUPLICATE_DETECTION=true
ENABLE_AUTOMATIC_METADATA_SCRAPING=true
ENABLE_BIOS_VALIDATION=true

# ===========================================
# PERFORMANCE TUNING
# ===========================================
# Database connection pool
DB_POOL_MIN=2
DB_POOL_MAX=10

# Redis connection pool
REDIS_POOL_MIN=2
REDIS_POOL_MAX=10

# Worker processes
WORKER_PROCESSES=auto

# Memory limits
MAX_MEMORY_USAGE=2048

# ===========================================
# DEVELOPMENT SECRETS
# ===========================================
# These should be changed in production!
DEV_ADMIN_USERNAME=admin
DEV_ADMIN_PASSWORD=admin123
DEV_API_KEY=dev-api-key-123

# ===========================================
# NOTES
# ===========================================
# 1. Never commit the actual .env file to version control
# 2. Use strong, unique passwords in production
# 3. Regularly rotate API keys and secrets
# 4. Keep this file updated with any new environment variables
# 5. Use environment-specific .env files (.env.production, .env.staging)
# 6. Consider using a secrets management service in production