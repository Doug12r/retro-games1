# ==============================================================================
# PERFORMANCE OPTIMIZATION CONFIGURATIONS
# Production-ready performance tuning for RetroGame Server
# ==============================================================================

# postgresql/postgresql.conf
# PostgreSQL Performance Configuration
# Place in: ./postgres/postgresql.conf

# Connection settings
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

# Checkpoint settings
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100

# Query planner
random_page_cost = 1.1
effective_io_concurrency = 200

# Logging
log_min_duration_statement = 1000
log_statement = 'ddl'
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d '

# Auto-vacuum settings
autovacuum = on
autovacuum_vacuum_scale_factor = 0.1
autovacuum_analyze_scale_factor = 0.05

---

# redis/redis.conf
# Redis Performance Configuration
# Place in: ./redis/redis.conf

# Memory management
maxmemory 512mb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# Network settings
tcp-keepalive 60
tcp-backlog 128
timeout 300

# Save settings (persistence)
save 900 1
save 300 10
save 60 10000

# AOF configuration
appendonly yes
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Performance optimizations
latency-monitor-threshold 100
slowlog-log-slower-than 10000
slowlog-max-len 128

# Client management
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60

---

#!/bin/bash
# performance-tuner.sh
# System performance optimization script

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root"
    fi
}

# Optimize system kernel parameters
optimize_kernel() {
    log "Optimizing kernel parameters..."
    
    cat > /etc/sysctl.d/99-retrogame-performance.conf << 'EOF'
# RetroGame Server Performance Optimizations

# Network performance
net.core.rmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_default = 262144
net.core.wmem_max = 16777216
net.core.netdev_max_backlog = 5000
net.core.somaxconn = 1024
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 120
net.ipv4.tcp_keepalive_probes = 9
net.ipv4.tcp_keepalive_intvl = 75
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_max_tw_buckets = 400000

# Memory management
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.vfs_cache_pressure = 50
vm.min_free_kbytes = 65536

# File system
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 256

# Process limits
kernel.pid_max = 4194304
kernel.threads-max = 4194304
EOF

    sysctl -p /etc/sysctl.d/99-retrogame-performance.conf
    log "Kernel parameters optimized"
}

# Configure system limits
configure_limits() {
    log "Configuring system limits..."
    
    cat > /etc/security/limits.d/99-retrogame.conf << 'EOF'
# RetroGame Server System Limits
*               soft    nofile          65536
*               hard    nofile          65536
*               soft    nproc           32768
*               hard    nproc           32768
root            soft    nofile          65536
root            hard    nofile          65536
EOF

    # Configure systemd limits
    mkdir -p /etc/systemd/system.conf.d
    cat > /etc/systemd/system.conf.d/limits.conf << 'EOF'
[Manager]
DefaultLimitNOFILE=65536
DefaultLimitNPROC=32768
EOF

    # Configure Docker daemon limits
    mkdir -p /etc/systemd/system/docker.service.d
    cat > /etc/systemd/system/docker.service.d/limits.conf << 'EOF'
[Service]
LimitNOFILE=65536
LimitNPROC=32768
LimitCORE=infinity
EOF

    systemctl daemon-reload
    log "System limits configured"
}

# Optimize I/O scheduler
optimize_io() {
    log "Optimizing I/O scheduler..."
    
    # Set I/O scheduler based on storage type
    for device in $(lsblk -dn -o NAME | grep -E '^(sd|nvme)'); do
        if [[ -e "/sys/block/$device/queue/rotational" ]]; then
            if [[ $(cat "/sys/block/$device/queue/rotational") == "0" ]]; then
                # SSD - use deadline or noop
                echo deadline > "/sys/block/$device/queue/scheduler" 2>/dev/null || \
                echo noop > "/sys/block/$device/queue/scheduler" 2>/dev/null || true
                info "Set deadline/noop scheduler for SSD: $device"
            else
                # HDD - use cfq
                echo cfq > "/sys/block/$device/queue/scheduler" 2>/dev/null || true
                info "Set cfq scheduler for HDD: $device"
            fi
        fi
    done
    
    # Create udev rule for persistent I/O scheduler
    cat > /etc/udev/rules.d/60-io-scheduler.rules << 'EOF'
# Set I/O scheduler based on device type
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="0", ATTR{queue/scheduler}="deadline"
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="1", ATTR{queue/scheduler}="cfq"
ACTION=="add|change", KERNEL=="nvme[0-9]n[0-9]", ATTR{queue/scheduler}="deadline"
EOF

    log "I/O scheduler optimized"
}

