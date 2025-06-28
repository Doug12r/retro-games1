#!/bin/bash

# ==============================================================================
# ENTERPRISE SECURITY HARDENING SCRIPT
# Production-ready security configuration for RetroGame Server
# ==============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
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
        error "This script must be run as root. Use: sudo $0"
    fi
}

# Check if running on supported OS
check_os() {
    if [[ ! -f /etc/lsb-release ]] && [[ ! -f /etc/debian_version ]]; then
        error "This script requires Ubuntu/Debian. Other distributions are not supported."
    fi
    
    info "Operating system check passed"
}

# Update system packages
update_system() {
    log "Updating system packages..."
    
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get upgrade -y -qq
    apt-get autoremove -y -qq
    apt-get autoclean -qq
    
    log "System packages updated successfully"
}

# Install required security packages
install_security_packages() {
    log "Installing security packages..."
    
    local packages=(
        "ufw"
        "fail2ban"
        "apparmor"
        "apparmor-utils"
        "apparmor-profiles"
        "apparmor-profiles-extra"
        "auditd"
        "rkhunter"
        "chkrootkit"
        "clamav"
        "clamav-daemon"
        "aide"
        "logwatch"
        "unattended-upgrades"
        "apt-listchanges"
    )
    
    for package in "${packages[@]}"; do
        if ! dpkg -l | grep -q "^ii  $package "; then
            info "Installing $package..."
            apt-get install -y -qq "$package"
        else
            info "$package is already installed"
        fi
    done
    
    log "Security packages installed successfully"
}

# Configure UFW Firewall
setup_firewall() {
    log "Configuring UFW firewall..."
    
    # Reset UFW to default state
    ufw --force reset
    
    # Set default policies
    ufw default deny incoming
    ufw default allow outgoing
    ufw default deny forward
    
    # Allow loopback
    ufw allow in on lo
    ufw allow out on lo
    
    # Allow SSH (change port if you use custom SSH port)
    SSH_PORT=${SSH_PORT:-22}
    ufw allow in "$SSH_PORT"/tcp comment "SSH"
    
    # Allow HTTP and HTTPS
    ufw allow in 80/tcp comment "HTTP"
    ufw allow in 443/tcp comment "HTTPS"
    ufw allow in 443/udp comment "HTTP/3 QUIC"
    
    # Allow Docker internal network
    ufw allow from 172.20.0.0/16 comment "Docker internal network"
    ufw allow from 172.17.0.0/16 comment "Docker default network"
    
    # Allow monitoring access from internal networks
    ufw allow from 10.0.0.0/8 to any port 9090 comment "Prometheus"
    ufw allow from 172.16.0.0/12 to any port 9090 comment "Prometheus"
    ufw allow from 192.168.0.0/16 to any port 9090 comment "Prometheus"
    
    # Rate limiting for SSH
    ufw limit in "$SSH_PORT"/tcp comment "SSH rate limit"
    
    # Enable UFW
    ufw --force enable
    
    # Configure UFW logging
    ufw logging on
    echo "# UFW logging configuration" > /etc/rsyslog.d/20-ufw.conf
    echo ":msg,contains,\"[UFW\" /var/log/ufw.log" >> /etc/rsyslog.d/20-ufw.conf
    echo "& stop" >> /etc/rsyslog.d/20-ufw.conf
    
    systemctl restart rsyslog
    
    log "UFW firewall configured successfully"
    ufw status verbose
}

