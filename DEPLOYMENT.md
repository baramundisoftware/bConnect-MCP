# Deployment Guide

**Last Updated:** November 4, 2025
**Status:** 117 MCP tools, 82% production ready

---

## ⚠️ Important: Development vs Production

**Development Setup (Current):**
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0  # ⚠️ DEVELOPMENT ONLY - INSECURE!
```

**Production Setup (Required):**
- ✅ Valid SSL certificate (remove NODE_TLS_REJECT_UNAUTHORIZED=0)
- ✅ Rate limiting enabled
- ✅ Audit logging for write operations
- ✅ Service account with minimum permissions

**See SECURITY-BEST-PRACTICES.md for production deployment requirements.**

---

## Current Setup (DevContainer)

The MCP server is already installed in your DevContainer:

```bash
cd /workspaces/claudinno/bConnect-MCP
npm install
npm run build
npm test  # 812+ tests, 100% passing
```

**Development Configuration** (`.env`):
```bash
BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
BCONNECT_USERNAME=Administrator
BCONNECT_PASSWORD=baramundi-2008
NODE_TLS_REJECT_UNAUTHORIZED=0  # ⚠️ DEVELOPMENT ONLY!
```

**Current Status:**
- ✅ 117 MCP tools (94 V2.0 + 23 V1.1)
- ✅ 812+ tests passing (86.35% coverage)
- ✅ 100% input validation
- ✅ 15,408+ documents indexed
- 🔄 82% production ready (security hardening in progress)

---

## Production Deployment Checklist

Before deploying to production, complete these security requirements:

### 1. SSL Certificate Verification (REQUIRED)

```bash
# Remove insecure setting from .env
# NODE_TLS_REJECT_UNAUTHORIZED=0  # ❌ DELETE THIS LINE

# Add proper SSL certificate
export NODE_EXTRA_CA_CERTS=/path/to/ca-cert.pem
```

### 2. Security Hardening (REQUIRED)

- [ ] **SSL/TLS:** Valid certificate installed (remove NODE_TLS_REJECT_UNAUTHORIZED=0)
- [ ] **Credentials:** Service account with minimum permissions (not Administrator)
- [ ] **Input Validation:** ✅ Complete (100% coverage)
- [ ] **Rate Limiting:** Configure request limits (see SECURITY-BEST-PRACTICES.md)
- [ ] **Audit Logging:** Enable logging for all write operations
- [ ] **Network Security:** Firewall rules configured
- [ ] **Credential Storage:** Use Ansible Vault or secrets manager

### 3. Testing (COMPLETE)

- [x] **Unit Tests:** 510 tests passing
- [x] **Integration Tests:** 95 tests passing
- [x] **E2E Tests:** 209 tests passing
- [x] **Input Validation:** 100% coverage (186/186 tools)

### 4. Documentation Review

- [ ] Review **SECURITY-BEST-PRACTICES.md** (production security guide)
- [ ] Review **PRODUCTION-HARDENING-STATUS.md** (82% complete)
- [ ] Review **TROUBLESHOOTING.md** (error solutions)

**Production Readiness:** 82% (28/34 tasks complete)

See **PRODUCTION-HARDENING-STATUS.md** for detailed tracking.

---

## Ansible Deployment (Multiple Machines)

### Ansible Playbook

The playbook is already available at `ansible/deploy-bconnect-mcp.yml`. It installs:
- Node.js 20.x
- bConnect MCP server
- Environment configuration
- Claude Code integration

### Usage

```bash
cd /workspaces/claudinno/bConnect-MCP/ansible

# Test connectivity
ansible all -i inventory.yml -m ping

# Deploy to all hosts
ansible-playbook -i inventory.yml deploy-bconnect-mcp.yml

# Deploy to specific hosts
ansible-playbook -i inventory.yml deploy-bconnect-mcp.yml --limit workstation1
```

### Inventory

Edit `ansible/inventory.yml`:

```yaml
all:
  children:
    workstations:
      hosts:
        workstation1:
          ansible_host: 192.168.1.101
        workstation2:
          ansible_host: 192.168.1.102
      vars:
        ansible_user: ansible
        bconnect_base_url: "https://bms-win22srv:444/bconnect"
        bconnect_username: "Administrator"
        bconnect_password: "baramundi-2008"
```

### Variables

Set these in the playbook or inventory:

- `bconnect_base_url`: API base URL (default: https://bms-win22srv:444/bconnect)
- `bconnect_username`: API username
- `bconnect_password`: API password (use ansible-vault for production)
- `mcp_install_dir`: Installation directory (default: /opt/bconnect-mcp)

### Ansible Vault (Production)

Encrypt sensitive data:

```bash
# Create vault file
ansible-vault create vars/vault.yml

# Add to vault.yml:
vault_bconnect_password: "baramundi-2008"

# Use in playbook:
ansible-playbook -i inventory.yml deploy-bconnect-mcp.yml --ask-vault-pass
```

## Manual Deployment

### Prerequisites

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Installation

```bash
# Copy project files
scp -r /workspaces/claudinno/bConnect-MCP user@target:/opt/

# On target machine
cd /opt/bConnect-MCP
npm install
npm run build

# Configure
cp .env.example .env
nano .env  # Edit credentials

# Test
node build/index.js
```

## Verification

```bash
# Check Node.js version
node --version  # Should be v20.x

# Run test suite
cd /opt/bConnect-MCP
npm test  # Should show 812+ tests passing

# Test API connection (development only - uses -k for insecure SSL)
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"

# Test MCP server with inspector
npm run inspector
# Should show 117 MCP tools available
```

**Expected Results:**
- ✅ 117 MCP tools available (94 V2.0 + 23 V1.1)
- ✅ 812+ tests passing
- ✅ API connection successful
- ✅ MCP inspector shows all tools

## Troubleshooting

### Permission Issues
```bash
sudo chown -R $USER:$USER /opt/bConnect-MCP
chmod 600 /opt/bConnect-MCP/.env
```

### Network Issues
```bash
# Test BMS connectivity
ping bms-win22srv
curl -k https://bms-win22srv:444/bconnect/docs/
```

### Ansible Issues
```bash
# Verbose output
ansible-playbook -vvv -i inventory.yml deploy-bconnect-mcp.yml

# Dry run
ansible-playbook --check -i inventory.yml deploy-bconnect-mcp.yml
```

## Update Deployment

```bash
cd /opt/bConnect-MCP
git pull  # If using git
npm install
npm run build

# Or use Ansible
ansible-playbook -i inventory.yml deploy-bconnect-mcp.yml
```