# Configure Docker performance
optimize_docker() {
    log "Optimizing Docker configuration..."
    
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "storage-opts": [
    "overlay2.override_kernel_check=true"
  ],
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    },
    "nproc": {
      "Name": "nproc",
      "Hard": 32768,
      "Soft": 32768
    }
  },
  "max-concurrent-downloads": 10,
  "max-concurrent-uploads": 5,
  "dns": ["8.8.8.8", "8.8.4.4"],
  "dns-opts": ["timeout:1", "attempts:3"],
  "userland-proxy": false,
  "experimental": false,
  "metrics-addr": "127.0.0.1:9323",
  "experimental": true,
  "features": {
    "buildkit": true
  }
}
EOF

    systemctl restart docker
    log "Docker configuration optimized"
}

# Optimize application containers
optimize_containers() {
    log "Optimizing container configurations..."
    
    local compose_file="/opt/retrogame/docker-compose.yml"
    local performance_override="/opt/retrogame/docker-compose.performance.yml"
    
    cat > "$performance_override" << 'EOF'
version: '3.8'

services:
  backend:
    environment:
      - NODE_OPTIONS=--max-old-space-size=1536 --max-semi-space-size=64 --optimize-for-size
      - UV_THREADPOOL_SIZE=16
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
        reservations:
          memory: 1G
          cpus: '0.5'
    healthcheck:
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s

  frontend:
    environment:
      - NODE_OPTIONS=--max-old-space-size=512
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 256M
          cpus: '0.25'

  postgres:
    command: >
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=1GB
      -c work_mem=4MB
      -c maintenance_work_mem=64MB
      -c checkpoint_completion_target=0.9
      -c wal_buffers=16MB
      -c default_statistics_target=100
      -c random_page_cost=1.1
      -c effective_io_concurrency=200
      -c max_connections=100
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'

  redis:
    command: >
      redis-server
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --tcp-keepalive 60
      --tcp-backlog 128
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes
      --appendfsync everysec
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.25'
        reservations:
          memory: 256M
          cpus: '0.1'

  caddy:
    environment:
      - CADDY_ADMIN=off
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.25'
        reservations:
          memory: 128M
          cpus: '0.1'

  prometheus:
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=15d'
      - '--storage.tsdb.retention.size=10GB'
      - '--web.enable-lifecycle'
      - '--web.enable-admin-api'
      - '--storage.tsdb.wal-compression'
      - '--query.max-concurrency=20'
      - '--query.max-samples=50000000'
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'

  grafana:
    environment:
      - GF_RENDERING_SERVER_URL=http://renderer:8081/render
      - GF_RENDERING_CALLBACK_URL=http://grafana:3000/
      - GF_LOG_FILTERS=rendering:debug
      - GF_DATABASE_WAL=true
      - GF_DATABASE_CACHE_MODE=shared
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 256M
          cpus: '0.25'
EOF

    log "Container optimizations configured"
}

# Monitor system performance
monitor_performance() {
    log "Setting up performance monitoring..."
    
    cat > /usr/local/bin/performance-monitor.sh << 'EOF'
#!/bin/bash
# Performance monitoring script

LOG_FILE="/var/log/retrogame-performance.log"
ALERT_THRESHOLD_CPU=80
ALERT_THRESHOLD_MEM=90
ALERT_THRESHOLD_DISK=85

check_performance() {
    local timestamp=$(date)
    
    # CPU usage
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
    
    # Memory usage
    local mem_usage=$(free | awk 'FNR==2{printf "%.0f", ($3/$2)*100}')
    
    # Disk usage
    local disk_usage=$(df / | awk 'NR==2{printf "%.0f", ($3/$2)*100}')
    
    # Docker stats
    local docker_stats=$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | tail -n +2)
    
    # Log performance data
    echo "[$timestamp] CPU: ${cpu_usage}% | Memory: ${mem_usage}% | Disk: ${disk_usage}%" >> "$LOG_FILE"
    
    # Check thresholds
    if (( $(echo "$cpu_usage > $ALERT_THRESHOLD_CPU" | bc -l) )); then
        echo "[$timestamp] ALERT: High CPU usage: ${cpu_usage}%" >> "$LOG_FILE"
    fi
    
    if [[ $mem_usage -gt $ALERT_THRESHOLD_MEM ]]; then
        echo "[$timestamp] ALERT: High memory usage: ${mem_usage}%" >> "$LOG_FILE"
    fi
    
    if [[ $disk_usage -gt $ALERT_THRESHOLD_DISK ]]; then
        echo "[$timestamp] ALERT: High disk usage: ${disk_usage}%" >> "$LOG_FILE"
    fi
}

# Cleanup old logs
cleanup_logs() {
    find /var/log -name "retrogame-performance.log*" -mtime +7 -delete
}

check_performance
cleanup_logs
EOF

    chmod +x /usr/local/bin/performance-monitor.sh
    
    # Schedule performance monitoring
    cat > /etc/cron.d/retrogame-performance << 'EOF'