# Configure Fail2ban
setup_fail2ban() {
    log "Configuring Fail2ban..."
    
    # Create main jail configuration
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
# Default ban settings
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd
destemail = admin@localhost
sendername = Fail2Ban
mta = sendmail
protocol = tcp
chain = INPUT
port = 0:65535
fail2ban_agent = Fail2Ban/%(fail2ban_version)s

# Ban action
banaction = ufw
banaction_allports = ufw

# Ignore local networks
ignoreip = 127.0.0.1/8 ::1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16

# SSH protection
[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s
maxretry = 3
bantime = 1800

# HTTP rate limiting
[http-get-dos]
enabled = true
filter = http-get-dos
logpath = /var/log/caddy/access.log
maxretry = 300
findtime = 300
bantime = 600
action = ufw

# Failed login attempts
[caddy-auth]
enabled = true
filter = caddy-auth
logpath = /var/log/caddy/access.log
maxretry = 5
findtime = 600
bantime = 3600

# Docker container escape attempts
[docker-escape]
enabled = true
filter = docker-escape
logpath = /var/log/audit/audit.log
maxretry = 1
findtime = 3600
bantime = 86400

# Aggressive scanner detection
[scanner]
enabled = true
filter = scanner
logpath = /var/log/caddy/access.log
maxretry = 10
findtime = 60
bantime = 7200

# WordPress specific (if using WordPress for admin)
[wordpress]
enabled = false
filter = wordpress
logpath = /var/log/caddy/access.log
maxretry = 3
findtime = 600
bantime = 1800
EOF

    # Create custom filters
    mkdir -p /etc/fail2ban/filter.d

    # HTTP GET DOS filter
    cat > /etc/fail2ban/filter.d/http-get-dos.conf << 'EOF'
[Definition]
failregex = ^.*"remote_addr":"<HOST>".*"method":"GET".*$
ignoreregex =
EOF

    # Caddy authentication filter
    cat > /etc/fail2ban/filter.d/caddy-auth.conf << 'EOF'
[Definition]
failregex = ^.*"remote_addr":"<HOST>".*"status":401.*$
            ^.*"remote_addr":"<HOST>".*"status":403.*$
ignoreregex =
EOF

    # Docker escape filter
    cat > /etc/fail2ban/filter.d/docker-escape.conf << 'EOF'
[Definition]
failregex = type=SYSCALL.*syscall=2.*comm="docker".*exit=-13.*
            type=AVC.*comm="docker".*denied.*
ignoreregex =
EOF

    # Scanner detection filter
    cat > /etc/fail2ban/filter.d/scanner.conf << 'EOF'
[Definition]
failregex = ^.*"remote_addr":"<HOST>".*"status":404.*"uri":".*\.(php|asp|jsp|cgi)".*$
            ^.*"remote_addr":"<HOST>".*"uri":".*admin.*".*"status":404.*$
            ^.*"remote_addr":"<HOST>".*"uri":".*wp-.*".*"status":404.*$
            ^.*"remote_addr":"<HOST>".*"uri":".*phpmyadmin.*".*$
ignoreregex =
EOF

    # UFW action configuration
    cat > /etc/fail2ban/action.d/ufw.conf << 'EOF'
[Definition]
actionstart =
actionstop =
actioncheck =
actionban = ufw insert 1 deny from <ip> to any comment "fail2ban-<name>"
actionunban = ufw delete deny from <ip> to any
EOF

    # Enable and start Fail2ban
    systemctl enable fail2ban
    systemctl restart fail2ban
    
    log "Fail2ban configured successfully"
    fail2ban-client status
}

# Configure AppArmor profiles
setup_apparmor() {
    log "Setting up AppArmor profiles..."
    
    # Enable AppArmor
    systemctl enable apparmor
    systemctl start apparmor
    
    # Docker container profile
    cat > /etc/apparmor.d/docker-retrogame << 'EOF'
#include <tunables/global>

profile docker-retrogame flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/nameservice>
  #include <abstractions/openssl>
  #include <abstractions/ssl_certs>
  
  capability chown,
  capability dac_override,
  capability dac_read_search,
  capability fowner,
  capability fsetid,
  capability kill,
  capability mknod,
  capability net_bind_service,
  capability net_raw,
  capability setfcap,
  capability setgid,
  capability setpcap,
  capability setuid,
  capability sys_chroot,
  
  # File system access
  / r,
  /bin/** rix,
  /usr/bin/** rix,
  /usr/sbin/** rix,
  /lib/** r,
  /lib64/** r,
  /usr/lib/** r,
  /usr/share/** r,
  /etc/** r,
  /opt/retrogame/** rw,
  /tmp/** rw,
  /var/tmp/** rw,
  /dev/null rw,
  /dev/zero r,
  /dev/urandom r,
  /dev/random r,
  
  # Proc and sys restrictions
  deny @{PROC}/* w,
  deny /sys/[^f]*/** wklx,
  deny /sys/f[^s]*/** wklx,
  deny /sys/fs/[^c]*/** wklx,
  deny /sys/fs/c[^g]*/** wklx,
  deny /sys/fs/cg[^r]*/** wklx,
  deny /sys/firmware/** rwklx,
  deny /sys/kernel/security/** rwklx,
  
  # Network
  network inet stream,
  network inet dgram,
  network unix stream,
  network unix dgram,
  
  # Docker specific
  mount fstype=tmpfs,
  mount fstype=devpts,
  mount fstype=sysfs,
  mount fstype=proc,
  mount fstype=cgroup,
  umount,
  
  # Signal restrictions
  signal receive set=(term, kill) peer=unconfined,
  signal send set=(term, kill) peer=docker-retrogame,
  
  # Ptrace restrictions
  deny ptrace,
  deny @{PROC}/sys/kernel/core_pattern w,
  deny @{PROC}/sys/vm/panic_on_oom w,
  deny @{PROC}/sys/kernel/panic w,
  deny @{PROC}/sys/kernel/panic_on_oops w,
}
EOF

    # Load the profile
    apparmor_parser -r /etc/apparmor.d/docker-retrogame
    
    # Nginx/Caddy profile
    cat > /etc/apparmor.d/caddy << 'EOF'
#include <tunables/global>

profile caddy /usr/bin/caddy flags=(attach_disconnected) {
  #include <abstractions/base>
  #include <abstractions/nameservice>
  #include <abstractions/openssl>
  #include <abstractions/ssl_certs>
  
  capability net_bind_service,
  capability setgid,
  capability setuid,
  capability dac_override,
  
  # Caddy binary
  /usr/bin/caddy r,
  
  # Configuration files
  /etc/caddy/** r,
  /var/lib/caddy/** rw,
  /var/log/caddy/** rw,
  
  # SSL certificates
  /etc/ssl/certs/** r,
  /etc/ssl/private/** r,
  
  # Network
  network inet stream,
  network inet dgram,
  network inet6 stream,
  network inet6 dgram,
  
  # System files
  /etc/mime.types r,
  /etc/passwd r,
  /etc/group r,
  /etc/nsswitch.conf r,
  /etc/hosts r,
  /etc/resolv.conf r,
  
  # Deny dangerous operations
  deny /bin/** wl,
  deny /boot/** wl,
  deny /dev/** wl,
  deny /etc/passwd w,
  deny /etc/shadow rw,
  deny /etc/gshadow rw,
  deny /etc/group w,
  deny /home/** w,
  deny /root/** w,
  deny /sbin/** wl,
  deny /usr/bin/** w,
  deny /usr/sbin/** w,
  deny @{PROC}/sys/kernel/** w,
  deny /sys/** w,
}
EOF

    apparmor_parser -r /etc/apparmor.d/caddy
    
    log "AppArmor profiles configured successfully"
    aa-status
}

# System hardening
system_hardening() {
    log "Applying system hardening..."
    
    # Disable unnecessary services
    systemctl disable cups 2>/dev/null || true
    systemctl disable avahi-daemon 2>/dev/null || true
    systemctl disable bluetooth 2>/dev/null || true
    
    # Kernel parameters for security
    cat > /etc/sysctl.d/99-security.conf << 'EOF'
# Network security
net.ipv4.conf.default.rp_filter=1
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.all.accept_redirects=0
net.ipv6.conf.all.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.all.accept_source_route=0
net.ipv6.conf.all.accept_source_route=0
net.ipv4.conf.all.log_martians=1
net.ipv4.icmp_echo_ignore_broadcasts=1
net.ipv4.icmp_ignore_bogus_error_responses=1
net.ipv4.tcp_syncookies=1
net.ipv4.tcp_rfc1337=1
net.ipv4.tcp_syn_retries=2
net.ipv4.tcp_synack_retries=2
net.ipv4.tcp_max_syn_backlog=4096

# Memory protection
kernel.dmesg_restrict=1
kernel.kptr_restrict=2
kernel.yama.ptrace_scope=1
kernel.kexec_load_disabled=1
kernel.unprivileged_bpf_disabled=1
net.core.bpf_jit_harden=2

# File system protections
fs.suid_dumpable=0
fs.protected_hardlinks=1
fs.protected_symlinks=1
fs.protected_fifos=2
fs.protected_regular=2

# Address space layout randomization
kernel.randomize_va_space=2

# Core dump restrictions
kernel.core_pattern=|/bin/false
kernel.core_uses_pid=1

# Process restrictions
kernel.ctrl-alt-del=0
kernel.sysrq=0
EOF

    sysctl -p /etc/sysctl.d/99-security.conf
    
    # Configure audit daemon
    cat > /etc/audit/rules.d/audit.rules << 'EOF'
# Delete all existing rules
-D

# Buffer size
-b 8192

# Failure mode (0=silent, 1=printk, 2=panic)
-f 1

# Monitor authentication
-w /etc/passwd -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity

# Monitor sudo usage
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d/ -p wa -k scope

# Monitor login/logout
-w /var/log/faillog -p wa -k logins
-w /var/log/lastlog -p wa -k logins
-w /var/log/tallylog -p wa -k logins

# Monitor network configuration
-w /etc/hosts -p wa -k network
-w /etc/network/ -p wa -k network

# Monitor Docker
-w /usr/bin/docker -p x -k docker
-w /var/lib/docker/ -p wa -k docker
-w /etc/docker/ -p wa -k docker

# Monitor file system mounts
-a always,exit -F arch=b64 -S mount -F auid>=1000 -F auid!=4294967295 -k mounts
-a always,exit -F arch=b32 -S mount -F auid>=1000 -F auid!=4294967295 -k mounts

# Monitor file deletions
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete

# Monitor privilege escalation
-a always,exit -F arch=b64 -S setuid -S setgid -S setreuid -S setregid -F auid>=1000 -F auid!=4294967295 -k privilege_escalation
-a always,exit -F arch=b32 -S setuid -S setgid -S setreuid -S setregid -F auid>=1000 -F auid!=4294967295 -k privilege_escalation

# Monitor system calls
-a always,exit -F arch=b64 -S chmod -S fchmod -S fchmodat -F auid>=1000 -F auid!=4294967295 -k perm_mod
-a always,exit -F arch=b32 -S chmod -S fchmod -S fchmodat -F auid>=1000 -F auid!=4294967295 -k perm_mod

# Make rules immutable
-e 2
EOF

    systemctl enable auditd
    systemctl restart auditd
    
    # Configure automatic security updates
    cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

Unattended-Upgrade::Package-Blacklist {
    // "vim";
    // "libc6-dev";
    // "libc6-i686";
};

Unattended-Upgrade::DevRelease "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Automatic-Reboot-Time "02:00";
Unattended-Upgrade::InstallOnShutdown "false";
Unattended-Upgrade::SyslogEnable "true";
Unattended-Upgrade::SyslogFacility "daemon";
EOF

    cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

    systemctl enable unattended-upgrades
    systemctl start unattended-upgrades
    
    # Configure log rotation for security logs
    cat > /etc/logrotate.d/security << 'EOF'
/var/log/auth.log
/var/log/ufw.log
/var/log/fail2ban.log
/var/log/audit/audit.log
{
    weekly
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 0640 root adm
    postrotate
        /bin/kill -HUP `cat /var/run/rsyslogd.pid 2> /dev/null` 2> /dev/null || true
    endscript
}
EOF

    log "System hardening completed successfully"
}

# Configure intrusion detection
setup_intrusion_detection() {
    log "Setting up intrusion detection..."
    
    # Configure AIDE (Advanced Intrusion Detection Environment)
    aide --init
    mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db
    
    # Create AIDE check script
    cat > /usr/local/bin/aide-check.sh << 'EOF'
#!/bin/bash
# AIDE integrity check script

LOG_FILE="/var/log/aide.log"
REPORT_FILE="/tmp/aide-report.txt"

# Run AIDE check
aide --check > "$REPORT_FILE" 2>&1

# Check if changes were detected
if [ $? -ne 0 ]; then
    # Changes detected, send alert
    echo "SECURITY ALERT: File system changes detected by AIDE" | \
    mail -s "AIDE Security Alert - $(hostname)" admin@localhost < "$REPORT_FILE"
    
    # Log the event
    echo "$(date): AIDE detected file system changes" >> "$LOG_FILE"
    cat "$REPORT_FILE" >> "$LOG_FILE"
else
    echo "$(date): AIDE check completed - no changes detected" >> "$LOG_FILE"
fi

# Clean up
rm -f "$REPORT_FILE"
EOF

    chmod +x /usr/local/bin/aide-check.sh
    
    # Schedule daily AIDE checks
    cat > /etc/cron.d/aide-check << 'EOF'
# Run AIDE integrity check daily at 3 AM
0 3 * * * root /usr/local/bin/aide-check.sh
EOF

    # Configure rkhunter
    rkhunter --update
    rkhunter --propupd
    
    # Configure rkhunter daily scan
    cat > /etc/cron.d/rkhunter << 'EOF'
# Run rkhunter scan daily at 4 AM
0 4 * * * root /usr/bin/rkhunter --cronjob --report-warnings-only --appendlog
EOF

    log "Intrusion detection configured successfully"
}

# Create security monitoring script
create_security_monitor() {
    log "Creating security monitoring script..."
    
    cat > /usr/local/bin/security-monitor.sh << 'EOF'
#!/bin/bash
# Security monitoring and alerting script

LOG_DIR="/var/log/security-monitor"
mkdir -p "$LOG_DIR"

# Check for failed login attempts
check_failed_logins() {
    local count=$(grep "authentication failure" /var/log/auth.log | wc -l)
    if [ "$count" -gt 10 ]; then
        echo "WARNING: $count failed login attempts detected"
    fi
}

# Check for suspicious network connections
check_network() {
    local suspicious=$(netstat -tuln | grep -E ':(22|80|443|3306|5432)' | wc -l)
    if [ "$suspicious" -gt 50 ]; then
        echo "WARNING: High number of network connections detected"
    fi
}

# Check disk usage
check_disk_usage() {
    local usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$usage" -gt 90 ]; then
        echo "CRITICAL: Disk usage is $usage%"
    fi
}

# Check memory usage
check_memory() {
    local mem_usage=$(free | awk 'NR==2{printf "%.1f", $3*100/$2}')
    if (( $(echo "$mem_usage > 90" | bc -l) )); then
        echo "WARNING: Memory usage is $mem_usage%"
    fi
}

# Check for rootkits
check_rootkits() {
    if command -v chkrootkit >/dev/null 2>&1; then
        local result=$(chkrootkit | grep -i infected | wc -l)
        if [ "$result" -gt 0 ]; then
            echo "CRITICAL: Possible rootkit detected"
        fi
    fi
}

# Main monitoring function
main() {
    local timestamp=$(date)
    local report_file="$LOG_DIR/security-report-$(date +%Y%m%d).log"
    
    echo "Security Monitor Report - $timestamp" >> "$report_file"
    echo "================================================" >> "$report_file"
    
    check_failed_logins >> "$report_file"
    check_network >> "$report_file"
    check_disk_usage >> "$report_file"
    check_memory >> "$report_file"
    check_rootkits >> "$report_file"
    
    echo "" >> "$report_file"
}

main "$@"
EOF

    chmod +x /usr/local/bin/security-monitor.sh
    
    # Schedule security monitoring
    cat > /etc/cron.d/security-monitor << 'EOF'
# Run security monitoring every hour
0 * * * * root /usr/local/bin/security-monitor.sh
EOF

    log "Security monitoring script created successfully"
}

# Main function
main() {
    log "Starting Enterprise Security Hardening..."
    
    check_root
    check_os
    update_system
    install_security_packages
    setup_firewall
    setup_fail2ban
    setup_apparmor
    system_hardening
    setup_intrusion_detection
    create_security_monitor
    
    log "Security hardening completed successfully!"
    echo ""
    info "Security Summary:"
    echo "✅ UFW Firewall: Configured and enabled"
    echo "✅ Fail2ban: Configured with custom rules"
    echo "✅ AppArmor: Profiles created and loaded"
    echo "✅ System Hardening: Kernel parameters optimized"
    echo "✅ Audit System: Enabled and configured"
    echo "✅ Intrusion Detection: AIDE and rkhunter configured"
    echo "✅ Automatic Updates: Enabled for security packages"
    echo "✅ Security Monitoring: Hourly checks scheduled"
    echo ""
    warn "Please reboot the system to ensure all changes take effect"
    echo ""
    info "You can check the status of security services with:"
    echo "  sudo ufw status verbose"
    echo "  sudo fail2ban-client status"
    echo "  sudo aa-status"
    echo "  sudo systemctl status auditd"
}

# Run main function
main "$@"