# Performance monitoring every 5 minutes
*/5 * * * * root /usr/local/bin/performance-monitor.sh
EOF

    log "Performance monitoring configured"
}

# Optimize file system
optimize_filesystem() {
    log "Optimizing file system..."
    
    # Mount options optimization
    cat > /etc/fstab.performance << 'EOF'
# Performance optimized mount options
# Add these options to your existing /etc/fstab entries:
# 
# For SSD (ext4): noatime,discard,errors=remount-ro
# For HDD (ext4): noatime,errors=remount-ro
# 
# Example:
# UUID=xxx / ext4 defaults,noatime,discard,errors=remount-ro 0 1
EOF

    # Temporary file system optimization
    echo "tmpfs /tmp tmpfs defaults,noatime,mode=1777,size=2G 0 0" >> /etc/fstab.performance
    
    # Set optimal read-ahead for storage devices
    for device in $(lsblk -dn -o NAME | grep -E '^(sd|nvme)'); do
        if [[ -e "/sys/block/$device/queue/rotational" ]]; then
            if [[ $(cat "/sys/block/$device/queue/rotational") == "0" ]]; then
                # SSD - lower read-ahead
                echo 256 > "/sys/block/$device/queue/read_ahead_kb"
            else
                # HDD - higher read-ahead
                echo 2048 > "/sys/block/$device/queue/read_ahead_kb"
            fi
        fi
    done
    
    log "File system optimizations applied"
}

# Generate performance tuning report
generate_report() {
    log "Generating performance tuning report..."
    
    local report_file="/tmp/performance-tuning-report-$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$report_file" << EOF
RetroGame Server Performance Tuning Report
==========================================
Date: $(date)
Server: $(hostname)

System Information:
$(uname -a)

CPU Information:
$(lscpu | grep -E "(Model name|CPU\(s\)|Thread|Core)")

Memory Information:
$(free -h)

Storage Information:
$(lsblk -d | grep -E "(sd|nvme)")

Current Kernel Parameters:
$(sysctl -a 2>/dev/null | grep -E "(net\.|vm\.|fs\.)" | head -20)

Docker Information:
$(docker system df)

Container Resource Usage:
$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}")

Current Performance Metrics:
CPU Usage: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
Memory Usage: $(free | awk 'FNR==2{printf "%.1f%%", ($3/$2)*100}')
Disk Usage: $(df -h / | awk 'NR==2{print $5}')

Optimizations Applied:
✅ Kernel parameters optimized
✅ System limits configured
✅ I/O scheduler optimized
✅ Docker configuration optimized
✅ Container resources configured
✅ Performance monitoring enabled
✅ File system optimizations applied

Recommendations:
1. Monitor system performance regularly
2. Adjust container resource limits based on usage
3. Consider upgrading to SSD storage for better I/O performance
4. Enable swap if memory usage is consistently high
5. Use a CDN for static assets to reduce server load
6. Implement database connection pooling
7. Enable gzip compression for API responses
8. Use Redis clustering for high availability
9. Implement horizontal scaling for high traffic
10. Regular maintenance: vacuum database, rotate logs, clean up old containers

EOF

    cat "$report_file"
    
    log "Performance tuning report saved to: $report_file"
}

# Main function
main() {
    local operation="${1:-all}"
    
    case "$operation" in
        "kernel")
            check_root
            optimize_kernel
            ;;
        "limits")
            check_root
            configure_limits
            ;;
        "io")
            check_root
            optimize_io
            ;;
        "docker")
            check_root
            optimize_docker
            ;;
        "containers")
            optimize_containers
            ;;
        "filesystem")
            check_root
            optimize_filesystem
            ;;
        "monitor")
            check_root
            monitor_performance
            ;;
        "all")
            check_root
            optimize_kernel
            configure_limits
            optimize_io
            optimize_docker
            optimize_containers
            optimize_filesystem
            monitor_performance
            generate_report
            
            log "Performance optimization completed!"
            warn "Please reboot the system to ensure all changes take effect"
            ;;
        "report")
            generate_report
            ;;
        *)
            echo "Usage: $0 {kernel|limits|io|docker|containers|filesystem|monitor|all|report}"
            echo ""
            echo "  kernel      - Optimize kernel parameters"
            echo "  limits      - Configure system limits"
            echo "  io          - Optimize I/O scheduler"
            echo "  docker      - Optimize Docker configuration"
            echo "  containers  - Optimize container configurations"
            echo "  filesystem  - Optimize file system"
            echo "  monitor     - Setup performance monitoring"
            echo "  all         - Apply all optimizations"
            echo "  report      - Generate performance report"
            exit 1
            ;;
    esac
}

main "$@"